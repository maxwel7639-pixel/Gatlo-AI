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

export type PostMeta = { id: string; timestamp: string | null };
export type RespostaMeta = { id: string; autorId: string | null };
export type ComentarioMeta = {
  id: string;
  texto: string;
  username: string | null;
  timestamp: string | null;
  autorId: string | null;
  autorUsername: string | null;
  /** respostas que já existem embaixo deste comentário */
  respostas: RespostaMeta[];
};
export type ResultadoLista<T> = { ok: true; itens: T[] } | { ok: false; erro: ErroMeta };

export type Meta = {
  /** GET /me/media: as publicações mais recentes da conta (a rodada filtra pela data). */
  listarPosts(): Promise<ResultadoLista<PostMeta>>;
  /** GET /<media>/comments: no máximo 100 comentários do post, com as respostas que já têm. */
  listarComentarios(mediaId: string): Promise<ResultadoLista<ComentarioMeta>>;
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

  const objeto = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

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

  async function ler(caminho: string): Promise<{ ok: true; data: unknown[] } | { ok: false; erro: ErroMeta }> {
    let r: Response;
    try {
      r = await o.fetch(`${base}/${caminho}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${o.token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { ok: false, erro: { message: e instanceof Error ? e.message : String(e), rede: true } };
    }
    const json = (await r.json().catch(() => null)) as
      | { error?: { code?: number; message?: string }; data?: unknown }
      | null;
    if (json?.error) {
      return {
        ok: false,
        erro: { code: json.error.code, message: json.error.message ?? "erro sem mensagem", status: r.status },
      };
    }
    if (!r.ok) return { ok: false, erro: { message: `Meta respondeu HTTP ${r.status}`, status: r.status } };
    return { ok: true, data: Array.isArray(json?.data) ? json.data : [] };
  }

  return {
    async listarPosts() {
      const r = await ler("me/media?fields=id,timestamp&limit=100");
      if (!r.ok) return r;
      return {
        ok: true,
        itens: r.data.flatMap((m) => {
          const p = objeto(m);
          const id = texto(p?.id);
          return id ? [{ id, timestamp: texto(p?.timestamp) }] : [];
        }),
      };
    },
    async listarComentarios(mediaId) {
      // NÃO usar comments_count do post: a Meta devolve 0 (lição do robô do @maxwel_dev)
      const campos = "id,text,username,timestamp,from{id,username},replies{id,from{id,username}}";
      const r = await ler(`${encodeURIComponent(mediaId)}/comments?fields=${campos}&limit=100`);
      if (!r.ok) return r;
      return {
        ok: true,
        itens: r.data.flatMap((m) => {
          const c = objeto(m);
          const id = texto(c?.id);
          if (!id) return [];
          const de = objeto(c?.from);
          const respostas = objeto(c?.replies)?.data;
          return [{
            id,
            texto: typeof c?.text === "string" ? c.text : "",
            username: texto(c?.username),
            timestamp: texto(c?.timestamp),
            autorId: texto(de?.id),
            autorUsername: texto(de?.username),
            respostas: (Array.isArray(respostas) ? respostas : []).flatMap((x) => {
              const rid = texto(objeto(x)?.id);
              return rid ? [{ id: rid, autorId: texto(objeto(objeto(x)?.from)?.id) }] : [];
            }),
          }];
        }),
      };
    },
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
