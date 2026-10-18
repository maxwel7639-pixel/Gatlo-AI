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

export type ResultadoAviso =
  | { tratado: "liberado"; userId: string }
  | { tratado: "ignorado"; motivo: string }
  | { tratado: "erro"; motivo: string };

export async function processarAviso(
  aviso: { tipo: string | null; id: string | null },
  registrar: (r: RegistroPagamento) => Promise<boolean>,
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
  registrar: (r: RegistroPagamento) => Promise<boolean>,
): Promise<{ status: 200 | 401 | 500; corpo: Record<string, string> }> {
  const conf = await assinaturaValida(aviso.assinatura, aviso.requestId, aviso.id);
  if (!conf.valida) return { status: 401, corpo: { erro: conf.motivo ?? "assinatura inválida" } };

  const r = await processarAviso(aviso, registrar);
  if (r.tratado === "erro") return { status: 500, corpo: { erro: r.motivo } };
  return { status: 200, corpo: r.tratado === "liberado" ? { tratado: "liberado" } : { tratado: "ignorado", motivo: r.motivo } };
}

async function creditar(
  referencia: string | null,
  valorReais: number | null,
  gatewayPagamentoId: string,
  gatewayAssinaturaId: string | null,
  registrar: (r: RegistroPagamento) => Promise<boolean>,
): Promise<ResultadoAviso> {
  // O dono vem da referência que a API devolveu, não do corpo do aviso.
  const ref = lerReferencia(referencia);
  if (!ref) return { tratado: "ignorado", motivo: "sem referência de assinatura" };
  if (valorReais == null) return { tratado: "ignorado", motivo: "sem valor" };

  const liberou = await registrar({
    gateway: "mercadopago",
    gatewayPagamentoId,
    userId: ref.userId,
    valorCentavos: Math.round(valorReais * 100),
    gatewayAssinaturaId,
  });

  // false: ou já tinha esse id registrado (aviso repetido) ou o valor não bateu
  // com o preço de `regras` — nos dois casos, nada mudou no banco.
  return liberou
    ? { tratado: "liberado", userId: ref.userId }
    : { tratado: "ignorado", motivo: "valor diferente do preço ou aviso repetido" };
}
