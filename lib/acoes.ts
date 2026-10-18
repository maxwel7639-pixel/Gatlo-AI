"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirUsuario, COOKIE_SESSAO_LOCAL } from "./auth/sessao";
import { repo } from "./dados";
import { usaSupabase } from "./env";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import { mudar } from "./local/banco";
import { postsDaConta } from "./instagram";
import { lerFormulario, type Erros } from "./automacao-validar";
import { dentroDaTaxa } from "./taxa";
import { legendaCurta } from "./formato";
import { regras } from "./regras";
import { criarAssinatura } from "./mercadopago";

/**
 * As ações do painel. TODA ação começa com exigirUsuario(): o id do usuário
 * vem da sessão, nunca do formulário. O que vem do formulário é conferido de
 * novo aqui (o navegador pode mandar qualquer coisa).
 */

const UUID = /^[0-9a-f-]{36}$/i;

/* ------------------------------------------------------------ automações */

export type EstadoAutomacao = { erros?: Erros };

export async function salvarAutomacao(
  _: EstadoAutomacao,
  form: FormData,
): Promise<EstadoAutomacao> {
  const usuario = await exigirUsuario();
  const r = repo();

  if (!(await dentroDaTaxa(`salvar-automacao:${usuario.id}`, 60, 3600))) {
    return { erros: { geral: "Muitas alterações em pouco tempo. Espera uns minutos." } };
  }

  const conta = await r.contaInstagram(usuario.id);
  if (!conta || conta.status !== "conectada") {
    return { erros: { geral: "Conecta o Instagram antes de criar uma automação." } };
  }

  const { dados, erros } = lerFormulario(form);
  if (Object.keys(erros).length) return { erros };

  const id = String(form.get("id") ?? "");
  const existente = id && UUID.test(id) ? await r.automacao(usuario.id, id) : null;
  if (id && !existente) return { erros: { geral: "Essa automação não existe mais." } };

  // O post precisa ser DESTA conta. O retrato do post (link, miniatura,
  // legenda) vem da Meta pelo servidor, não do formulário. Editando sem trocar
  // de post, vale o que já estava (o post pode ter saído dos últimos 18).
  let retrato = { mediaPermalink: null as string | null, mediaMiniatura: null as string | null, mediaLegenda: null as string | null };
  if (dados.mediaId && existente && existente.mediaId === dados.mediaId) {
    retrato = {
      mediaPermalink: existente.mediaPermalink,
      mediaMiniatura: existente.mediaMiniatura,
      mediaLegenda: existente.mediaLegenda,
    };
  } else if (dados.mediaId) {
    const posts = await postsDaConta(conta);
    if (!posts.ok) return { erros: { geral: posts.erro } };
    const post = posts.posts.find((p) => p.id === dados.mediaId);
    if (!post) return { erros: { mediaId: "Esse post não está entre os últimos da tua conta. Escolhe de novo." } };
    retrato = {
      mediaPermalink: post.permalink,
      mediaMiniatura: post.miniatura,
      mediaLegenda: legendaCurta(post.legenda, 300),
    };
  }

  const completo = { ...dados, ...retrato };
  let destino: string;
  try {
    if (existente) {
      await r.atualizarAutomacao(usuario.id, id, completo);
      destino = `/painel/automacoes/${id}?salvo=1`;
    } else {
      const nova = await r.criarAutomacao(usuario.id, conta.id, completo);
      destino = `/painel/automacoes/${nova.id}?criada=1`;
    }
  } catch (e) {
    console.error("[salvarAutomacao]", (e as Error).message);
    return { erros: { geral: "Não consegui salvar agora. Tenta de novo." } };
  }

  revalidatePath("/painel", "layout");
  redirect(destino);
}

export async function alternarAutomacao(id: string, ativa: boolean) {
  const usuario = await exigirUsuario();
  if (!UUID.test(id)) return;
  const r = repo();
  if (ativa) {
    // ligar só com o Instagram conectado
    const conta = await r.contaInstagram(usuario.id);
    if (!conta || conta.status !== "conectada") redirect("/painel/conta?erro=desconectado");
  }
  await r.atualizarAutomacao(usuario.id, id, { ativa });
  revalidatePath("/painel", "layout");
}

export async function excluirAutomacao(id: string) {
  const usuario = await exigirUsuario();
  if (!UUID.test(id)) return;
  await repo().excluirAutomacao(usuario.id, id);
  revalidatePath("/painel", "layout");
  redirect("/painel/automacoes?excluida=1");
}

