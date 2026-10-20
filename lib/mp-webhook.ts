import { consultarAssinatura, consultarPagamento, lerReferencia } from "./mercadopago";
import { assinaturaValida } from "./mp-assinatura";

/**
 * O NÚCLEO DO WEBHOOK DO MERCADO PAGO, sem rota e sem banco no meio (a rota é
 * fina: app/api/mercadopago-webhook/route.ts; quem chama o banco é injetado).
 *
 * QUALQUER UM NA INTERNET consegue mandar um POST nessa URL dizendo "pagamento
 * aprovado, libera o robô pra mim". Por isso o corpo do aviso vale só como
 * PISTA de id: o status, o dono e o valor vêm da API do MP consultada com o
 * nosso token (lib/mercadopago.ts). Assim um aviso forjado não credita nada.
 *
 * Liberar de verdade é `registrar_pagamento` no banco (0001_esquema.sql): ele
 * confere o valor contra `regras.preco_mensal_centavos`, é idempotente pelo id
 * do gateway (o MP reenvia o mesmo aviso) e empurra o período em 1 mês. A
 * dependência `registrar` é injetada para os testes rodarem com o banco de
 * verdade (PGlite) sem rede.
 */

export type RegistroPagamento = {
  gateway: "mercadopago" | "asaas";
  gatewayPagamentoId: string;
  userId: string;
  valorCentavos: number;
  gatewayAssinaturaId: string | null;
};

/** O que o banco respondeu (registrar_pagamento, migration 0005). */
export type ResultadoRegistro = "liberado" | "repetido" | "valor_divergente" | "preapproval_divergente" | "sem_usuario";
export type Registrar = (r: RegistroPagamento) => Promise<ResultadoRegistro>;

/** O que o banco respondeu a `estornar_pagamento` (migration 0007). */
export type ResultadoEstorno = "estornado" | "repetido" | "desconhecido";
export type Estornar = (e: { gateway: "mercadopago" | "asaas"; gatewayPagamentoId: string }) => Promise<ResultadoEstorno>;

/** O que o banco respondeu a `marcar_assinatura` (migration 0007). */
export type ResultadoMarcar = "cancelada" | "repetida" | "nao_guardada" | "sem_efeito" | "sem_usuario";
export type Marcar = (m: { userId: string; gateway: "mercadopago" | "asaas"; gatewayAssinaturaId: string }) => Promise<ResultadoMarcar>;

/** Quem testa só um pedaço pode omitir; o que faltar e for preciso LANÇA (rota 500, o gateway reenvia: falha fechada). */
export type DepsMP = {
  estornar?: Estornar;
  marcar?: Marcar;
  /** Cancela no gateway a assinatura guardada do usuário (lib/cancelar-servidor.ts). Lança se não conseguir. */
  cancelar?: (userId: string) => Promise<unknown>;
};

export type ResultadoAviso =
  | { tratado: "liberado"; userId: string }
  | { tratado: "estornado" }
  | { tratado: "cancelada"; userId: string }
  | { tratado: "ignorado"; motivo: string }
  | { tratado: "erro"; motivo: string };

export async function processarAviso(
  aviso: { tipo: string | null; id: string | null },
  registrar: Registrar,
  d: DepsMP = {},
): Promise<ResultadoAviso> {
  const tipo = aviso.tipo ?? "";
  const id = aviso.id;
  if (!id) return { tratado: "ignorado", motivo: "aviso sem id" };

  try {
    if (tipo === "preapproval" || tipo === "subscription_preapproval") {
      // Assinatura autorizada NÃO é dinheiro na conta: quem credita é o pagamento
      // (tipo "payment", com o id dele). Creditar aqui também empurraria o 1º mês
      // duas vezes, porque o id do preapproval e o do pagamento são diferentes e
      // o `registrar_pagamento` só barra id repetido. O que este aviso muda é o
      // CANCELAMENTO, e só depois de a API do MP confirmar que o preapproval está
      // cancelado (o corpo do aviso não vale nada).
      const pa = await consultarAssinatura(id);
      if (pa.status !== "cancelled") return { tratado: "ignorado", motivo: "assinatura: o crédito vem do pagamento" };
      const ref = lerReferencia(pa.external_reference);
      if (!ref) return { tratado: "ignorado", motivo: "sem referência de assinatura" };
      if (!d.marcar) throw new Error("webhook sem `marcar` configurado");
      const m = await d.marcar({ userId: ref.userId, gateway: "mercadopago", gatewayAssinaturaId: String(pa.id ?? id) });
      if (m === "cancelada") return { tratado: "cancelada", userId: ref.userId };
      if (m === "nao_guardada") {
        console.error(`[mercadopago-webhook] preapproval ${id} cancelado não é o guardado do usuário ${ref.userId}: status mantido.`);
      }
      return { tratado: "ignorado", motivo: `cancelamento ${m}` };
    }

    if (tipo === "payment") {
      // A cobrança de dentro da assinatura (a 1ª e as mensais), com o id dela.
      const p = await consultarPagamento(id);
      // Estorno e chargeback: a API é que diz. Total (`refunded`, `charged_back` ou tudo
      // devolvido) tira o mês E cancela a assinatura no gateway. Devolução PARCIAL
      // não tira nada: só alerta (e antes do crédito segue sem creditar, como no C1).
      const devolvido = p.transaction_amount_refunded ?? 0;
      const total = p.status === "refunded" || p.status === "charged_back" ||
        (p.status === "approved" && devolvido > 0 && devolvido >= (p.transaction_amount ?? Infinity));
      if (!total && p.status === "approved" && devolvido > 0) {
        console.error(`[mercadopago-webhook] ALERTA devolucao_parcial: pagamento ${p.id} teve ${devolvido} de ${p.transaction_amount} devolvidos; nada foi revogado. Conferir no MP.`);
        return { tratado: "ignorado", motivo: "pagamento com devolução" };
      }
      if (total) {
        if (!d.estornar || !d.cancelar) throw new Error("webhook sem `estornar`/`cancelar` configurado");
        const e = await d.estornar({ gateway: "mercadopago", gatewayPagamentoId: String(p.id) });
        // nunca creditamos esse pagamento: não há o que tirar nem o que cancelar
        if (e === "desconhecido") return { tratado: "ignorado", motivo: "pagamento com devolução" };
        // `estornado` ou `repetido`: cancela a guardada (no reenvio depois de falha tenta de novo; falhar = 500)
        const ref = lerReferencia(p.external_reference);
        if (ref) await d.cancelar(ref.userId);
        else console.error(`[mercadopago-webhook] ALERTA estorno_sem_dono: pagamento ${p.id} estornado sem referência de usuário; cancelar a assinatura no MP à mão.`);
        if (e === "repetido") return { tratado: "ignorado", motivo: "estorno repetido" };
        console.error(`[mercadopago-webhook] estorno: pagamento ${p.id} (${p.status}) revogou o período e cancelou a assinatura.`);
        return { tratado: "estornado" };
      }
      if (p.status !== "approved") return { tratado: "ignorado", motivo: `pagamento ${p.status}` };
      // Aprovado não basta: tem que ser em reais.
      if (p.currency_id !== "BRL") return { tratado: "ignorado", motivo: `moeda ${p.currency_id ?? "(vazia)"}` };
      return await creditar(p.external_reference, p.transaction_amount, String(p.id), p.preapproval_id, registrar);
    }

    return { tratado: "ignorado", motivo: `tipo ${tipo || "(vazio)"}` };
  } catch (e) {
    // Falhou ao consultar: responde erro pra o MP reenviar depois (pagamento
    // confirmado não se perde por um soluço de rede).
    return { tratado: "erro", motivo: e instanceof Error ? e.message : "falha ao consultar o Mercado Pago" };
  }
}

