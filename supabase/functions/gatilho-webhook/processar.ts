import { palavraQueBateu } from "../_shared/palavras.ts";

/**
 * A lógica do webhook de comentários, separada do banco: tudo que ela precisa
 * do mundo de fora passa por esta interface pequena. Em produção quem responde
 * é banco_supabase.ts (service role); nos testes, um Postgres de verdade.
 */
export interface ContaAlvo {
  id: string;
  user_id: string;
}

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

export interface Banco {
  /** Conta com ig_user_id igual, status "conectada" e demonstracao = false; ou null. */
  acharContaConectada(igUserId: string): Promise<ContaAlvo | null>;
  /** Automações com ativa = true da conta, da mais antiga pra mais nova. */
  automacoesAtivas(contaId: string): Promise<AutomacaoAtiva[]>;
  /** insert ... on conflict (comment_id) do nothing. true = gravou, false = já existia. */
  registrarComentario(comentario: NovoComentario): Promise<boolean>;
}

export type Resumo = {
  gravados: number;
  /** já estavam na fila (a Meta reenviou) */
  repetidos: number;
  /** própria conta, resposta, conta desconhecida, sem automação ou sem palavra */
  ignorados: number;
  erros: number;
};

// texto da coluna comentarios.texto: no máximo 2200 caracteres
const TEXTO_MAX = 2200;

const comoTexto = (v: unknown): string | null =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** O momento do evento: a Meta manda `entry.time` em segundos e não data o comentário em si. */
function quando(tempo: unknown): string {
  const s = typeof tempo === "number" ? tempo : Number(tempo);
  const d = Number.isFinite(s) && s > 0 ? new Date(s * 1000) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Primeiro as automações do post, depois as de "qualquer post"; dentro de cada grupo, a mais antiga. */
function escolherAutomacao(
  automacoes: AutomacaoAtiva[],
  mediaId: string,
  texto: string,
): { automacao: AutomacaoAtiva; palavra: string } | null {
  const doPost = automacoes.filter((a) => !a.qualquer_post && a.media_id === mediaId);
  const dequalquer = automacoes.filter((a) => a.qualquer_post);
  for (const a of [...doPost, ...dequalquer]) {
    const palavra = palavraQueBateu(texto, a.palavras);
    if (palavra) return { automacao: a, palavra };
  }
  return null;
}

/**
 * Processa o corpo (já com a assinatura conferida) de um webhook da Meta.
 * Um comentário com problema não derruba os outros: o erro é registrado e segue.
 */
export async function processarCorpo(banco: Banco, corpo: unknown): Promise<Resumo> {
  const resumo: Resumo = { gravados: 0, repetidos: 0, ignorados: 0, erros: 0 };
  const entradas = objeto(corpo)?.entry;
  if (!Array.isArray(entradas)) return resumo;

  // numa mesma entrega vêm vários comentários da mesma conta: consulta uma vez só
  const contas = new Map<string, ContaAlvo | null>();
  const automacoes = new Map<string, AutomacaoAtiva[]>();

  for (const bruta of entradas) {
    const entrada = objeto(bruta);
    const igUserId = comoTexto(entrada?.id);
    if (!entrada || !igUserId || !Array.isArray(entrada.changes)) continue;

    for (const bruto of entrada.changes) {
      const mudanca = objeto(bruto);
      if (mudanca?.field !== "comments") continue;
      const valor = objeto(mudanca.value);
      const commentId = comoTexto(valor?.id);
      const mediaId = comoTexto(objeto(valor?.media)?.id);
      if (!valor || !commentId || !mediaId) {
        resumo.ignorados++;
        continue;
      }

      try {
        const autor = objeto(valor.from);
        const autorId = comoTexto(autor?.id);
        // comentário da própria conta, ou resposta a outro comentário: nunca dispara
        if (autorId === igUserId || comoTexto(valor.parent_id)) {
          resumo.ignorados++;
          continue;
        }

        if (!contas.has(igUserId)) contas.set(igUserId, await banco.acharContaConectada(igUserId));
        const conta = contas.get(igUserId);
        if (!conta) {
          resumo.ignorados++;
          continue;
        }

        if (!automacoes.has(conta.id)) automacoes.set(conta.id, await banco.automacoesAtivas(conta.id));
        const texto = typeof valor.text === "string" ? valor.text : "";
        const escolha = escolherAutomacao(automacoes.get(conta.id) ?? [], mediaId, texto);
        if (!escolha) {
          resumo.ignorados++;
          continue;
        }

        const gravou = await banco.registrarComentario({
          comment_id: commentId,
          user_id: conta.user_id,
          conta_id: conta.id,
          automacao_id: escolha.automacao.id,
          media_id: mediaId,
          autor_ig_id: autorId,
          autor_username: comoTexto(autor?.username),
          texto: [...texto].slice(0, TEXTO_MAX).join(""),
          palavra: escolha.palavra,
          comentado_em: quando(entrada.time),
        });
        if (gravou) resumo.gravados++;
        else resumo.repetidos++;
      } catch (e) {
        resumo.erros++;
        // só o id do comentário no log: o texto e o autor são dado de terceiros
        console.error(`[gatilho-webhook] comentário ${commentId}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return resumo;
}
