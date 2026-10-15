import { NextResponse, type NextRequest } from "next/server";
import { usuarioAtual } from "@/lib/auth/sessao";
import { COOKIE_ESTADO_OAUTH } from "@/lib/auth/nomes";
import { instagramDemonstracao } from "@/lib/env";
import { repo } from "@/lib/dados";
import { perfilDemo } from "@/lib/instagram/demo";
import { urlDeAutorizacao } from "@/lib/instagram/meta";
import { aleatorio } from "@/lib/cripto";
import { dentroDaTaxa } from "@/lib/taxa";

/**
 * Botão "Conectar Instagram".
 *
 * De verdade: sorteia um `state`, guarda num cookie (httpOnly, 10 min) junto
 * com o id de quem pediu e manda a pessoa pro login do Instagram. Na volta, o
 * /callback só aceita se o state bater (proteção contra alguém "conectar" o
 * Instagram dele na tua conta por um link forjado).
 *
 * Demonstração: conecta direto o perfil fictício.
 */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.redirect(`${origin}/entrar?proximo=/painel/conta`);

  if (!(await dentroDaTaxa(`conectar:${usuario.id}`, 20, 3600))) {
    return NextResponse.redirect(`${origin}/painel/conta?erro=muitas_tentativas`);
  }

  if (instagramDemonstracao) {
    const perfil = perfilDemo(usuario.id);
    const r = await repo().salvarConexao(usuario.id, {
      ...perfil,
      demonstracao: true,
      tokenCifrado: null,
      tokenExpiraEm: null,
      escopos: [],
    });
    return NextResponse.redirect(`${origin}${r.ok ? "/painel?conectado=1" : "/painel/conta?erro=ja_conectada"}`);
  }

  const estado = aleatorio(24);
  const resposta = NextResponse.redirect(urlDeAutorizacao(estado));
  resposta.cookies.set(COOKIE_ESTADO_OAUTH, `${estado}.${usuario.id}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax": o cookie volta junto quando o Instagram redireciona pra cá (GET de topo)
    sameSite: "lax",
    path: "/api/instagram",
    maxAge: 600,
  });
  return resposta;
}