/**
 * A porta de entrada do aviso, sem Next no meio (a rota só traduz para HTTP e
 * é testada por aqui): 1º confere a assinatura secreta do cabeçalho, 2º consulta
 * a API do MP, 3º credita. Aviso sem assinatura boa para no 1º passo: não gasta
 * chamada na API do MP e não toca no banco.
 */
export async function receberAviso(
  aviso: { tipo: string | null; id: string | null; assinatura: string | null; requestId: string | null },
  registrar: Registrar,
  d: DepsMP = {},
): Promise<{ status: 200 | 401 | 500; corpo: Record<string, string> }> {
  const conf = await assinaturaValida(aviso.assinatura, aviso.requestId, aviso.id);
  if (!conf.valida) {
    // O motivo detalhado ajuda quem configura (vai pro log do servidor), mas não
    // pode ir na resposta: o webhook é público e diria a qualquer anônimo o que falta.
    console.error(`[mercadopago-webhook] 401: ${conf.motivo ?? "assinatura inválida"}`);
    return { status: 401, corpo: { erro: "não autorizado" } };
  }

  const r = await processarAviso(aviso, registrar, d);
  if (r.tratado === "erro") return { status: 500, corpo: { erro: r.motivo } };
  return { status: 200, corpo: r.tratado === "ignorado" ? { tratado: "ignorado", motivo: r.motivo } : { tratado: r.tratado } };
}

async function creditar(
  referencia: string | null,
  valorReais: number | null,
  gatewayPagamentoId: string,
  gatewayAssinaturaId: string | null,
  registrar: Registrar,
): Promise<ResultadoAviso> {
  // O dono vem da referência que a API devolveu, não do corpo do aviso.
  const ref = lerReferencia(referencia);
  if (!ref) return { tratado: "ignorado", motivo: "sem referência de assinatura" };
  if (valorReais == null) return { tratado: "ignorado", motivo: "sem valor" };

  const resultado = await registrar({
    gateway: "mercadopago",
    gatewayPagamentoId,
    userId: ref.userId,
    valorCentavos: Math.round(valorReais * 100),
    gatewayAssinaturaId,
  });

  if (resultado === "liberado") return { tratado: "liberado", userId: ref.userId };

  // Os casos abaixo são DINHEIRO QUE O MP COBROU E NÃO LIBEROU NADA: o MP não
  // reenvia (a rota responde 200), então o aviso tem que sair daqui, em nível de
  // erro, para o Maxwel ver no log da Vercel e resolver (ajustar o valor ou estornar).
  if (resultado === "valor_divergente") {
    console.error(
      `[mercadopago-webhook] ALERTA valor_divergente: pagamento ${gatewayPagamentoId} do usuário ${ref.userId} pagou ${valorReais} e não liberou. Conferir regras.preco_mensal_centavos e o preapproval ${gatewayAssinaturaId}.`,
    );
  } else if (resultado === "preapproval_divergente") {
    console.error(
      `[mercadopago-webhook] ALERTA preapproval_divergente: pagamento ${gatewayPagamentoId} do usuário ${ref.userId} veio do preapproval ${gatewayAssinaturaId ?? "(nenhum)"}, que não é o guardado dele, e não liberou. Conferir no MP e estornar se for o caso.`,
    );
  } else if (resultado === "sem_usuario") {
    console.error(
      `[mercadopago-webhook] ALERTA cobranca_orfa: pagamento ${gatewayPagamentoId} de ${valorReais} para um usuário que não existe mais (${ref.userId}). Cancelar o preapproval ${gatewayAssinaturaId} e estornar.`,
    );
  }
  return { tratado: "ignorado", motivo: resultado === "repetido" ? "aviso repetido" : resultado };
}
