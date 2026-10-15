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

/**
 * Lê o corpo cru bloco a bloco e desiste (cancelando o leitor) assim que passa do limite,
 * em vez de juntar tudo na memória para só então medir. Devolve null se passou.
 */
async function lerCorpoLimitado(req: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array();
  const leitor = req.body.getReader();
  const blocos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > CORPO_MAX_BYTES) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    blocos.push(value);
  }
  const cru = new Uint8Array(total);
  let posicao = 0;
  for (const bloco of blocos) {
    cru.set(bloco, posicao);
    posicao += bloco.byteLength;
  }
  return cru;
}

export function criarManipulador(dep: Dependencias) {
  return async function manipular(req: Request): Promise<Response> {
    // ------------------------------------------- GET: a Meta confere o endereço
    if (req.method === "GET") {
      const esperado = dep.env("INSTAGRAM_WEBHOOK_VERIFY_TOKEN");
      if (!esperado) {
        // quem chama não precisa saber o que falta; o detalhe fica no log
        console.error("[gatilho-webhook] falta INSTAGRAM_WEBHOOK_VERIFY_TOKEN");
        return texto("indisponível", 503);
      }
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
    if (!segredo) {
      console.error("[gatilho-webhook] falta INSTAGRAM_APP_SECRET");
      return texto("indisponível", 503);
    }
    if (Number(req.headers.get("content-length") ?? 0) > CORPO_MAX_BYTES) return texto("corpo grande demais", 413);

    // corpo CRU: a assinatura vale para os bytes que chegaram, não para o JSON refeito
    const cru = await lerCorpoLimitado(req);
    if (!cru) return texto("corpo grande demais", 413);
    if (!(await assinaturaConfere(segredo, cru, req.headers.get("x-hub-signature-256")))) {
      return texto("assinatura inválida", 401);
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(new TextDecoder().decode(cru));
    } catch {
      return texto("corpo não é JSON", 400);
    }

    // dep.banco() também roda dentro da tarefa: se faltar SUPABASE_URL/SERVICE_ROLE_KEY ele
    // lança, e o erro cai no mesmo .catch em vez de virar um 500 para a Meta
    const tarefa = Promise.resolve()
      .then(() => processarCorpo(dep.banco(), corpo))
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
