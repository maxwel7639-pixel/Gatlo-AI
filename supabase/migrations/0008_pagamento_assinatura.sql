-- ============================================================================
-- 0008 · QUAL ASSINATURA O PAGAMENTO PAGOU (achado A do R2)
--
-- Aplicar DEPOIS da 0001..0007. O problema: estorno e chargeback cancelavam a
-- assinatura guardada ATUAL do usuário, não a do pagamento estornado. Quem assina,
-- cancela, assina de novo (outro preapproval/autorização) e leva o estorno de um
-- pagamento da assinatura antiga tinha a assinatura NOVA, em dia, cancelada.
--
--  1. `pagamentos.gateway_assinatura_id` (nula): `registrar_pagamento` passa a
--     gravar ali o id da assinatura/autorização que veio com o pagamento (ela já
--     recebia esse id; só não guardava). Linha antiga fica nula.
--  2. `estornar_pagamento` compara esse id com o guardado agora em `assinaturas`
--     (mesmo gateway e mesmo id) e devolve junto SE o pagamento é de uma
--     assinatura antiga: `estornado_antiga` / `repetido_antiga`. O mês é tirado do
--     mesmo jeito; só o webhook deixa de cancelar a assinatura atual. A decisão
--     mora no banco (o reenvio depois de falha repete a mesma resposta) e o
--     formato antigo (`estornado`, `repetido`, `desconhecido`) continua valendo:
--     pagamento com id nulo (linha antiga) devolve o de sempre e cancela a atual.
--
-- Sem a 0008 nada quebra de forma visível: o pagamento não guarda o id e todo
-- estorno volta ao comportamento da 0007 (cancela a assinatura atual).
-- ============================================================================

alter table public.pagamentos add column gateway_assinatura_id text;


-- registrar_pagamento (a da 0007 com UMA mudança): grava p_gateway_assinatura_id
-- também na linha do pagamento.
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

  insert into public.pagamentos (gateway, gateway_pagamento_id, user_id, status, valor_centavos, pago_em, gateway_assinatura_id)
  values (p_gateway, p_gateway_pagamento_id, case when coalesce(v_existe, false) then p_user_id end,
          v_status, p_valor_centavos, now(), p_gateway_assinatura_id)
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


-- Resultados: 'estornado' (revogou), 'repetido' (já estava estornado),
-- 'desconhecido' (nunca creditamos esse pagamento: nada a revogar), e as duas
-- versões `_antiga` de estornado/repetido: o pagamento é de uma assinatura que
-- NÃO é a guardada agora (o webhook não cancela a atual). Id nulo = o de sempre.
create or replace function public.estornar_pagamento(
  p_gateway              text,
  p_gateway_pagamento_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid;
  v_ass     text;
  v_novo    timestamptz;
  v_repete  boolean := false;
  v_sufixo  text;
begin
  -- só o pagamento aprovado vira estornado, e só uma vez (a linha é o ferrolho)
  update public.pagamentos
     set status = 'estornado'
   where gateway = p_gateway and gateway_pagamento_id = p_gateway_pagamento_id and status = 'aprovado'
  returning user_id, gateway_assinatura_id into v_user, v_ass;

  if not found then
    select user_id, gateway_assinatura_id into v_user, v_ass
      from public.pagamentos
     where gateway = p_gateway and gateway_pagamento_id = p_gateway_pagamento_id and status = 'estornado';
    if not found then return 'desconhecido'; end if;
    v_repete := true;
  end if;

  -- de assinatura antiga = o pagamento sabe a sua e ela não é a guardada agora
  v_sufixo := case when v_user is not null and v_ass is not null and not exists (
                      select 1 from public.assinaturas a
                       where a.user_id = v_user and a.gateway = p_gateway and a.gateway_assinatura_id = v_ass)
                   then '_antiga' else '' end;

  if v_repete then return 'repetido' || v_sufixo; end if;

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
  return 'estornado' || v_sufixo;
end;
$$;
revoke execute on function public.estornar_pagamento(text, text) from public, anon, authenticated;
grant execute on function public.estornar_pagamento(text, text) to service_role;


-- ============================================================================
-- CONFERÊNCIA depois de aplicar:
--
--   -- a coluna existe
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'pagamentos' and column_name = 'gateway_assinatura_id';
--   -- só o servidor executa (anon e logado têm que voltar FALSE)
--   select has_function_privilege('anon', 'public.estornar_pagamento(text,text)', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.estornar_pagamento(text,text)', 'execute') as logado,
--          has_function_privilege('service_role', 'public.estornar_pagamento(text,text)', 'execute') as servidor;
-- ============================================================================
