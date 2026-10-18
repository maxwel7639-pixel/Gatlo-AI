-- ============================================================================
-- 0006 · PIX AUTOMÁTICO (C2): guardar a autorização do Asaas e o preço da época
--
-- Aplicar DEPOIS da 0001..0005. NÃO mexe no `registrar_pagamento` (0005): ele já
-- amarra o pagamento ao id da assinatura guardado (`gateway` + `gateway_assinatura_id`),
-- serve igual para o Asaas e devolve os mesmos resultados. Só falta quem guarda.
--
-- `guardar_autorizacao_asaas` é o par do `guardar_preapproval` (0005): quando o
-- servidor abre a autorização do Pix Automático, grava o id do cliente do Asaas,
-- o id da autorização (para não abrir uma 2ª em paralelo e para o cancelamento do
-- C3) e o preço da época (preço travado por assinatura, como no cartão). Só o
-- servidor chama; assinatura já ativa não é mexida.
-- ============================================================================
create function public.guardar_autorizacao_asaas(
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
      valor_centavos = p_valor_centavos
  where user_id = p_user_id and status <> 'ativa';
  return found;
end;
$$;
revoke execute on function public.guardar_autorizacao_asaas(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.guardar_autorizacao_asaas(uuid, text, text, int) to service_role;


-- ============================================================================
-- CONFERÊNCIA depois de aplicar:
--
--   -- só o servidor executa (anon e logado têm que voltar FALSE)
--   select has_function_privilege('anon', 'public.guardar_autorizacao_asaas(uuid,text,text,int)', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.guardar_autorizacao_asaas(uuid,text,text,int)', 'execute') as logado,
--          has_function_privilege('service_role', 'public.guardar_autorizacao_asaas(uuid,text,text,int)', 'execute') as servidor;
-- ============================================================================
