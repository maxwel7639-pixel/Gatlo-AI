import { createAdminClient } from "./supabase/admin";
import { cancelarNoGateway } from "./cancelar";

/**
 * A LIGAÇÃO DO CANCELAMENTO AO SERVIDOR: lê com a service role a assinatura
 * guardada do usuário e cancela NO GATEWAY. Não grava nada no banco (o status
 * muda só pelo webhook, depois de conferido na API). Serve ao botão "cancelar"
 * e à exclusão de conta; fica fora do arquivo "use server" para os testes
 * rodarem de verdade (Supabase e gateways simulados no fetch).
 */
export async function cancelarDoUsuario(userId: string) {
  const { data, error } = await createAdminClient()
    .from("assinaturas")
    .select("gateway, gateway_assinatura_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`assinaturas: ${error.message}`);
  return await cancelarNoGateway(
    data ? { gateway: data.gateway, gatewayAssinaturaId: data.gateway_assinatura_id } : null,
  );
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
