import "server-only";
import { usaSupabase } from "./env";
import { createAdminClient } from "./supabase/admin";
import type { Estornar, Marcar, RegistroPagamento, ResultadoEstorno, ResultadoMarcar, ResultadoRegistro } from "./mp-webhook";

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

/** Estorno ou chargeback de um pagamento que creditamos (`estornar_pagamento`, migrations 0007 e 0008). Erro do banco lança: a rota responde 500 e o gateway reenvia. */
export async function estornarNoBanco(e: Parameters<Estornar>[0]): Promise<ResultadoEstorno> {
  if (!usaSupabase) throw new Error("estornar_pagamento: sem Supabase configurado");
  const { data, error } = await createAdminClient().rpc("estornar_pagamento", {
    p_gateway: e.gateway,
    p_gateway_pagamento_id: e.gatewayPagamentoId,
  });
  if (error) throw new Error(`estornar_pagamento: ${error.message}`);
  if (data === "estornado" || data === "repetido" || data === "desconhecido" || data === "estornado_antiga" || data === "repetido_antiga") return data;
  throw new Error(`estornar_pagamento devolveu algo inesperado: ${String(data)}`);
}

/** Cancelamento confirmado pelo gateway (`marcar_assinatura`, migration 0007): só chega aqui depois de o webhook conferir na API. */
export async function marcarCanceladaNoBanco(m: Parameters<Marcar>[0]): Promise<ResultadoMarcar> {
  if (!usaSupabase) throw new Error("marcar_assinatura: sem Supabase configurado");
  const { data, error } = await createAdminClient().rpc("marcar_assinatura", {
    p_user_id: m.userId,
    p_status: "cancelada",
    p_gateway: m.gateway,
    p_gateway_assinatura_id: m.gatewayAssinaturaId,
  });
  if (error) throw new Error(`marcar_assinatura: ${error.message}`);
  if (data === "cancelada" || data === "repetida" || data === "nao_guardada" || data === "sem_efeito" || data === "sem_usuario") return data;
  throw new Error(`marcar_assinatura devolveu algo inesperado: ${String(data)}`);
}
