import { consultarPagamento, lerReferencia } from "./mercadopago";
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
  gateway: "mercadopago";
  gatewayPagamentoId: string;
  userId: string;
  valorCentavos: number;
  gatewayAssinaturaId: string | null;
};

/** O que o banco respondeu (registrar_pagamento, migration 0005). */
export type ResultadoRegistro = "liberado" | "repetido" | "valor_divergente" | "preapproval_divergente" | "sem_usuario";
type Registrar = (r: RegistroPagamento) => Promise<ResultadoRegistro>;

export type ResultadoAviso =
  | { tratado: "liberado"; userId: string }
  | { tratado: "ignorado"; motivo: string }
  | { tratado: "erro"; motivo: string };

export async function processarAviso(
  aviso: { tipo: string | null; id: string | null },
  registrar: Registrar,
): Promise<ResultadoAviso> {
  const tipo = aviso.tipo ?? "";
  const id = aviso.id;
  if (!id) return { tratado: "ignorado", motivo: "aviso sem id" };

  try {
    if (tipo === "preapproval") {
      // Assinatura autorizada NÃO é dinheiro na conta: quem credita é o pagamento
      // (tipo "payment", com o id dele). Creditar aqui também empurraria o 1º mês
      // duas vezes, porque o id do preapproval e o do pagamento são diferentes e
      // o `registrar_pagamento` só barra id repetido.
      return { tratado: "ignorado", motivo: "assinatura: o crédito vem do pagamento" };
    }

    if (tipo === "payment") {
      // A cobrança de dentro da assinatura (a 1ª e as mensais), com o id dela.
      const p = await consultarPagamento(id);
      if (p.status !== "approved") return { tratado: "ignorado", motivo: `pagamento ${p.status}` };
      // Aprovado não basta: tem que ser em reais e sem devolução. (Estorno depois
      // do crédito e chargeback são do C3: revogar o período.)
      if (p.currency_id !== "BRL") return { tratado: "ignorado", motivo: `moeda ${p.currency_id ?? "(vazia)"}` };
      if ((p.transaction_amount_refunded ?? 0) > 0) return { tratado: "ignorado", motivo: "pagamento com devolução" };
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
): Promise<{ status: 200 | 401 | 500; corpo: Record<string, string> }> {
  const conf = await assinaturaValida(aviso.assinatura, aviso.requestId, aviso.id);
  if (!conf.valida) {
    // O motivo detalhado ajuda quem configura (vai pro log do servidor), mas não
    // pode ir na resposta: o webhook é público e diria a qualquer anônimo o que falta.
    console.error(`[mercadopago-webhook] 401: ${conf.motivo ?? "assinatura inválida"}`);
    return { status: 401, corpo: { erro: "não autorizado" } };
  }

  const r = await processarAviso(aviso, registrar);
  if (r.tratado === "erro") return { status: 500, corpo: { erro: r.motivo } };
  return { status: 200, corpo: r.tratado === "liberado" ? { tratado: "liberado" } : { tratado: "ignorado", motivo: r.motivo } };
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
