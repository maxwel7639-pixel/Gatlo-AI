import { consultarAutorizacao, consultarCliente, consultarCobranca, ouNaoExiste } from "./asaas";
import { lerReferencia } from "./mercadopago";
import type { Estornar, Marcar, Registrar } from "./mp-webhook";

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
// Estorno: o evento é só a pista; quem decide é o status/devoluções da cobrança na API.
const EVENTOS_DE_ESTORNO = new Set(["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED"]);
const STATUS_DEVOLVIDO = new Set(["REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"]);
const EVENTOS_DE_AUTORIZACAO = new Set(["PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED", "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED"]);
const ID_COBRANCA = /^pay_[A-Za-z0-9]+$/;
const ID_AUTORIZACAO = /^[A-Za-z0-9_-]{1,64}$/;

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
  /** Estorno e cancelamento (migration 0007). Quem testa só um pedaço pode omitir; o que faltar e for preciso LANÇA (rota 500). */
  estornar?: Estornar;
  marcar?: Marcar;
};

export type ResultadoAvisoAsaas =
  | { tratado: "liberado"; userId: string }
  | { tratado: "estornado" }
  | { tratado: "cancelada"; userId: string }
  | { tratado: "ignorado"; motivo: string };

export async function processarAviso(
  aviso: { evento: string | null; pagamentoId: string | null; autorizacaoId?: string | null },
  d: DepsAsaas,
): Promise<ResultadoAvisoAsaas> {
  if (aviso.evento && EVENTOS_DE_AUTORIZACAO.has(aviso.evento)) return await cancelamento(aviso.autorizacaoId ?? null, d);
  if (aviso.evento && EVENTOS_DE_ESTORNO.has(aviso.evento)) return await estorno(aviso.pagamentoId, d);
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
 * Estorno de cobrança Pix: o corpo só aponta a cobrança; a API diz se ela foi
 * mesmo devolvida (status de devolução ou lista de devoluções). Só revoga o que
 * NÓS creditamos (o banco sabe: `estornar_pagamento`, idempotente).
 */
async function estorno(id: string | null, d: DepsAsaas): Promise<ResultadoAvisoAsaas> {
  if (!id || !ID_COBRANCA.test(id)) return { tratado: "ignorado", motivo: "aviso sem id de cobrança" };
  const p = await ouNaoExiste(consultarCobranca(id));
  if (!p) return { tratado: "ignorado", motivo: "cobrança não existe no Asaas" };
  if (!STATUS_DEVOLVIDO.has(p.status) && (p.refunds?.length ?? 0) === 0) {
    return { tratado: "ignorado", motivo: "cobrança sem devolução" };
  }
  if (!d.estornar) throw new Error("webhook sem `estornar` configurado");
  const e = await d.estornar({ gateway: "asaas", gatewayPagamentoId: String(p.id) });
  if (e === "estornado") {
    console.error(`[asaas-webhook] estorno: cobrança ${p.id} (${p.status}) revogou o período.`);
    return { tratado: "estornado" };
  }
  return { tratado: "ignorado", motivo: e === "repetido" ? "estorno repetido" : "cobrança nunca creditada" };
}

/**
 * Autorização do Pix Automático cancelada ou recusada. O corpo só aponta o id;
 * a API diz o status e de quem é a autorização, e ela TEM que ser a guardada do
 * dono (aviso de outra autorização nunca muda o status; o banco confere de novo).
 */
async function cancelamento(id: string | null, d: DepsAsaas): Promise<ResultadoAvisoAsaas> {
  if (!id || !ID_AUTORIZACAO.test(id)) return { tratado: "ignorado", motivo: "aviso sem id de autorização" };
  const a = await ouNaoExiste(consultarAutorizacao(id));
  if (!a) return { tratado: "ignorado", motivo: "autorização não existe no Asaas" };
  if (a.status !== "CANCELLED" && a.status !== "REFUSED") return { tratado: "ignorado", motivo: `autorização ${a.status}` };
  if (!a.customerId) return { tratado: "ignorado", motivo: "autorização sem cliente" };

  const cliente = await ouNaoExiste(consultarCliente(a.customerId));
  const ref = lerReferencia(cliente?.externalReference);
  if (!ref) return { tratado: "ignorado", motivo: "cliente sem referência de assinatura" };

  const guardada = await d.autorizacaoGuardada(ref.userId);
  if (guardada?.gateway !== "asaas" || guardada.id !== a.id) {
    console.error(`[asaas-webhook] autorização ${a.id} ${a.status} não é a guardada do usuário ${ref.userId}: status mantido.`);
    return { tratado: "ignorado", motivo: "autorização não é a guardada" };
  }
  if (!d.marcar) throw new Error("webhook sem `marcar` configurado");
  const m = await d.marcar({ userId: ref.userId, gateway: "asaas", gatewayAssinaturaId: a.id });
  if (m === "cancelada") return { tratado: "cancelada", userId: ref.userId };
  return { tratado: "ignorado", motivo: `cancelamento ${m}` };
}

/**
 * A porta de entrada do aviso, sem Next no meio: 1º confere o token do cabeçalho,
 * 2º consulta a API do Asaas, 3º credita. Aviso sem token bom para no 1º passo:
 * não gasta chamada na API e não toca no banco.
 */
export async function receberAviso(
  aviso: { evento: string | null; pagamentoId: string | null; autorizacaoId?: string | null; token: string | null },
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
    return { status: 200, corpo: r.tratado === "ignorado" ? { tratado: "ignorado", motivo: r.motivo } : { tratado: r.tratado } };
  } catch (e) {
    return { status: 500, corpo: { erro: e instanceof Error ? e.message : "falha ao processar o aviso do Asaas" } };
  }
}