/** Só no modo demonstração (o repositório recusa conta de verdade). */
export async function simularComentarios(id: string) {
  const usuario = await exigirUsuario();
  if (!UUID.test(id)) return;
  if (!(await dentroDaTaxa(`simular:${usuario.id}`, 30, 600))) return;
  await repo().simularComentarios(usuario.id, id);
  revalidatePath(`/painel/automacoes/${id}`);
  revalidatePath("/painel");
}

/* ------------------------------------------------------------- Instagram */

export async function desconectarInstagram() {
  const usuario = await exigirUsuario();
  await repo().desconectar(usuario.id);
  revalidatePath("/painel", "layout");
  redirect("/painel/conta?desconectado=1");
}

/* ------------------------------------------------------------ excluir conta */

export type EstadoExclusao = { erro?: string };

/**
 * Apaga a conta e tudo ligado a ela (o banco apaga em cascata: perfil,
 * assinatura, Instagram e token, automações, comentários, cliques).
 * Pagamentos ficam sem dono (lei fiscal).
 */
export async function excluirConta(_: EstadoExclusao, form: FormData): Promise<EstadoExclusao> {
  const usuario = await exigirUsuario();
  if (String(form.get("confirmacao") ?? "").trim().toUpperCase() !== "EXCLUIR") {
    return { erro: "Digita EXCLUIR pra confirmar." };
  }

  if (usaSupabase) {
    const { error } = await createAdminClient().auth.admin.deleteUser(usuario.id);
    if (error) {
      console.error("[excluirConta]", error.message);
      return { erro: "Não consegui excluir agora. Tenta de novo ou escreve pro suporte." };
    }
    await (await createClient()).auth.signOut();
  } else {
    mudar((b) => {
      const contas = new Set(b.contas.filter((c) => c.userId === usuario.id).map((c) => c.id));
      b.usuarios = b.usuarios.filter((u) => u.id !== usuario.id);
      b.assinaturas = b.assinaturas.filter((a) => a.userId !== usuario.id);
      b.contas = b.contas.filter((c) => c.userId !== usuario.id);
      b.automacoes = b.automacoes.filter((a) => a.userId !== usuario.id);
      b.comentarios = b.comentarios.filter((c) => c.userId !== usuario.id);
      b.cliques = b.cliques.filter((c) => c.userId !== usuario.id);
      b.pausas = b.pausas.filter((p) => !contas.has(p.contaId));
    });
    (await cookies()).delete(COOKIE_SESSAO_LOCAL);
  }

  revalidatePath("/", "layout");
  redirect("/entrar?erro=conta_excluida");
}

/* --------------------------------------------------------------- assinar */

export type EstadoAssinatura = { erro?: string };

/**
 * Abre o checkout da assinatura no cartão (Mercado Pago). O preço NÃO vem do
 * navegador: o servidor lê `regras.preco_mensal_centavos` e manda pro MP. O
 * robô só é liberado depois que o webhook do MP confirma o pagamento na API
 * (lib/mp-webhook.ts) — este botão não libera nada sozinho.
 */
export async function assinarCartao(): Promise<EstadoAssinatura> {
  const usuario = await exigirUsuario();
  if (!usaSupabase) {
    return { erro: "No modo demonstração não dá pra assinar: aqui não passa cartão de ninguém." };
  }
  if (!(await dentroDaTaxa(`assinar:${usuario.id}`, 5, 3600))) {
    return { erro: "Muitas tentativas de assinatura numa hora. Espera um pouco e tenta de novo." };
  }

  let url: string;
  try {
    // Já ativa: um 2º checkout viraria cobrança dobrada. A tela esconde o botão,
    // mas a ação confere de novo (o navegador pode mandar qualquer coisa).
    if ((await repo().situacao(usuario.id))?.status === "ativa") {
      return { erro: "A tua assinatura já está ativa." };
    }
    const r = await regras();
    url = await criarAssinatura({ userId: usuario.id, email: usuario.email, precoCentavos: r.precoMensalCentavos });
  } catch (e) {
    console.error("[assinarCartao]", e instanceof Error ? e.message : e);
    return { erro: "Não deu pra abrir a assinatura agora. Tenta de novo em instantes." };
  }
  // O redirect joga a página fora: tem que ficar FORA do try/catch, senão o
  // Next engole o NEXT_REDIRECT como se fosse erro.
  redirect(url);
}
