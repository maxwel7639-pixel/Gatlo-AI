import { cancelarAutorizacao, consultarAutorizacao, ouNaoExiste, removerAssinaturaAsaas } from "./asaas";
import { cancelarAssinaturaMP, consultarAssinatura, ouNaoExisteMP } from "./mercadopago";

/**
 * O MIOLO DE "CANCELAR NO GATEWAY", sem Next no meio (a ligação ao banco está em
 * lib/cancelar-servidor.ts; os testes rodam este miolo com os gateways simulados).
 *
 * Duas regras:
 *  - NÃO MEXE NO NOSSO BANCO. Cancelar aqui é pedir ao gateway. O status da
 *    assinatura só vira `cancelada` quando o aviso do gateway chega e o webhook
 *    confere na API (`marcar_assinatura`, migration 0007).
 *  - FALHA FECHADA. Qualquer erro do gateway lança, e quem chamou não segue: o
 *    botão avisa que não deu, e excluir a conta NÃO apaga a conta (senão o
 *    gateway continuaria cobrando quem não tem mais conta).
 * O id cancelado é o GUARDADO no banco para o usuário, nunca um que vem do navegador.
 * Já cancelado no gateway, ou que nem existe mais lá (404), conta como sucesso
 * (repetir o pedido não pode travar a exclusão). Erro de rede ou 5xx continua erro.
 */

export type AssinaturaParaCancelar = { gateway: string | null; gatewayAssinaturaId: string | null };

/** "cancelado" = pedimos agora; "ja_cancelado" = já estava; "nada" = não há assinatura no gateway. */
export type ResultadoCancelar = "cancelado" | "ja_cancelado" | "nada";

const ENCERRADA_NO_ASAAS = new Set(["CANCELLED", "REFUSED", "EXPIRED"]);

export async function cancelarNoGateway(a: AssinaturaParaCancelar | null): Promise<ResultadoCancelar> {
  if (!a?.gateway || !a.gatewayAssinaturaId) return "nada";
  const id = a.gatewayAssinaturaId;

  if (a.gateway === "mercadopago") {
    const pa = await ouNaoExisteMP(consultarAssinatura(id));
    // não existe mais no MP (404): nada cobrando. Sem isto a exclusão da conta ficava presa para sempre.
    if (!pa || pa.status === "cancelled") return "ja_cancelado";
    await cancelarAssinaturaMP(id);
    return "cancelado";
  }

  if (a.gateway === "asaas") {
    const aut = await ouNaoExiste(consultarAutorizacao(id));
    if (!aut) return "ja_cancelado"; // não existe mais no Asaas: nada cobrando
    const encerrada = ENCERRADA_NO_ASAAS.has(aut.status);
    if (!encerrada) await cancelarAutorizacao(id);
    // A autorização não garante que o Asaas pare de gerar a cobrança mensal: tira a assinatura também (404 = já saiu).
    if (aut.subscriptionId) await ouNaoExiste(removerAssinaturaAsaas(aut.subscriptionId));
    return encerrada ? "ja_cancelado" : "cancelado";
  }

  throw new Error(`gateway desconhecido: ${a.gateway}`);
}
