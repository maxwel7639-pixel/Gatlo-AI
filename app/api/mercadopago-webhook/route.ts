import { NextResponse, type NextRequest } from "next/server";
import { usaSupabase } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { receberAviso } from "@/lib/mp-webhook";

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
 * liberado ou ignorado (nada a reenviar).
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => null) as {
    type?: string;
    topic?: string;
    data?: { id?: string | number };
    "data.id"?: string | number;
  } | null;

  const tipo = corpo?.type ?? corpo?.topic ?? request.nextUrl.searchParams.get("type");
  // O MP assina o id que vai na URL (`data.id`); sem ele na URL, usa o do corpo.
  const bruto = request.nextUrl.searchParams.get("data.id") ?? corpo?.data?.id ?? corpo?.["data.id"] ?? null;
  const id = bruto == null ? null : String(bruto);

  const r = await receberAviso(
    { tipo, id, assinatura: request.headers.get("x-signature"), requestId: request.headers.get("x-request-id") },
    async (p) => {
      if (!usaSupabase) return false;
      const { data, error } = await createAdminClient().rpc("registrar_pagamento", {
        p_gateway: p.gateway,
        p_gateway_pagamento_id: p.gatewayPagamentoId,
        p_user_id: p.userId,
        p_valor_centavos: p.valorCentavos,
        p_gateway_assinatura_id: p.gatewayAssinaturaId,
      });
      // Erro do banco NÃO pode virar "ignorado" (200): o MP não reenviaria e o
      // pagamento confirmado ficaria sem crédito. Lança, e a resposta é 500.
      if (error) throw new Error(`registrar_pagamento: ${error.message}`);
      return data === true;
    },
  );
  if (r.status !== 200) console.error("[mercadopago-webhook]", r.status, r.corpo.erro);
  return NextResponse.json(r.corpo, { status: r.status });
}
