import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { usaSupabase } from "../env";
import { COOKIE_SESSAO_LOCAL } from "../auth/nomes";

/** Rotas que exigem login. */
const PROTEGIDAS = ["/painel"];
/** Quem já entrou não precisa ver estas: vai direto pro painel. */
const SO_DESLOGADO = ["/entrar", "/cadastro"];

/**
 * Roda antes de toda página (proxy.ts). Duas tarefas:
 * 1. no Supabase, renovar a sessão (o cookie de acesso vence a cada hora);
 * 2. mandar quem não entrou pra /entrar.
 *
 * Isto é a PRIMEIRA barreira, não a única: toda página e toda ação do painel
 * confere o usuário de novo no servidor (exigirUsuario). No banco local de
 * demonstração o proxy só olha se o cookie existe; quem confere a assinatura
 * do cookie é a página.
 */
export async function atualizarSessao(request: NextRequest) {
  let response = NextResponse.next({ request });
  let logado = false;

  if (usaSupabase) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    // getUser() confere o token no servidor do Supabase (não só o cookie).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    logado = Boolean(user);
  } else {
    logado = Boolean(request.cookies.get(COOKIE_SESSAO_LOCAL)?.value);
  }

  const { pathname } = request.nextUrl;

  if (!logado && PROTEGIDAS.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = "";
    url.searchParams.set("proximo", pathname);
    return NextResponse.redirect(url);
  }

  if (logado && SO_DESLOGADO.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/painel";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
