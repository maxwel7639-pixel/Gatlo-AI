-- ============================================================================
-- 0005 · COBRANÇA NO CARTÃO (C1): preço travado por assinatura e resultado claro
--
-- Aplicar DEPOIS da 0001..0004. Troca `registrar_pagamento` (0001, seção 7) por
-- uma versão que:
--
--  1. TRAVA O PREÇO POR ASSINATURA. O preapproval do Mercado Pago cobra todo
--     mês o valor fixado na hora da assinatura. Se `regras.preco_mensal_centavos`
--     subir depois, o assinante antigo continua pagando o valor da época: o
--     banco aceita pagamento >= o MENOR entre o preço atual e o valor guardado
--     no preapproval daquele usuário (`assinaturas.valor_centavos`, gravado por
--     `guardar_preapproval` quando o checkout é criado). Reajuste vale só para
--     assinatura nova. Sem valor guardado, vale o preço atual (como antes).
--  2. SÓ CREDITA PAGAMENTO DO PREAPPROVAL GUARDADO. O pagamento chega com o
--     `external_reference` (que aponta o usuário) e o `preapproval_id`, ambos
--     lidos da API do MP. Só credita se o preapproval_id for igual ao
--     `gateway_assinatura_id` guardado do usuário: pagamento sem preapproval,
--     ou de outro, é guardado como `preapproval_divergente` e não libera.
--  3. DEVOLVE TEXTO em vez de boolean, para o servidor saber o que aconteceu e
--     alertar quando é dinheiro que entrou sem liberar:
--       'liberado'          pagamento novo, valor ok, período empurrado 1 mês
--       'repetido'          o gateway reenviou um pagamento já registrado
--       'preapproval_divergente'  o preapproval do pagamento não é o guardado
--                           do usuário (ausente ou outro): guardado, não libera
--       'valor_divergente'  valor abaixo do preço devido: guardado, não libera
--       'sem_usuario'       usuário não existe (conta excluída): guardado sem
--                           dono, não libera. É cobrança órfã que pede estorno.
--  4. NÃO QUEBRA com usuário que não existe. Antes, o FK de pagamentos.user_id
--     virava exceção, a rota respondia 500 e o MP reenviava para sempre.
--
-- Pagamentos continuam idempotentes por (gateway, gateway_pagamento_id).
-- ============================================================================

alter table public.pagamentos drop constraint if exists pagamentos_status_check;
alter table public.pagamentos add constraint pagamentos_status_check
  check (status in ('aprovado', 'valor_divergente', 'preapproval_divergente', 'estornado'));

drop function if exists public.registrar_pagamento(text, text, uuid, int, text);

create function public.registrar_pagamento(
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
  v_status   text;
  v_id       uuid;
begin
  -- o preapproval do pagamento tem que ser o guardado (null nunca confere)
  select true,
         coalesce(a.gateway = p_gateway and a.gateway_assinatura_id = p_gateway_assinatura_id, false),
         nullif(a.valor_centavos, 0)
    into v_existe, v_confere, v_travado
    from public.assinaturas a
   where a.user_id = p_user_id;

  v_devido := least(v_preco, coalesce(v_travado, v_preco));
  v_status := case when coalesce(v_existe, false) and not v_confere then 'preapproval_divergente'
                   when p_valor_centavos >= v_devido then 'aprovado'
                   else 'valor_divergente' end;

  -- usuário que não existe mais: o pagamento fica guardado SEM dono (prova para o estorno)
  insert into public.pagamentos (gateway, gateway_pagamento_id, user_id, status, valor_centavos, pago_em)
  values (p_gateway, p_gateway_pagamento_id, case when coalesce(v_existe, false) then p_user_id end,
          v_status, p_valor_centavos, now())
  on conflict (gateway, gateway_pagamento_id) do nothing
  returning id into v_id;

  if v_id is null then return 'repetido'; end if;
  if not coalesce(v_existe, false) then return 'sem_usuario'; end if;
  if v_status <> 'aprovado' then return v_status; end if;

  update public.assinaturas
  set status = 'ativa',
      gateway = p_gateway,
      gateway_assinatura_id = coalesce(p_gateway_assinatura_id, gateway_assinatura_id),
      valor_centavos = p_valor_centavos,
      periodo_ate = greatest(coalesce(periodo_ate, now()), now()) + interval '1 month'
  where user_id = p_user_id;

  return 'liberado';
end;
$$;
revoke execute on function public.registrar_pagamento(text, text, uuid, int, text)
  from public, anon, authenticated;
grant execute on function public.registrar_pagamento(text, text, uuid, int, text) to service_role;


-- ============================================================================
-- Guardar o preapproval quando o checkout é criado: o id (para não abrir um 2º
-- checkout em paralelo e para o cancelamento do C3) e o valor da época (o preço
-- travado de cima). Só o servidor chama; assinatura já ativa não é mexida.
-- ============================================================================
create function public.guardar_preapproval(
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
      valor_centavos = p_valor_centavos
  where user_id = p_user_id and status <> 'ativa';
  return found;
end;
$$;
revoke execute on function public.guardar_preapproval(uuid, text, int) from public, anon, authenticated;
grant execute on function public.guardar_preapproval(uuid, text, int) to service_role;


-- ============================================================================
-- CONFERÊNCIA depois de aplicar:
--
--   -- as duas funções só o servidor executa (anon e logado têm que voltar FALSE)
--   select has_function_privilege('anon', 'public.registrar_pagamento(text,text,uuid,int,text)', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.registrar_pagamento(text,text,uuid,int,text)', 'execute') as logado,
--          has_function_privilege('service_role', 'public.registrar_pagamento(text,text,uuid,int,text)', 'execute') as servidor;
--   select has_function_privilege('anon', 'public.guardar_preapproval(uuid,text,int)', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.guardar_preapproval(uuid,text,int)', 'execute') as logado,
--          has_function_privilege('service_role', 'public.guardar_preapproval(uuid,text,int)', 'execute') as servidor;
-- ============================================================================
