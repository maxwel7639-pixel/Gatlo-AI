import { NextResponse } from "next/server";
import { repo } from "@/lib/dados";
import { signedRequestDoCorpo } from "@/lib/instagram/avisos-meta";

/**
 * "Deauthorize callback URL" do app da Meta: a pessoa removeu o app nas
 * configurações do Instagram. Apagamos o token e pausamos as automações.
 * Só vale com a assinatura da Meta certa (lib/instagram/avisos-meta.ts).
 */
export async function POST(req: Request) {
  const dados = await signedRequestDoCorpo(req);
  if (!dados?.user_id) return NextResponse.json({ erro: "aviso inválido" }, { status: 400 });
  const n = await repo().desconectarPorInstagram([String(dados.user_id)]);
  console.log(`[desautorizar] ${n} conta(s) desconectada(s)`);
  return NextResponse.json({ ok: true });
}
