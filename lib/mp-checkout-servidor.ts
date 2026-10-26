import { createAdminClient } from "./supabase/admin";
import { regras } from "./regras";
import { abrirCheckout } from "./mp-checkout";

/**
 * A LIGAÇÃO DO CHECKOUT AO SERVIDOR: preço lido de `regras` (banco) e a assinatura
 * lida e gravada com a service role. A ação `assinarCartao` (lib/acoes.ts) só traz
 * o usuário da sessão e chama isto; fica aqui, fora do arquivo "use server", para os
 * testes rodarem a ligação de verdade (Supabase e Mercado Pago simulados no fetch)
 * em vez de conferir o texto da ação.
 */
export async function abrirCheckoutDoServidor(usuario: { id: string; email: string }) {
  const admin = createAdminClient();
  return await abrirCheckout(usuario, {
    lerPreco: async () => (await regras()).precoMensalCentavos,
    assinaturaAtual: async () => {
      const { data, error } = await admin
        .from("assinaturas")
        .select("status, gateway, gateway_assinatura_id")
        .eq("user_id", usuario.id)
        .maybeSingle();
      if (error) throw new Error(`assinaturas: ${error.message}`);
      return data
        ? { status: data.status, gateway: data.gateway, gatewayAssinaturaId: data.gateway_assinatura_id }
        : null;
    },
    guardar: async (id, valorCentavos) => {
      const { data, error } = await admin.rpc("guardar_preapproval", {
        p_user_id: usuario.id,
        p_gateway_assinatura_id: id,
        p_valor_centavos: valorCentavos,
      });
      if (error || data !== true) throw new Error(`guardar_preapproval: ${error?.message ?? "não gravou"}`);
    },
  });
}
