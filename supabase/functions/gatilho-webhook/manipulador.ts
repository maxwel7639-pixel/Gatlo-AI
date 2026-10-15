import { type Banco, processarCorpo } from "./processar.ts";
import { assinaturaConfere, iguaisEmTempoConstante } from "./seguranca.ts";

export type Dependencias = {
  /** Deno.env.get em produção; um objeto falso nos testes. */
  env: (nome: string) => string | undefined;
  /** Só é chamado DEPOIS de a assinatura conferir: pedido sem assinatura não chega ao banco. */
  banco: () => Banco;
  /** Segura a função viva até o fim do processamento. Sem isto, usa o EdgeRuntime.waitUntil (ou espera, nos testes). */
  agendar?: (tarefa: Promise<unknown>) => void;
};

// o corpo de um webhook de comentários tem poucos KB; acima disto nem lê
const CORPO_MAX_BYTES = 1_000_000;

const texto = (corpo: string, status = 200) =>
  new Response(corpo, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

type Agendador = { waitUntil(tarefa: Promise<unknown>): void };

export function criarManipulador(dep: Dependencias) {
  return async function manipular(req: Request): Promise<Response> {
    // ------------------------------------------- GET: a Meta confere o endereço
    if (req.method === "GET") {
      const esperado = dep.env("INSTAGRAM_WEBHOOK_VERIFY_TOKEN");
      if (!esperado) return texto("falta INSTAGRAM_WEBHOOK_VERIFY_TOKEN", 503);
      const q = new URL(req.url).searchParams;
      const desafio = q.get("hub.challenge");
      const ok =
        q.get("hub.mode") === "subscribe" &&
        iguaisEmTempoConstante(q.get("hub.verify_token") ?? "", esperado) &&
        !!desafio;
      return ok ? texto(desafio) : texto("proibido", 403);
    }
    if (req.method !== "POST") return texto("método não aceito", 405);

    // ------------------------------------------- POST: comentários novos
    const segredo = dep.env("INSTAGRAM_APP_SECRET");
    if (!segredo) return texto("falta INSTAGRAM_APP_SECRET", 503);
    if (Number(req.headers.get("content-length") ?? 0) > CORPO_MAX_BYTES) return texto("corpo grande demais", 413);

    // corpo CRU: a assinatura vale para os bytes que chegaram, não para o JSON refeito
    const cru = new Uint8Array(await req.arrayBuffer());
    if (cru.length > CORPO_MAX_BYTES) return texto("corpo grande demais", 413);
    if (!(await assinaturaConfere(segredo, cru, req.headers.get("x-hub-signature-256")))) {
      return texto("assinatura inválida", 401);
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(new TextDecoder().decode(cru));
    } catch {
      return texto("corpo não é JSON", 400);
    }

    const tarefa = processarCorpo(dep.banco(), corpo)
      .then((r) => {
        if (r.gravados || r.erros) console.log("[gatilho-webhook]", JSON.stringify(r));
      })
      .catch((e) => console.error("[gatilho-webhook] falha ao processar:", e instanceof Error ? e.message : e));

    // responde 200 na hora e processa depois; sem EdgeRuntime (testes), espera
    const agendador = (globalThis as { EdgeRuntime?: Agendador }).EdgeRuntime;
    if (dep.agendar) dep.agendar(tarefa);
    else if (agendador) agendador.waitUntil(tarefa);
    else await tarefa;
    return texto("EVENT_RECEIVED");
  };
}
