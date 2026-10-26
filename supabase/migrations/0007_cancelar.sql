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
--  4. `registrar_pagamento`, `guardar_preapproval` e `guardar_autorizacao_asaas`
--     redefinidas: pagamento que chega com a assinatura `cancelada` dá o mês mas
--     mantém `cancelada`; abrir um checkout novo desfaz o cancelamento.
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


-- ----------------------------------------------------------------------------
-- registrar_pagamento (a da 0005 com UMA mudança): pagamento que chega com a
-- assinatura `cancelada` dá o mês (o dinheiro entrou; o acesso é do período)
-- mas MANTÉM `cancelada`. Antes ele fazia `status = 'ativa'` sem olhar o atual:
-- uma cobrança que já estava a caminho no gateway quando o cliente cancelou
-- ressuscitava a assinatura e o botão de cancelar mentia. Quem assina de novo
-- depois de cancelar volta a `ativa` pelo guardar_preapproval /
-- guardar_autorizacao_asaas (abaixo), que desfazem o cancelamento ao abrir o
-- checkout novo.
-- ----------------------------------------------------------------------------
create or replace function public.registrar_pagamento(
  p_gateway               text,
  p_gateway_pagamento_id  text,
  p_user_id               uuid,
  p_valor_centavos        int,
  p_gateway_assinatura_id text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preco    int := public.regra('preco_mensal_centavos')::int;
  v_travado  int;
  v_devido   int;
  v_existe   boolean;
  v_confere  boolean;
  v_atual    text;
  v_status   text;
  v_id       uuid;
begin
  select true,
         coalesce(a.gateway = p_gateway and a.gateway_assinatura_id = p_gateway_assinatura_id, false),
         nullif(a.valor_centavos, 0),
         a.status
    into v_existe, v_confere, v_travado, v_atual
    from public.assinaturas a
   where a.user_id = p_user_id;

  v_devido := least(v_preco, coalesce(v_travado, v_preco));
  v_status := case when coalesce(v_existe, false) and not v_confere then 'preapproval_divergente'
                   when p_valor_centavos >= v_devido then 'aprovado'
                   else 'valor_divergente' end;

  insert into public.pagamentos (gateway, gateway_pagamento_id, user_id, status, valor_centavos, pago_em)
  values (p_gateway, p_gateway_pagamento_id, case when coalesce(v_existe, false) then p_user_id end,
          v_status, p_valor_centavos, now())
  on conflict (gateway, gateway_pagamento_id) do nothing
  returning id into v_id;

  if v_id is null then return 'repetido'; end if;
  if not coalesce(v_existe, false) then return 'sem_usuario'; end if;
  if v_status <> 'aprovado' then return v_status; end if;

  update public.assinaturas
  set status = case when status = 'cancelada' then 'cancelada' else 'ativa' end,
      gateway = p_gateway,
      gateway_assinatura_id = coalesce(p_gateway_assinatura_id, gateway_assinatura_id),
      valor_centavos = p_valor_centavos,
      periodo_ate = greatest(coalesce(periodo_ate, now()), now()) + interval '1 month'
  where user_id = p_user_id;

  return 'liberado';
end;
$$;
revoke execute on function public.registrar_pagamento(text, text, uuid, int, text) from public, anon, authenticated;
grant execute on function public.registrar_pagamento(text, text, uuid, int, text) to service_role;


-- Assinar de novo depois de cancelar: abrir o checkout novo desfaz o `cancelada`
-- (com período pago sobrando volta a `ativa`, sem período vira `vencida`), senão o
-- 1º pagamento do checkout novo ficaria `cancelada` para sempre.
create or replace function public.guardar_preapproval(
  p_user_id               uuid,
  p_gateway_assinatura_id text,
  p_valor_centavos        int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assinaturas
  set gateway = 'mercadopago',
      gateway_assinatura_id = p_gateway_assinatura_id,
      valor_centavos = p_valor_centavos,
      status = case when status = 'cancelada'
                    then case when periodo_ate > now() then 'ativa' else 'vencida' end
                    else status end
  where user_id = p_user_id and status <> 'ativa';
  return found;
end;
$$;
revoke execute on function public.guardar_preapproval(uuid, text, int) from public, anon, authenticated;
grant execute on function public.guardar_preapproval(uuid, text, int) to service_role;

create or replace function public.guardar_autorizacao_asaas(
  p_user_id          uuid,
  p_cliente_id       text,
  p_autorizacao_id   text,
  p_valor_centavos   int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assinaturas
  set gateway = 'asaas',
      gateway_cliente_id = p_cliente_id,
      gateway_assinatura_id = p_autorizacao_id,
      valor_centavos = p_valor_centavos,
      status = case when status = 'cancelada'
                    then case when periodo_ate > now() then 'ativa' else 'vencida' end
                    else status end
  where user_id = p_user_id and status <> 'ativa';
  return found;
end;
$$;
revoke execute on function public.guardar_autorizacao_asaas(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.guardar_autorizacao_asaas(uuid, text, text, int) to service_role;


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
