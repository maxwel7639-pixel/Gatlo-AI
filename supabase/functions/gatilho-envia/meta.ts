/**
 * Conversa com a API do Instagram (graph.instagram.com). Só aqui existe `fetch`:
 * quem chama injeta a função, e os testes passam uma Meta de mentira (nunca rede).
 */

export type ErroMeta = {
  code?: number;
  message: string;
  /** status HTTP da resposta, quando a Meta respondeu */
  status?: number;
  /** a chamada nem terminou (rede, tempo esgotado): não dá para saber se a Meta recebeu */
  rede?: boolean;
};

export type ResultadoMeta =
  | { ok: true; recipient_id: string | null; message_id: string | null }
  | { ok: false; erro: ErroMeta };

const VERSAO_PADRAO = "v23.0";
const ERRO_MAX = 250;

/**
 * Recusa por volume (copiada do robô do @maxwel_dev, mais o HTTP 429): não é culpa da
 * pessoa que comentou, é só esperar a pausa passar.
 */
export function ehLimite(erro: ErroMeta | null | undefined): boolean {
  if (!erro) return false;
  if (erro.status === 429) return true;
  if ([4, 17, 32, 613, 80002].includes(Number(erro.code))) return true;
  return /limit how often|rate limit|too many|request limit|temporarily blocked/i.test(erro.message);
}

/** O texto que vai para dm_erro / resposta_erro / motivo: curto e sem quebra de linha. */
export function textoDoErro(erro: ErroMeta): string {
  const base = erro.code ? `(${erro.code}) ${erro.message}` : erro.message;
  return base.replace(/\s+/g, " ").trim().slice(0, ERRO_MAX) || "erro sem mensagem";
}

/**
 * A Meta RECUSOU o pedido (respondeu 4xx com erro, e não foi por volume). Só nesse caso
 * vale tentar de novo de outro jeito. Rede caída, tempo esgotado ou 5xx não provam que
 * a mensagem não saiu: tentar de novo poderia mandar duas.
 */
export function foiRecusa(erro: ErroMeta): boolean {
  return !erro.rede && erro.status !== undefined && erro.status >= 400 && erro.status < 500 && !ehLimite(erro);
}

export type Meta = {
  /** Resposta privada com o modelo de botão (template button, um web_url). */
  enviarBotao(
    igUserId: string,
    commentId: string,
    p: { texto: string; titulo: string; url: string },
  ): Promise<ResultadoMeta>;
  /** Resposta privada só com texto. */
  enviarTexto(igUserId: string, commentId: string, texto: string): Promise<ResultadoMeta>;
  /** Resposta pública embaixo do comentário. */
  responderComentario(commentId: string, mensagem: string): Promise<ResultadoMeta>;
};

export function criarMeta(o: {
  token: string;
  fetch: typeof fetch;
  /** INSTAGRAM_GRAPH_VERSAO, a mesma do app; padrão v23.0 */
  versao?: string;
  timeoutMs?: number;
}): Meta {
  const base = `https://graph.instagram.com/${o.versao || VERSAO_PADRAO}`;
  const timeoutMs = o.timeoutMs ?? 15_000;

  async function postar(caminho: string, corpo: unknown): Promise<ResultadoMeta> {
    let r: Response;
    try {
      r = await o.fetch(`${base}/${caminho}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { ok: false, erro: { message: e instanceof Error ? e.message : String(e), rede: true } };
    }
    const json = (await r.json().catch(() => null)) as
      | { error?: { code?: number; message?: string }; recipient_id?: string; message_id?: string; id?: string }
      | null;
    if (json?.error) {
      return {
        ok: false,
        erro: { code: json.error.code, message: json.error.message ?? "erro sem mensagem", status: r.status },
      };
    }
    if (!r.ok) return { ok: false, erro: { message: `Meta respondeu HTTP ${r.status}`, status: r.status } };
    return { ok: true, recipient_id: json?.recipient_id ?? null, message_id: json?.message_id ?? json?.id ?? null };
  }

  return {
    enviarBotao: (igUserId, commentId, p) =>
      postar(`${encodeURIComponent(igUserId)}/messages`, {
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: p.texto,
              buttons: [{ type: "web_url", url: p.url, title: p.titulo }],
            },
          },
        },
      }),
    enviarTexto: (igUserId, commentId, texto) =>
      postar(`${encodeURIComponent(igUserId)}/messages`, {
        recipient: { comment_id: commentId },
        message: { text: texto },
      }),
    responderComentario: (commentId, mensagem) =>
      postar(`${encodeURIComponent(commentId)}/replies`, { message: mensagem }),
  };
}
