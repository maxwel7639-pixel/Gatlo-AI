import "server-only";
import { usaSupabase } from "./env";
import { createAdminClient } from "./supabase/admin";
import type { RegistroPagamento, ResultadoRegistro } from "./mp-webhook";

/**
 * Liberar de verdade: `registrar_pagamento` no banco (migration 0005), com a
 * service role. Serve aos dois webhooks (Mercado Pago e Asaas).
 *
 * Erro do banco NÃO pode virar "ignorado" (200): o gateway não reenviaria e o
 * pagamento confirmado ficaria sem crédito. Lança, e a rota responde 500.
 */
export async function registrarNoBanco(p: RegistroPagamento): Promise<ResultadoRegistro> {
  if (!usaSupabase) throw new Error("registrar_pagamento: sem Supabase configurado");
  const { data, error } = await createAdminClient().rpc("registrar_pagamento", {
    p_gateway: p.gateway,
    p_gateway_pagamento_id: p.gatewayPagamentoId,
    p_user_id: p.userId,
    p_valor_centavos: p.valorCentavos,
    p_gateway_assinatura_id: p.gatewayAssinaturaId,
  });
  if (error) throw new Error(`registrar_pagamento: ${error.message}`);
  if (data === "liberado" || data === "repetido" || data === "valor_divergente" || data === "preapproval_divergente" || data === "sem_usuario") return data;
  throw new Error(`registrar_pagamento devolveu algo inesperado: ${String(data)}`);
}
