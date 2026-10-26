import { createAdminClient } from "./supabase/admin";
import { cancelarNoGateway, type AssinaturaParaCancelar } from "./cancelar";

/**
 * A LIGAÇÃO DO CANCELAMENTO AO SERVIDOR: lê com a service role a assinatura
 * guardada do usuário e cancela NO GATEWAY. Serve ao botão "cancelar", à exclusão
 * de conta e ao estorno; fica fora do arquivo "use server" para os testes rodarem
 * de verdade (Supabase e gateways simulados no fetch).
 *
 * Pedir o cancelamento não grava nada no banco: o status muda pelo aviso do
 * gateway, conferido na API (`marcar_assinatura`, migration 0007). A única
 * exceção é `cancelarPeloBotao` quando a API JÁ confirma o cancelamento.
 */
async function assinaturaGuardada(userId: string): Promise<AssinaturaParaCancelar | null> {
  const { data, error } = await createAdminClient()
    .from("assinaturas")
    .select("gateway, gateway_assinatura_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`assinaturas: ${error.message}`);
  return data ? { gateway: data.gateway, gatewayAssinaturaId: data.gateway_assinatura_id } : null;
}

export async function cancelarDoUsuario(userId: string) {
  return await cancelarNoGateway(await assinaturaGuardada(userId));
}

/**
 * O botão. Se o gateway ainda cobrava, o pedido sai e o status espera o aviso
 * dele. Se a API JÁ diz que está cancelado (o aviso se perdeu, ou o cancelamento
 * foi feito direto no gateway), o aviso não vem mais: marca agora, com o id
 * guardado (`marcar_assinatura` só muda se for o guardado e estiver ativa).
 */
export async function cancelarPeloBotao(userId: string) {
  const guardada = await assinaturaGuardada(userId);
  const r = await cancelarNoGateway(guardada);
  if (r === "ja_cancelado" && guardada?.gateway && guardada.gatewayAssinaturaId) {
    const { error } = await createAdminClient().rpc("marcar_assinatura", {
      p_user_id: userId,
      p_status: "cancelada",
      p_gateway: guardada.gateway,
      p_gateway_assinatura_id: guardada.gatewayAssinaturaId,
    });
    if (error) throw new Error(`marcar_assinatura: ${error.message}`);
  }
  return r;
}

/**
 * Excluir a conta: cancela no gateway ANTES de apagar, e se o cancelamento falhar
 * a conta fica (falha fechada). `apagar` é o `deleteUser`, injetado para o teste
 * provar a ordem. Sem conta o webhook não acha o dono, e o gateway seguiria
 * cobrando quem já foi embora.
 */
export async function cancelarEApagar(
  userId: string,
  apagar: () => Promise<{ message: string } | null>,
): Promise<"ok" | "gateway" | "apagar"> {
  try {
    await cancelarDoUsuario(userId);
  } catch (e) {
    console.error("[excluirConta] cancelar no gateway:", e instanceof Error ? e.message : e);
    return "gateway";
  }
  const erro = await apagar();
  if (erro) {
    console.error("[excluirConta]", erro.message);
    return "apagar";
  }
  return "ok";
}
