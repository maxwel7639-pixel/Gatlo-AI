import type { Banco } from "./rodada.ts";
import { rodar } from "./rodada.ts";
import { criarMeta } from "./meta.ts";
import { iguaisEmTempoConstante } from "./seguranca.ts";
import { importarChave } from "./token.ts";

export type Dependencias = {
  /** Deno.env.get em produção; um objeto falso nos testes. */
  env: (nome: string) => string | undefined;
  /** Só é chamado DEPOIS de a chave do cron conferir: pedido sem chave não chega ao banco. */
  banco: () => Banco;
  /** A Meta de mentira dos testes. Em produção, o fetch de verdade. */
  fetch?: typeof fetch;
  /** Os testes não esperam de verdade. */
  esperar?: (ms: number) => Promise<void>;
  agora?: () => number;
  orcamentoMs?: number;
  sortear?: () => number;
};

// Constantes de infraestrutura (não são regras de negócio, por isso não estão na tabela
// `regras`). O cron é de 3 min e o limite da função é de ~150 s: a rodada para de começar
// envio novo aos 100 s, e cada chamada à Meta desiste em 15 s (no pior caso: 100 + botão +
// texto + resposta pública = 145 s).
const ORCAMENTO_MS = 100_000;
const CONTAS_EM_PARALELO = 3;
// Reserva mais velha que isto é de uma rodada que morreu e volta pra fila. Bem acima da rodada
// mais longa possível (100 s + 3 chamadas de 15 s = ~145 s), para nunca pegar uma em voo.
const RECUPERACAO_MS = 10 * 60_000;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const texto = (corpo: string, status: number) =>
  new Response(corpo, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export function criarManipulador(dep: Dependencias) {
  return async function manipular(req: Request): Promise<Response> {
    if (req.method !== "POST") return texto("método não aceito", 405);

    const cronChave = dep.env("GATILHO_CRON_CHAVE");
    if (!cronChave) {
      // quem chama não precisa saber o que falta; o detalhe fica no log
      console.error("[gatilho-envia] falta GATILHO_CRON_CHAVE");
      return texto("indisponível", 503);
    }
    if (!iguaisEmTempoConstante(req.headers.get("x-cron-chave") ?? "", cronChave)) {
      return texto("chave do agendador errada", 401);
    }

    // daqui pra baixo o pedido é do agendador
    const chaveTokens = dep.env("GATILHO_CHAVE_TOKENS");
    const siteUrl = dep.env("GATILHO_SITE_URL")?.trim().replace(/\/+$/, "");
    if (!chaveTokens || !siteUrl || !/^https?:\/\/[^\s]+$/i.test(siteUrl)) {
      console.error("[gatilho-envia] falta GATILHO_CHAVE_TOKENS ou GATILHO_SITE_URL (com http:// ou https://)");
      return texto("indisponível", 503);
    }

    const fetchMeta = dep.fetch ?? fetch;
    const versao = dep.env("INSTAGRAM_GRAPH_VERSAO");
    try {
      const resumo = await rodar({
        banco: dep.banco(),
        meta: (token) => criarMeta({ token, fetch: fetchMeta, versao }),
        chaveTokens: await importarChave(chaveTokens),
        siteUrl,
        esperar: dep.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        agora: dep.agora ?? Date.now,
        orcamentoMs: dep.orcamentoMs ?? ORCAMENTO_MS,
        contasEmParalelo: CONTAS_EM_PARALELO,
        recuperacaoMs: RECUPERACAO_MS,
        sortear: dep.sortear ?? Math.random,
      });
      console.log("[gatilho-envia]", JSON.stringify(resumo));
      return json({ ok: true, ...resumo });
    } catch (e) {
      console.error("[gatilho-envia] falha na rodada:", e instanceof Error ? e.message : e);
      return json({ ok: false, erro: "falha na rodada" }, 500);
    }
  };
}
