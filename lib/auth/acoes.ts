"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SITE_URL } from "../config";
import { faltaConfigurarBanco, usaSupabase, AVISO_SEM_CONFIGURACAO } from "../env";
import { createClient } from "../supabase/server";
import { dentroDaTaxa, ipDaRequisicao } from "../taxa";
import { agoraIso, ler, mudar, novoId } from "../local/banco";
import { REGRAS_DEMONSTRACAO } from "../regras";
import { aleatorio } from "../cripto";
import {
  COOKIE_SESSAO_LOCAL,
  criarSessaoLocal,
  hashSenha,
  senhaConfere,
} from "./sessao";

export type EstadoAuth = { erro?: string; aviso?: string; link?: string };

const SENHA_MINIMA = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Destino depois do login: só caminho interno ("//site.com" vira /painel). */
function destinoSeguro(pedido: unknown): string {
  const p = String(pedido ?? "");
  return p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : "/painel";
}

/** O Supabase responde em inglês: as mensagens mais comuns em português. */
function traduzir(mensagem: string): string {
  const mapa: Record<string, string> = {
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "Email not confirmed": "Falta confirmar o e-mail. Olha a caixa de entrada (e o spam).",
    "User already registered": "Esse e-mail já tem conta. Entra pela tela de login.",
  };
  if (/password/i.test(mensagem) && /least|short|weak/i.test(mensagem)) {
    return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres e não pode ser fácil de adivinhar.`;
  }
  return mapa[mensagem] ?? "Não deu certo agora. Tenta de novo em instantes.";
}

async function gravarSessaoLocal(userId: string) {
  const s = criarSessaoLocal(userId);
  (await cookies()).set(COOKIE_SESSAO_LOCAL, s.valor, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: s.maxAge,
  });
}

/* ------------------------------------------------------------------ entrar */

export async function entrar(_: EstadoAuth, form: FormData): Promise<EstadoAuth> {
  if (faltaConfigurarBanco) return { erro: AVISO_SEM_CONFIGURACAO };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const senha = String(form.get("senha") ?? "");
  if (!email || !senha) return { erro: "Preenche e-mail e senha." };

  // Freio de força bruta: por e-mail (o alvo) e por IP (quem ataca).
  const ip = await ipDaRequisicao();
  const [porEmail, porIp] = await Promise.all([
    dentroDaTaxa(`entrar:${email}`, 10, 900),
    dentroDaTaxa(`entrar-ip:${ip}`, 40, 900),
  ]);
  if (!porEmail || !porIp) {
    return { erro: "Muitas tentativas. Espera uns minutos e tenta de novo." };
  }

  if (usaSupabase) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) return { erro: traduzir(error.message) };
  } else {
    const u = ler().usuarios.find((x) => x.email === email);
    // mesma mensagem pra e-mail inexistente e senha errada
    if (!u || !senhaConfere(senha, u.senhaHash)) return { erro: "E-mail ou senha incorretos." };
    await gravarSessaoLocal(u.id);
  }

  revalidatePath("/", "layout");
  redirect(destinoSeguro(form.get("proximo")));
}

/* ---------------------------------------------------------------- cadastrar */

export async function cadastrar(_: EstadoAuth, form: FormData): Promise<EstadoAuth> {
  if (faltaConfigurarBanco) return { erro: AVISO_SEM_CONFIGURACAO };
  const nome = String(form.get("nome") ?? "").trim().slice(0, 80);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const senha = String(form.get("senha") ?? "");

  if (!nome) return { erro: "Como a gente te chama?" };
  if (!EMAIL.test(email)) return { erro: "Esse e-mail não parece certo." };
  if (senha.length < SENHA_MINIMA) {
    return { erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` };
  }
  if (form.get("aceite") !== "on") {
    return { erro: "Pra criar a conta, marca que leu e aceita os termos e a privacidade." };
  }

  // Por IP e folgado: cada cadastro manda um e-mail (cota do provedor), e IP
  // de operadora de celular junta muita gente.
  const ip = await ipDaRequisicao();
  if (!(await dentroDaTaxa(`cadastro-ip:${ip}`, 5, 3600))) {
    return { erro: "Muitas contas criadas daqui agora há pouco. Tenta mais tarde." };
  }

  if (usaSupabase) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      // o gatilho do banco (ao_criar_usuario) lê o nome daqui e abre os 7 dias
      options: { data: { nome }, emailRedirectTo: `${SITE_URL}/auth/confirmar` },
    });
    if (error) return { erro: traduzir(error.message) };
    // E-mail que já tem conta: o Supabase finge que deu certo (pra não revelar
    // quem é cliente) e devolve identities vazio.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return { erro: "Esse e-mail já tem conta. Entra pela tela de login (lá tem \"esqueci a senha\")." };
    }
    if (!data.session) {
      return { aviso: "Conta criada! Confirma o link que chegou no teu e-mail pra entrar." };
    }
  } else {
    const resultado = mudar((b) => {
      if (b.usuarios.some((u) => u.email === email)) return null;
      const id = novoId();
      const criadoEm = agoraIso();
      b.usuarios.push({ id, email, nome, senhaHash: hashSenha(senha), criadoEm });
      // o mesmo que o gatilho ao_criar_usuario faz no Supabase
      b.assinaturas.push({
        userId: id,
        status: "trial",
        trialAte: new Date(Date.parse(criadoEm) + REGRAS_DEMONSTRACAO.testeDias * 86400_000).toISOString(),
        periodoAte: null,
      });
      return id;
    });
    if (!resultado) return { erro: "Esse e-mail já tem conta. Entra pela tela de login." };
    await gravarSessaoLocal(resultado);
  }

  revalidatePath("/", "layout");
  redirect("/painel?bemvindo=1");
}

