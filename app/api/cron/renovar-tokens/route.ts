import { NextResponse, type NextRequest } from "next/server";
import { instagramDemonstracao } from "@/lib/env";
import { iguais } from "@/lib/cripto";
import { renovarTokensVencendo, reinscreverContasConectadas } from "@/lib/instagram";

/**
 * Renova os tokens do Instagram que vencem nos próximos 15 dias e, depois, inscreve de novo
 * todas as contas conectadas nos avisos de comentário (conserta a inscrição que falhou na
 * hora de conectar). Chamado 1x por dia pelo cron da Vercel (vercel.json), que manda
 * "Authorization: Bearer <CRON_SECRET>". Sem o segredo certo, 401.
 */
export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const veio = req.headers.get("authorization") ?? "";
  if (!segredo || !iguais(veio, `Bearer ${segredo}`)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  if (instagramDemonstracao) return NextResponse.json({ ok: true, pulado: "modo demonstração" });

  // as duas tarefas são independentes: se a renovação falhar, a reinscrição ainda roda
  let renovacao: Awaited<ReturnType<typeof renovarTokensVencendo>> | null = null;
  let erro: string | null = null;
  try {
    renovacao = await renovarTokensVencendo();
  } catch (e) {
    console.error("[cron/renovar-tokens]", (e as Error).message);
    erro = (e as Error).message;
  }
  let reinscricao: Awaited<ReturnType<typeof reinscreverContasConectadas>> | null = null;
  try {
    reinscricao = await reinscreverContasConectadas();
  } catch (e) {
    console.error("[cron/reinscrever]", (e as Error).message);
    erro ??= (e as Error).message;
  }
  if (erro) return NextResponse.json({ erro, ...renovacao, reinscricao }, { status: 500 });
  return NextResponse.json({ ok: true, ...renovacao, reinscricao });
}
