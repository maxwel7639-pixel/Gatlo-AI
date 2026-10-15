import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { usaSupabase } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino dos links de e-mail do Supabase (confirmar cadastro, trocar senha).
 *
 * Mesmo desenho do Fisga: o link aponta direto pra cá com um token de uso único
 * (token_hash) e o verifyOtp cria a sessão no servidor. Funciona abrindo o
 * e-mail em outro aparelho e não depende da lista de redirects do Supabase.
 * Os modelos de e-mail do Supabase precisam apontar pra cá (ver README).
 */
const TIPOS: EmailOtpType[] = ["signup", "recovery", "invite", "magiclink", "email_change", "email"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const tipo = searchParams.get("type") as EmailOtpType | null;
  // destino é entrada do usuário: só caminho interno
  const pedido = searchParams.get("proximo") ?? "";
  const proximo = pedido.startsWith("/") && !pedido.startsWith("//") && !pedido.startsWith("/\\") ? pedido : "/painel";

  if (!usaSupabase || !tokenHash || !tipo || !TIPOS.includes(tipo)) {
    return NextResponse.redirect(`${origin}/entrar?erro=link_invalido`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
  if (error) {
    console.error("[auth/confirmar]", tipo, error.message);
    return NextResponse.redirect(`${origin}/entrar?erro=link_expirado`);
  }
  // troca de senha sempre termina na tela de senha nova
  return NextResponse.redirect(`${origin}${tipo === "recovery" ? "/nova-senha" : proximo}`);
}
