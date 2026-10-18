import { receberAviso } from "@/lib/mp-webhook";
import { registrarNoBanco } from "@/lib/registrar-pagamento";

/**
 * Webhook do Mercado Pago (cartão / assinatura recorrente).
 *
 * REGRA CENTRAL: o corpo que chega aqui NÃO é fonte de verdade. Dele sai só o
 * id; o status, o dono e o valor vêm da API do MP consultada com o nosso token
 * (lib/mp-webhook.ts, onde está a lógica e onde ela é testada). Liberar é
 * `registrar_pagamento` no banco, que confere o preço contra `regras` e é
 * idempotente pelo id do gateway: o MP reenvia o mesmo aviso várias vezes.
 *
 * Respostas: 401 aviso com assinatura errada, ausente ou sem segredo
 * configurado; 500 falhou ao consultar o MP ou ao gravar (ele reenvia); 200
 * liberado ou ignorado (nada a reenviar; valor divergente e cobrança de conta
 * excluída ignoram com ALERTA em nível de erro no log, porque o MP não reenvia).
 */
export async function GET() {
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const corpo = await request.json().catch(() => null) as {
    type?: string;
    topic?: string;
    data?: { id?: string | number };
    "data.id"?: string | number;
  } | null;

  const url = new URL(request.url);
  const tipo = corpo?.type ?? corpo?.topic ?? url.searchParams.get("type");
  // O MP assina o id que vai na URL (`data.id`); sem ele na URL, usa o do corpo.
  const bruto = url.searchParams.get("data.id") ?? corpo?.data?.id ?? corpo?.["data.id"] ?? null;
  const id = bruto == null ? null : String(bruto);

  const r = await receberAviso(
    { tipo, id, assinatura: request.headers.get("x-signature"), requestId: request.headers.get("x-request-id") },
    // erro do banco lança e vira 500 (lib/registrar-pagamento.ts): o MP reenvia
    registrarNoBanco,
  );
  if (r.status === 500) console.error("[mercadopago-webhook]", r.status, r.corpo.erro);
  return Response.json(r.corpo, { status: r.status });
}
