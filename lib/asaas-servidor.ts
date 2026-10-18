import "server-only";
import { createAdminClient } from "./supabase/admin";
import { regras } from "./regras";
import { abrirAutorizacao } from "./asaas-checkout";

/**
 * A LIGAÇÃO DO PIX AUTOMÁTICO AO SERVIDOR: preço lido de `regras` (banco) e a
 * assinatura lida e gravada com a service role. A ação `assinarPix`
 * (lib/acoes.ts) só traz o usuário da sessão e o documento digitado; fica aqui,
 * fora do arquivo "use server", para os testes rodarem a ligação de verdade
 * (Supabase e Asaas simulados no fetch).
 */
export async function abrirAutorizacaoDoServidor(
  usuario: { id: string; email: string; nome: string | null },
  cpfCnpj: string,
) {
  const admin = createAdminClient();
  return await abrirAutorizacao(usuario, cpfCnpj, {
    lerPreco: async () => (await regras()).precoMensalCentavos,
    assinaturaAtual: async () => {
      const { data, error } = await admin
        .from("assinaturas")
        .select("status, gateway, gateway_assinatura_id, gateway_cliente_id")
        .eq("user_id", usuario.id)
        .maybeSingle();
      if (error) throw new Error(`assinaturas: ${error.message}`);
      return data
        ? {
            status: data.status,
            gateway: data.gateway,
            gatewayAssinaturaId: data.gateway_assinatura_id,
            gatewayClienteId: data.gateway_cliente_id,
          }
        : null;
    },
    guardar: async (clienteId, autorizacaoId, valorCentavos) => {
      const { data, error } = await admin.rpc("guardar_autorizacao_asaas", {
        p_user_id: usuario.id,
        p_cliente_id: clienteId,
        p_autorizacao_id: autorizacaoId,
        p_valor_centavos: valorCentavos,
      });
      if (error || data !== true) throw new Error(`guardar_autorizacao_asaas: ${error?.message ?? "não gravou"}`);
    },
  });
}

/** A autorização que guardamos para o usuário: o webhook só credita pagamento dela. */
export async function autorizacaoGuardadaDoServidor(userId: string) {
  const { data, error } = await createAdminClient()
    .from("assinaturas")
    .select("gateway, gateway_assinatura_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`assinaturas: ${error.message}`);
  return data ? { gateway: data.gateway as string | null, id: data.gateway_assinatura_id as string | null } : null;
}
