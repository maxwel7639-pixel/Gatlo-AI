import { consultarAutorizacao, consultarCliente, consultarCobranca, ouNaoExiste } from "./asaas";
import { lerReferencia } from "./mercadopago";
import type { Registrar } from "./mp-webhook";

/**
 * O NÚCLEO DO WEBHOOK DO ASAAS, sem rota e sem banco no meio (a rota é fina:
 * app/api/asaas-webhook/route.ts; quem lê e grava no banco é injetado). Mesmo
 * padrão do cartão (lib/mp-webhook.ts): 1º confere o token, 2º consulta a API,
 * 3º credita.
 *
 * QUALQUER UM NA INTERNET consegue mandar um POST nessa URL dizendo "pagamento
 * recebido, libera o robô pra mim". Por isso o corpo do aviso vale só como PISTA
 * de id da cobrança: status, valor, dono e a autorização vêm da API do Asaas
 * consultada com a nossa chave. Um aviso forjado não credita nada.
 *
 * Quem credita é o pagamento (PAYMENT_RECEIVED / PAYMENT_CONFIRMED), nunca o aviso
 * de autorização: o 1º pagamento (QR Code imediato) e as cobranças mensais da
 * assinatura chegam como cobrança comum. Os dois eventos podem chegar para a mesma
 * cobrança; o `registrar_pagamento` é idempotente pelo id dela.
 *
 * Fontes: docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook (token
 * no cabeçalho `asaas-access-token`, entrega "at least once", responder 200) e
 * /docs/fluxos-de-webhook (nomes dos eventos).
 */

/** Cabeçalho em que o Asaas manda o `authToken` que configuramos no webhook. */
export const CABECALHO_TOKEN = "asaas-access-token";

const EVENTOS_DE_CREDITO = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);
const ID_COBRANCA = /^pay_[A-Za-z0-9]+$/;

async function sha256(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

/**
 * Confere o token do cabeçalho em tempo constante: compara o SHA-256 dos dois
 * (tamanho fixo, então nem o tamanho do segredo vaza) sem sair no primeiro byte
 * diferente. Sem `ASAAS_WEBHOOK_TOKEN` configurado NADA passa: o webhook é
 * público, e esquecer a variável vira 401 (o Asaas reenvia), não porta aberta.
 */
export async function tokenValido(cabecalho: string | null): Promise<{ valido: boolean; motivo?: string }> {
  const segredo = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!segredo) return { valido: false, motivo: "ASAAS_WEBHOOK_TOKEN não configurado" };
  if (!cabecalho) return { valido: false, motivo: `sem ${CABECALHO_TOKEN}` };
  const [a, b] = await Promise.all([sha256(cabecalho), sha256(segredo)]);
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0 ? { valido: true } : { valido: false, motivo: "token divergente" };
}

export type DepsAsaas = {
  registrar: Registrar;
  /** A autorização que guardamos para o usuário (gravada ao abrir o Pix Automático). */
  autorizacaoGuardada: (userId: string) => Promise<{ gateway: string | null; id: string | null } | null>;
};

export type ResultadoAvisoAsaas =
  | { tratado: "liberado"; userId: string }
  | { tratado: "ignorado"; motivo: string };

