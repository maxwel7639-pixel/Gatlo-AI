import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { usaSupabase } from "../env";
import { createClient } from "../supabase/server";
import { ler } from "../local/banco";
import { hmac, iguais } from "../cripto";
import type { Usuario } from "../dados/tipos";
import { COOKIE_SESSAO_LOCAL } from "./nomes";

export { COOKIE_SESSAO_LOCAL };
const DURACAO_SESSAO_S = 7 * 24 * 3600;

/**
 * Quem está logado, ou null. Revalida no servidor a cada requisição
 * (getUser() no Supabase; assinatura do cookie no banco local): nunca confia
 * só no que o navegador mandou. `cache` evita repetir isso na mesma página.
 */
export const usuarioAtual = cache(async (): Promise<Usuario | null> => {
  if (usaSupabase) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: perfil } = await supabase
      .from("perfis")
      .select("nome")
      .eq("id", user.id)
      .maybeSingle();
    return { id: user.id, email: user.email ?? "", nome: perfil?.nome ?? null };
  }

  const valor = (await cookies()).get(COOKIE_SESSAO_LOCAL)?.value;
  const userId = lerSessaoLocal(valor);
  if (!userId) return null;
  const u = ler().usuarios.find((x) => x.id === userId);
  return u ? { id: u.id, email: u.email, nome: u.nome } : null;
});

/** Pra páginas e ações do painel: sem login, volta pra tela de entrar. */
export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/entrar");
  return u;
}

/* ------------------------------------------------ sessão do banco local */

export function criarSessaoLocal(userId: string): { valor: string; maxAge: number } {
  const ate = Math.floor(Date.now() / 1000) + DURACAO_SESSAO_S;
  const base = `${userId}.${ate}`;
  return { valor: `${base}.${hmac(ler().segredo, base)}`, maxAge: DURACAO_SESSAO_S };
}

export function lerSessaoLocal(valor: string | undefined): string | null {
  if (!valor) return null;
  const [userId, ate, assinatura] = valor.split(".");
  if (!userId || !ate || !assinatura) return null;
  if (Number(ate) * 1000 < Date.now()) return null;
  return iguais(hmac(ler().segredo, `${userId}.${ate}`), assinatura) ? userId : null;
}

/* ------------------------------------------------ senha do banco local */

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64);
  return `${sal.toString("base64url")}.${hash.toString("base64url")}`;
}

export function senhaConfere(senha: string, guardado: string): boolean {
  const [sal, hash] = guardado.split(".");
  if (!sal || !hash) return false;
  const calculado = scryptSync(senha, Buffer.from(sal, "base64url"), 64);
  const esperado = Buffer.from(hash, "base64url");
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}
