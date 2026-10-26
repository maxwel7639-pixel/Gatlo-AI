import type { SupabaseClient } from "@supabase/supabase-js";
import { palavraQueBateu } from "./palavras.ts";

/**
 * O filtro do comentário e o insert na fila, iguais para as duas portas de entrada: o
 * webhook (gatilho-webhook, comentário em tempo real) e a leitura de reserva (gatilho-envia,
 * que lê os comentários na Meta enquanto o webhook não funciona). Mudou a regra? É aqui.
 */

export interface AutomacaoAtiva {
  id: string;
  qualquer_post: boolean;
  media_id: string | null;
  palavras: string[];
}

export interface NovoComentario {
  comment_id: string;
  user_id: string;
  conta_id: string;
  automacao_id: string;
  media_id: string;
  autor_ig_id: string | null;
  autor_username: string | null;
  texto: string;
  palavra: string;
  comentado_em: string;
}

// texto da coluna comentarios.texto: no máximo 2200 caracteres
const TEXTO_MAX = 2200;

/** Comentário da própria conta, ou resposta a outro comentário: nunca dispara. */
export function ehProprioOuResposta(igUserId: string, autorId: string | null, ehResposta: boolean): boolean {
  return autorId === igUserId || ehResposta;
}

/** Primeiro as automações do post, depois as de "qualquer post"; dentro de cada grupo, a mais antiga. */
export function escolherAutomacao<A extends AutomacaoAtiva>(
  automacoes: A[],
  mediaId: string,
  texto: string,
): { automacao: A; palavra: string } | null {
  const doPost = automacoes.filter((a) => !a.qualquer_post && a.media_id === mediaId);
  const dequalquer = automacoes.filter((a) => a.qualquer_post);
  for (const a of [...doPost, ...dequalquer]) {
    const palavra = palavraQueBateu(texto, a.palavras);
    if (palavra) return { automacao: a, palavra };
  }
  return null;
}

export function montarComentario(
  conta: { id: string; user_id: string },
  escolha: { automacao: { id: string }; palavra: string },
  c: {
    commentId: string;
    mediaId: string;
    autorId: string | null;
    autorUsername: string | null;
    texto: string;
    comentadoEm: string;
  },
): NovoComentario {
  return {
    comment_id: c.commentId,
    user_id: conta.user_id,
    conta_id: conta.id,
    automacao_id: escolha.automacao.id,
    media_id: c.mediaId,
    autor_ig_id: c.autorId,
    autor_username: c.autorUsername,
    texto: [...c.texto].slice(0, TEXTO_MAX).join(""),
    palavra: escolha.palavra,
    comentado_em: c.comentadoEm,
  };
}

/**
 * insert ... on conflict (comment_id) do nothing, com a service role. Devolve quantos
 * entraram (o comment_id que já existia não conta). upsert + ignoreDuplicates é o
 * "do nothing" do PostgREST; o select devolve só as linhas que entraram.
 */
export async function inserirComentarios(
  sb: SupabaseClient,
  comentarios: NovoComentario | NovoComentario[],
): Promise<number> {
  if (Array.isArray(comentarios) && comentarios.length === 0) return 0;
  const { data, error } = await sb
    .from("comentarios")
    .upsert(comentarios, { onConflict: "comment_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`comentarios: ${error.message}`);
  return data?.length ?? 0;
}
