import { NextResponse, type NextRequest } from "next/server";
import { repo } from "@/lib/dados";
import { impressao } from "@/lib/cripto";
import { dentroDaTaxa } from "@/lib/taxa";
import { PRODUTO } from "@/lib/config";

/**
 * O link curto que vai no botão da DM: /l/<codigo>?c=<comentário>.
 * Conta o clique e leva direto pro link da automação.
 *
 * - Robô de prévia de link (o próprio Instagram abre o link pra montar a
 *   prévia) não conta como clique.
 * - A mesma pessoa clicando várias vezes conta no máximo 3 em 10 minutos.
 * - Não guarda IP: só a impressão com sal (lib/cripto.ts).
 * - Mesmo com a automação pausada o link continua funcionando: quem já
 *   recebeu a DM não pode cair num link quebrado.
 */
const ROBO = /facebookexternalhit|facebot|meta-externalagent|bot\b|crawler|spider|preview|whatsapp|telegram/i;
const UUID = /^[0-9a-f-]{36}$/i;

function pagina(status: number, titulo: string, texto: string) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><meta name="robots" content="noindex"></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07090c;color:#e8edf5;font-family:system-ui,sans-serif;padding:24px;text-align:center">
<div><p style="font-size:20px;font-weight:700;margin:0 0 8px">${titulo}</p><p style="color:#8d98ab;margin:0">${texto}</p></div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  if (!/^[0-9a-z]{6,16}$/i.test(codigo)) {
    return pagina(404, "Link não encontrado", "Confere se o endereço está completo.");
  }

  const r = repo();
  const destino = await r.destinoDoLink(codigo);
  if (!destino) {
    return pagina(404, "Esse link não existe mais", `A automação foi apagada por quem usa o ${PRODUTO.nome}.`);
  }

  // O link foi conferido ao salvar; aqui só reconfere o protocolo.
  let url: URL;
  try {
    url = new URL(destino.linkUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    return pagina(410, "Link indisponível", "O endereço de destino não é válido.");
  }

  const ua = req.headers.get("user-agent") ?? "";
  if (!ROBO.test(ua)) {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
    const visitante = impressao(ip, ua);
    try {
      if (await dentroDaTaxa(`clique:${codigo}:${visitante}`, 3, 600)) {
        const c = req.nextUrl.searchParams.get("c");
        const comentarioId =
          c && UUID.test(c) && (await r.comentarioEhDaAutomacao(c, destino.automacaoId)) ? c : null;
        await r.registrarClique({
          automacaoId: destino.automacaoId,
          userId: destino.userId,
          comentarioId,
          visitante,
        });
      }
    } catch (e) {
      // contar é bom, mas levar a pessoa ao link é o que importa
      console.error("[l/codigo] clique não registrado:", (e as Error).message);
    }
  }

  const resposta = NextResponse.redirect(url.toString(), 302);
  resposta.headers.set("cache-control", "no-store");
  return resposta;
}
