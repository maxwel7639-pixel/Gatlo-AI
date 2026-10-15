import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
import { usaSupabase } from "@/lib/env";
import { repo } from "@/lib/dados";
import { createAdminClient } from "@/lib/supabase/admin";
import { aleatorio } from "@/lib/cripto";
import { signedRequestDoCorpo } from "@/lib/instagram/avisos-meta";

/**
 * "Data deletion request URL" do app da Meta: a pessoa pediu, pelo Instagram,
 * pra apagar os dados que o app tem dela. Apagamos a conta do Instagram ligada
 * (e em cascata token, automações, comentários e cliques) e devolvemos à Meta
 * o código e o link onde a pessoa acompanha (/exclusao-de-dados?codigo=...).
 */
export async function POST(req: Request) {
  const dados = await signedRequestDoCorpo(req);
  if (!dados?.user_id) return NextResponse.json({ erro: "aviso inválido" }, { status: 400 });

  const igId = String(dados.user_id);
  const codigo = aleatorio(12);
  const admin = usaSupabase ? createAdminClient() : null;

  await admin?.from("pedidos_exclusao").insert({ codigo, ig_app_id: igId });
  const apagadas = await repo().apagarPorInstagram([igId]);
  await admin
    ?.from("pedidos_exclusao")
    .update({ concluido_em: new Date().toISOString(), contas_apagadas: apagadas })
    .eq("codigo", codigo);

  return NextResponse.json({
    url: `${SITE_URL}/exclusao-de-dados?codigo=${codigo}`,
    confirmation_code: codigo,
  });
}
