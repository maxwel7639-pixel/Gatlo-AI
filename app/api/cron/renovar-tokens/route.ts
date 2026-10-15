import { NextResponse, type NextRequest } from "next/server";
import { instagramDemonstracao } from "@/lib/env";
import { iguais } from "@/lib/cripto";
import { renovarTokensVencendo } from "@/lib/instagram";

/**
 * Renova os tokens do Instagram que vencem nos próximos 15 dias.
 * Chamado 1x por dia pelo cron da Vercel (vercel.json), que manda
 * "Authorization: Bearer <CRON_SECRET>". Sem o segredo certo, 401.
 */
export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const veio = req.headers.get("authorization") ?? "";
  if (!segredo || !iguais(veio, `Bearer ${segredo}`)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  if (instagramDemonstracao) return NextResponse.json({ ok: true, pulado: "modo demonstração" });

  try {
    return NextResponse.json({ ok: true, ...(await renovarTokensVencendo()) });
  } catch (e) {
    console.error("[cron/renovar-tokens]", (e as Error).message);
    return NextResponse.json({ erro: (e as Error).message }, { status: 500 });
  }
}
