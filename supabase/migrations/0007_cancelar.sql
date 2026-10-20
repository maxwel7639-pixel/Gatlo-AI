-- ============================================================================
-- 0007 · CANCELAR E ESTORNAR (C3): o status só muda por aviso do gateway
--
-- Aplicar DEPOIS da 0001..0006. Três coisas:
--
--  1. `marcar_assinatura`: quem passa a assinatura de `ativa` para `cancelada`.
--     Só o servidor chama (service role), e só depois que o webhook consultou a
--     API do gateway e viu o cancelamento. Só vale para a assinatura GUARDADA do
--     usuário (mesmo gateway e mesmo id): aviso de outro preapproval ou de outra
--     autorização nunca muda o status. Teste (`trial`) e assinatura que nunca foi
--     paga não mudam: cancelar um checkout pendente não pode matar os dias de teste.
--  2. `estornar_pagamento`: estorno ou chargeback de um pagamento que NÓS
--     creditamos. O pagamento vira `estornado` (uma vez só: idempotente) e o mês
--     que ele deu é tirado do `periodo_ate`. Se o que sobra do período já passou,
--     a assinatura vira `estornado` e o robô para.
--  3. `assinatura_situacao`: `cancelada` MANTÉM O ACESSO ATÉ O FIM DO PERÍODO PAGO
--     (sem a carência de pagamento atrasado: quem cancelou não está atrasado) e
--     `estornado` nunca libera. O formato da resposta é o mesmo.
-- ============================================================================

alter table public.assinaturas drop constraint if exists assinaturas_status_check;
alter table public.assinaturas add constraint assinaturas_status_check
  check (status in ('trial', 'ativa', 'vencida', 'cancelada', 'estornado'));


create or replace function public.assinatura_situacao(p_user_id uuid)
returns table (
  status         text,
  liberada       boolean,
  trial_ate      timestamptz,
  periodo_ate    timestamptz,
  dias_restantes int
)
language sql stable
security definer
set search_path = public
as $$
  select
    case
      when a.status = 'trial' and a.trial_ate <= now() then 'vencida'
      when a.status = 'ativa' and (a.periodo_ate is null
        or a.periodo_ate + make_interval(days => public.regra('carencia_dias')::int) <= now()) then 'vencida'
      else a.status
    end,
    case
      when a.status = 'trial' then a.trial_ate > now()
      when a.status = 'ativa' then a.periodo_ate is not null
        and a.periodo_ate + make_interval(days => public.regra('carencia_dias')::int) > now()
      -- cancelou: usa o que já pagou, até o último dia, sem carência
      when a.status = 'cancelada' then a.periodo_ate is not null and a.periodo_ate > now()
      else false
    end,
    a.trial_ate,
    a.periodo_ate,
    greatest(0, ceil(extract(epoch from (
      case when a.status = 'trial' then a.trial_ate else coalesce(a.periodo_ate, now()) end
    ) - now()) / 86400))::int
  from public.assinaturas a
  where a.user_id = p_user_id;
$$;
revoke execute on function public.assinatura_situacao(uuid) from public, anon, authenticated;


-- Resultados: 'cancelada' (mudou), 'repetida' (já estava cancelada),
-- 'nao_guardada' (o id do aviso não é o guardado do usuário: nada muda),
-- 'sem_efeito' (não estava ativa: teste, vencida ou estornada, nada a cancelar),
-- 'sem_usuario' (conta excluída).
create function public.marcar_assinatura(
  p_user_id               uuid,
  p_status                text,
  p_gateway               text,
  p_gateway_assinatura_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_gateway   text;
  v_id        text;
begin
  if p_status <> 'cancelada' then
    raise exception 'marcar_assinatura: status % não é aceito', p_status;
  end if;

  select a.status, a.gateway, a.gateway_assinatura_id
    into v_status, v_gateway, v_id
    from public.assinaturas a
   where a.user_id = p_user_id
   for update;
  if not found then return 'sem_usuario'; end if;

  -- null nunca confere: aviso sem id, ou assinatura sem id guardado, não muda nada
  if p_gateway_assinatura_id is null or v_id is null
     or v_gateway is distinct from p_gateway or v_id <> p_gateway_assinatura_id then
    return 'nao_guardada';
  end if;

  if v_status = 'cancelada' then return 'repetida'; end if;
  if v_status <> 'ativa' then return 'sem_efeito'; end if;

  update public.assinaturas set status = 'cancelada' where user_id = p_user_id;
  return 'cancelada';
end;
$$;
revoke execute on function public.marcar_assinatura(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.marcar_assinatura(uuid, text, text, text) to service_role;


-- Resultados: 'estornado' (revogou), 'repetido' (já estava estornado),
-- 'desconhecido' (nunca creditamos esse pagamento: nada a revogar).
create function public.estornar_pagamento(
  p_gateway              text,
  p_gateway_pagamento_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_novo  timestamptz;
begin
  -- só o pagamento aprovado vira estornado, e só uma vez (a linha é o ferrolho)
  update public.pagamentos
     set status = 'estornado'
   where gateway = p_gateway and gateway_pagamento_id = p_gateway_pagamento_id and status = 'aprovado'
  returning user_id into v_user;

  if not found then
    if exists (select 1 from public.pagamentos
                where gateway = p_gateway and gateway_pagamento_id = p_gateway_pagamento_id and status = 'estornado') then
      return 'repetido';
    end if;
    return 'desconhecido';
  end if;

  -- pagamento de conta excluída: guardado sem dono, nada a revogar
  if v_user is null then return 'estornado'; end if;

  -- cada pagamento deu 1 mês (registrar_pagamento): tira o mês dele
  update public.assinaturas
     set periodo_ate = periodo_ate - interval '1 month'
   where user_id = v_user and periodo_ate is not null
  returning periodo_ate into v_novo;

  if v_novo is not null and v_novo <= now() then
    update public.assinaturas set status = 'estornado' where user_id = v_user;
  end if;
  return 'estornado';
end;
$$;
revoke execute on function public.estornar_pagamento(text, text) from public, anon, authenticated;
grant execute on function public.estornar_pagamento(text, text) to service_role;


-- ============================================================================
-- CONFERÊNCIA depois de aplicar:
--
--   -- só o servidor executa (anon e logado têm que voltar FALSE)
--   select has_function_privilege('anon', 'public.marcar_assinatura(uuid,text,text,text)', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.marcar_assinatura(uuid,text,text,text)', 'execute') as logado,
--          has_function_privilege('service_role', 'public.marcar_assinatura(uuid,text,text,text)', 'execute') as servidor;
--   select has_function_privilege('anon', 'public.estornar_pagamento(text,text)', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.estornar_pagamento(text,text)', 'execute') as logado,
--          has_function_privilege('service_role', 'public.estornar_pagamento(text,text)', 'execute') as servidor;
-- ============================================================================