/* ------------------------------------------------------------ esqueci a senha */

const RESPOSTA_RECUPERAR =
  "Se existir conta com esse e-mail, o link pra trocar a senha já saiu. Olha a caixa de entrada e o spam.";

export async function recuperarSenha(_: EstadoAuth, form: FormData): Promise<EstadoAuth> {
  if (faltaConfigurarBanco) return { erro: AVISO_SEM_CONFIGURACAO };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { erro: "Esse e-mail não parece certo." };

  // A resposta é sempre a mesma (exista a conta ou não, estoure o limite ou
  // não): senão daria pra descobrir quem é cliente testando e-mails.
  const ip = await ipDaRequisicao();
  const [porEmail, porIp] = await Promise.all([
    dentroDaTaxa(`recuperar:${email}`, 3, 3600),
    dentroDaTaxa(`recuperar-ip:${ip}`, 10, 3600),
  ]);
  if (!porEmail || !porIp) return { aviso: RESPOSTA_RECUPERAR };

  if (usaSupabase) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${SITE_URL}/auth/confirmar?proximo=/nova-senha`,
    });
    return { aviso: RESPOSTA_RECUPERAR };
  }

  // Banco local: não existe e-mail na demonstração, então o link aparece na tela.
  const codigo = mudar((b) => {
    const u = b.usuarios.find((x) => x.email === email);
    if (!u) return null;
    const c = aleatorio(18);
    b.trocasDeSenha = b.trocasDeSenha.filter((t) => t.ate > Date.now());
    b.trocasDeSenha.push({ codigo: c, userId: u.id, ate: Date.now() + 30 * 60_000 });
    return c;
  });
  return {
    aviso: codigo
      ? "Modo demonstração: aqui não sai e-mail. Usa o link abaixo (vale 30 minutos)."
      : RESPOSTA_RECUPERAR,
    link: codigo ? `/nova-senha?codigo=${codigo}` : undefined,
  };
}

/* --------------------------------------------------------------- nova senha */

export async function trocarSenha(_: EstadoAuth, form: FormData): Promise<EstadoAuth> {
  if (faltaConfigurarBanco) return { erro: AVISO_SEM_CONFIGURACAO };
  const senha = String(form.get("senha") ?? "");
  if (senha.length < SENHA_MINIMA) {
    return { erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` };
  }

  if (usaSupabase) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // sem sessão = link vencido ou aberto fora do fluxo do e-mail
    if (!user) return { erro: "O link venceu. Pede outro em \"esqueci a senha\"." };
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) return { erro: traduzir(error.message) };
  } else {
    const codigo = String(form.get("codigo") ?? "");
    const userId = mudar((b) => {
      const t = b.trocasDeSenha.find((x) => x.codigo === codigo && x.ate > Date.now());
      if (!t) return null;
      b.trocasDeSenha = b.trocasDeSenha.filter((x) => x !== t);
      const u = b.usuarios.find((x) => x.id === t.userId);
      if (u) u.senhaHash = hashSenha(senha);
      return u?.id ?? null;
    });
    if (!userId) return { erro: "O link venceu. Pede outro em \"esqueci a senha\"." };
    await gravarSessaoLocal(userId);
  }

  revalidatePath("/", "layout");
  redirect("/painel");
}

/* -------------------------------------------------------------------- sair */

export async function sair() {
  if (usaSupabase) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } else {
    (await cookies()).delete(COOKIE_SESSAO_LOCAL);
  }
  revalidatePath("/", "layout");
  redirect("/");
}
