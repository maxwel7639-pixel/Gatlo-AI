import {
  ErroMeta,
  apagarComentario,
  comentarNoPost,
  enviarDmDoComentario,
  lerComentario,
  ocultarComentario,
  responderComentario,
} from "./meta";

/**
 * As ações da tela "Comentários do post": o dono clica, o servidor confere e chama a Meta.
 * Nada aqui roda sozinho (o robô de DM automática é outro caminho, gatilho-envia).
 *
 * Conferências (o navegador pode mandar qualquer id):
 * - o post tem que estar entre os posts DESTA conta;
 * - o comentário tem que ser DESSE post (lido agora na Meta, pelo id: media.id);
 * - apagar: só comentário feito pela própria conta;
 * - DM e resposta: só em comentário de outra pessoa, de primeiro nível (o Instagram não
 *   responde resposta, e resposta privada a si mesmo não existe).
 */

export type Acao = "comentar" | "responder" | "dm" | "ocultar" | "mostrar" | "apagar";
const ACOES: Acao[] = ["comentar", "responder", "dm", "ocultar", "mostrar", "apagar"];
const COM_TEXTO: Acao[] = ["comentar", "responder", "dm"];

/** DM: a Meta aceita até 1000 caracteres; comentário: 2200. Fica no menor dos dois. */
export const TEXTO_MAX = 1000;
const ID = /^[0-9A-Za-z_-]{1,64}$/;

export type Pedido = { acao: Acao; mediaId: string; commentId: string | null; texto: string };

export function lerPedido(form: FormData): Pedido | { erro: string } {
  const acao = String(form.get("acao") ?? "") as Acao;
  const mediaId = String(form.get("mediaId") ?? "");
  const commentId = String(form.get("commentId") ?? "") || null;
  const texto = String(form.get("texto") ?? "").trim();
  if (!ACOES.includes(acao)) return { erro: "Ação desconhecida." };
  if (!ID.test(mediaId)) return { erro: "Post inválido." };
  if (acao !== "comentar" && (!commentId || !ID.test(commentId))) return { erro: "Comentário inválido." };
  if (COM_TEXTO.includes(acao)) {
    if (!texto) return { erro: "Escreve o texto antes de enviar." };
    if ([...texto].length > TEXTO_MAX) return { erro: `O texto passa de ${TEXTO_MAX} caracteres.` };
  }
  return { acao, mediaId, commentId: acao === "comentar" ? null : commentId, texto };
}

export type Api = {
  lerComentario: typeof lerComentario;
  comentarNoPost: typeof comentarNoPost;
  responderComentario: typeof responderComentario;
  enviarDmDoComentario: typeof enviarDmDoComentario;
  ocultarComentario: typeof ocultarComentario;
  apagarComentario: typeof apagarComentario;
};

const apiReal: Api = {
  lerComentario,
  comentarNoPost,
  responderComentario,
  enviarDmDoComentario,
  ocultarComentario,
  apagarComentario,
};

export type Resultado = { ok: true; mensagem: string } | { ok: false; erro: string; tokenInvalido?: boolean };

export async function moderar(
  p: Pedido,
  ctx: { token: string; igUserId: string; postIds: string[] },
  api: Api = apiReal,
): Promise<Resultado> {
  if (!ctx.postIds.includes(p.mediaId)) return { ok: false, erro: "Esse post não está entre os últimos da tua conta." };
  try {
    if (p.acao === "comentar") {
      await api.comentarNoPost(ctx.token, p.mediaId, p.texto);
      return { ok: true, mensagem: "Comentário publicado no post." };
    }
    const c = await api.lerComentario(ctx.token, p.commentId!);
    if (c.mediaId !== p.mediaId) return { ok: false, erro: "Esse comentário não é deste post." };
    const primeiroNivel = !c.paiId;
    const proprio = c.autorId === ctx.igUserId;

    switch (p.acao) {
      case "responder":
        if (!primeiroNivel) return { ok: false, erro: "O Instagram só deixa responder comentário de primeiro nível." };
        await api.responderComentario(ctx.token, c.id, p.texto);
        return { ok: true, mensagem: "Resposta publicada no comentário." };
      case "dm":
        if (proprio || !primeiroNivel) return { ok: false, erro: "A DM só vai para quem comentou no post." };
        await api.enviarDmDoComentario(ctx.token, ctx.igUserId, c.id, p.texto);
        return { ok: true, mensagem: `DM enviada para @${c.username ?? "quem comentou"}.` };
      case "ocultar":
      case "mostrar":
        await api.ocultarComentario(ctx.token, c.id, p.acao === "ocultar");
        return { ok: true, mensagem: p.acao === "ocultar" ? "Comentário ocultado." : "Comentário visível de novo." };
      case "apagar":
        if (!proprio) return { ok: false, erro: "Só dá pra apagar comentário feito pela tua conta." };
        await api.apagarComentario(ctx.token, c.id);
        return { ok: true, mensagem: "Comentário apagado." };
    }
  } catch (e) {
    if (e instanceof ErroMeta) {
      return { ok: false, erro: `O Instagram recusou: ${e.message}`, tokenInvalido: e.tokenInvalido };
    }
    throw e;
  }
  return { ok: false, erro: "Ação desconhecida." };
}
