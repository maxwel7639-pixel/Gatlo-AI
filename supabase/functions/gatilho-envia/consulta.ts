import {
  type AutomacaoAtiva,
  ehProprioOuResposta,
  escolherAutomacao,
  montarComentario,
  type NovoComentario,
} from "../_shared/comentario.ts";
import { ehLimite, type Meta, type RespostaMeta, textoDoErro } from "./meta.ts";

/**
 * A leitura de reserva: enquanto o app da Meta não está Live com acesso avançado, o webhook
 * não recebe nada, então a própria rodada do envio vai ler os comentários na Meta e põe os
 * novos na MESMA fila do webhook (mesmo filtro e mesmo insert: _shared/comentario.ts).
 * Roda por conta, antes de montar a fila de envio, para o comentário sair na DM da mesma rodada.
 */

export interface AutomacaoLeitura extends AutomacaoAtiva {
  criado_em: string;
}

export interface ConsultaConta {
  conta: { id: string; user_id: string; ig_user_id: string };
  /** só as automações ATIVAS da conta */
  automacoes: AutomacaoLeitura[];
  meta: Meta;
  /** insert ... on conflict (comment_id) do nothing; devolve quantos entraram */
  registrar: (lista: NovoComentario[]) => Promise<number>;
  regras: { consultaPostsRecentesDias: number; consultaPostsPorRodada: number; filaJanelaDias: number };
  agora: number;
  /** Intervalo do agendador: a janela de posts avança uma posição por rodada. */
  rodadaMs: number;
  estourou: () => boolean;
}

export type ResultadoConsulta = {
  /** chamadas de "comentários de um post" feitas */
  leituras: number;
  /** comentários que entraram na fila agora */
  novos: number;
  /** a Meta mandou esperar: parou de ler a conta nesta rodada */
  limite: boolean;
  /** o orçamento de tempo da rodada acabou no meio da leitura */
  orcamento: boolean;
};

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Rodízio: no máximo `max` posts por rodada, e a janela avança uma posição a cada rodada
 * (rodada = `agora` dividido pelo intervalo do agendador). Com mais posts do que cabem, todos
 * são atendidos em `posts.length` rodadas seguidas: nenhum fica sempre de fora.
 */
function janelaDePosts(posts: string[], max: number, rodada: number): string[] {
  if (posts.length <= max) return posts;
  const inicio = rodada % posts.length;
  return Array.from({ length: max }, (_, i) => posts[(inicio + i) % posts.length]);
}

/**
 * Comentário que já tem resposta não entra (como no robô do @maxwel_dev), a não ser que a API
 * mostre o autor de TODAS as respostas e nenhuma seja da própria conta: aí quem respondeu foi
 * outra pessoa e o comentário continua valendo. Autor desconhecido = conservador (não entra).
 */
function respondidoPelaConta(respostas: RespostaMeta[], igUserId: string): boolean {
  return respostas.some((r) => r.autorId === null || r.autorId === igUserId);
}

export async function consultarConta(a: ConsultaConta): Promise<ResultadoConsulta> {
  const { conta, automacoes, meta, regras } = a;
  const r: ResultadoConsulta = { leituras: 0, novos: 0, limite: false, orcamento: false };
  const falhaMeta = (o: string, erro: Parameters<typeof textoDoErro>[0]) =>
    // só o id da conta e o motivo da Meta: nada de texto de comentário nem token
    console.error(`[gatilho-envia] conta ${conta.id}: leitura (${o}): ${textoDoErro(erro)}`);

  // 1. os posts: os das automações de post específico + (se há "qualquer post") os recentes
  const posts = new Set<string>();
  for (const x of automacoes) if (!x.qualquer_post && x.media_id) posts.add(x.media_id);
  if (automacoes.some((x) => x.qualquer_post)) {
    if (a.estourou()) return { ...r, orcamento: true };
    const lista = await meta.listarPosts();
    if (!lista.ok) {
      if (ehLimite(lista.erro)) return { ...r, limite: true };
      falhaMeta("posts", lista.erro); // os posts específicos ainda são lidos
    } else {
      const desde = a.agora - regras.consultaPostsRecentesDias * DIA_MS;
      for (const p of lista.itens) {
        const quando = Date.parse(p.timestamp ?? "");
        if (Number.isFinite(quando) && quando >= desde) posts.add(p.id);
      }
    }
  }

  // 2. no máximo M posts por rodada, em rodízio; 1 leitura por post
  const lerAgora = janelaDePosts([...posts], regras.consultaPostsPorRodada, Math.floor(a.agora / a.rodadaMs));
  const desdeJanela = a.agora - regras.filaJanelaDias * DIA_MS;
  for (const postId of lerAgora) {
    if (a.estourou()) return { ...r, orcamento: true };
    const lida = await meta.listarComentarios(postId);
    r.leituras++;
    if (!lida.ok) {
      if (ehLimite(lida.erro)) return { ...r, limite: true };
      falhaMeta(`post ${postId}`, lida.erro);
      continue; // esse post fica para a próxima rodada; os outros seguem
    }

    const lote: NovoComentario[] = [];
    for (const c of lida.itens) {
      // sem data não dá para saber se veio depois da automação nem se está na janela
      const quando = Date.parse(c.timestamp ?? "");
      if (!Number.isFinite(quando) || quando <= desdeJanela) continue;
      if (ehProprioOuResposta(conta.ig_user_id, c.autorId, false)) continue; // /comments só lista comentários de topo
      if (respondidoPelaConta(c.respostas, conta.ig_user_id)) continue;
      // só valem as automações que já existiam quando a pessoa comentou
      const existentes = automacoes.filter((x) => Date.parse(x.criado_em) < quando);
      const escolha = escolherAutomacao(existentes, postId, c.texto);
      if (!escolha) continue;
      lote.push(montarComentario(conta, escolha, {
        commentId: c.id,
        mediaId: postId,
        autorId: c.autorId,
        autorUsername: c.autorUsername ?? c.username,
        texto: c.texto,
        comentadoEm: new Date(quando).toISOString(),
      }));
    }
    r.novos += await a.registrar(lote);
  }
  return r;
}