export async function processarAviso(
  aviso: { evento: string | null; pagamentoId: string | null },
  d: DepsAsaas,
): Promise<ResultadoAvisoAsaas> {
  if (!aviso.evento || !EVENTOS_DE_CREDITO.has(aviso.evento)) {
    return { tratado: "ignorado", motivo: `evento ${aviso.evento ?? "(vazio)"}` };
  }
  const id = aviso.pagamentoId;
  if (!id || !ID_COBRANCA.test(id)) return { tratado: "ignorado", motivo: "aviso sem id de cobrança" };

  // Falha de rede ou do banco LANÇA: a rota responde 500 e o Asaas reenvia
  // (pagamento confirmado não se perde por um soluço). Já "não existe" (404) é
  // resposta definitiva: ignorar, senão um id ruim trava a fila de avisos inteira
  // (o Asaas pausa a fila depois de 15 falhas seguidas).
  const p = await ouNaoExiste(consultarCobranca(id));
  if (!p) return { tratado: "ignorado", motivo: "cobrança não existe no Asaas" };
  if (p.status !== "RECEIVED" && p.status !== "CONFIRMED") return { tratado: "ignorado", motivo: `cobrança ${p.status}` };
  if (p.billingType !== "PIX") return { tratado: "ignorado", motivo: `forma ${p.billingType ?? "(vazia)"}` };
  // Com devolução (parcial ou não) não libera. (Estorno depois de creditado: C3.)
  if ((p.refunds?.length ?? 0) > 0) return { tratado: "ignorado", motivo: "cobrança com devolução" };
  if (p.value == null || !p.customer) return { tratado: "ignorado", motivo: "cobrança sem valor ou cliente" };

  // O dono vem do cliente que NÓS criamos (referência gravada por nós), lida da API.
  const cliente = await ouNaoExiste(consultarCliente(p.customer));
  const ref = lerReferencia(cliente?.externalReference);
  if (!ref) return { tratado: "ignorado", motivo: "cliente sem referência de assinatura" };

  // A autorização: só vale a que guardamos para esse usuário, e só se, na API, ela
  // pertencer ao cliente que pagou (e, nas cobranças mensais, à assinatura dela).
  // Qualquer outra coisa segue como `null`, e o banco guarda o pagamento como
  // `preapproval_divergente` sem liberar.
  const guardada = await d.autorizacaoGuardada(ref.userId);
  let autorizacaoId: string | null = null;
  if (guardada?.gateway === "asaas" && guardada.id) {
    const a = await ouNaoExiste(consultarAutorizacao(guardada.id));
    const doMesmoCliente = a?.customerId === p.customer;
    const daMesmaAssinatura = !p.subscription || p.subscription === a?.subscriptionId;
    if (a && doMesmoCliente && daMesmaAssinatura) autorizacaoId = guardada.id;
  }

  const resultado = await d.registrar({
    gateway: "asaas",
    gatewayPagamentoId: String(p.id),
    userId: ref.userId,
    valorCentavos: Math.round(p.value * 100),
    gatewayAssinaturaId: autorizacaoId,
  });
  if (resultado === "liberado") return { tratado: "liberado", userId: ref.userId };

  // Dinheiro que o Asaas cobrou e não liberou nada: ele não reenvia (a rota
  // responde 200), então o aviso sai daqui em nível de erro, para o log da Vercel.
  if (resultado === "valor_divergente") {
    console.error(
      `[asaas-webhook] ALERTA valor_divergente: cobrança ${p.id} do usuário ${ref.userId} pagou ${p.value} e não liberou. Conferir regras.preco_mensal_centavos e a autorização ${guardada?.id ?? "(nenhuma)"}.`,
    );
  } else if (resultado === "preapproval_divergente") {
    console.error(
      `[asaas-webhook] ALERTA preapproval_divergente: cobrança ${p.id} do usuário ${ref.userId} (cliente ${p.customer}, assinatura ${p.subscription ?? "(nenhuma)"}) não bate com a autorização guardada dele (${guardada?.id ?? "(nenhuma)"}) e não liberou. Conferir no Asaas e estornar se for o caso.`,
    );
  } else if (resultado === "sem_usuario") {
    console.error(
      `[asaas-webhook] ALERTA cobranca_orfa: cobrança ${p.id} de ${p.value} para um usuário que não existe mais (${ref.userId}). Cancelar a autorização e estornar.`,
    );
  }
  return { tratado: "ignorado", motivo: resultado === "repetido" ? "aviso repetido" : resultado };
}

/**
 * A porta de entrada do aviso, sem Next no meio: 1º confere o token do cabeçalho,
 * 2º consulta a API do Asaas, 3º credita. Aviso sem token bom para no 1º passo:
 * não gasta chamada na API e não toca no banco.
 */
export async function receberAviso(
  aviso: { evento: string | null; pagamentoId: string | null; token: string | null },
  d: DepsAsaas,
): Promise<{ status: 200 | 401 | 500; corpo: Record<string, string> }> {
  const conf = await tokenValido(aviso.token);
  if (!conf.valido) {
    // O motivo ajuda quem configura (vai pro log), mas não pode ir na resposta:
    // o webhook é público e diria a qualquer anônimo o que falta.
    console.error(`[asaas-webhook] 401: ${conf.motivo ?? "token inválido"}`);
    return { status: 401, corpo: { erro: "não autorizado" } };
  }

  try {
    const r = await processarAviso(aviso, d);
    return { status: 200, corpo: r.tratado === "liberado" ? { tratado: "liberado" } : { tratado: "ignorado", motivo: r.motivo } };
  } catch (e) {
    return { status: 500, corpo: { erro: e instanceof Error ? e.message : "falha ao processar o aviso do Asaas" } };
  }
}
