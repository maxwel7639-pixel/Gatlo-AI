import { assert, assertEquals } from "@std/assert";
import { bancoSupabase } from "./banco_supabase.ts";

// O Postgres dos outros testes cobre a lógica; aqui se confere só o PEDIDO que o
// acesso de produção (supabase-js sobre PostgREST) monta, com um fetch falso.
// Nenhuma rede, nenhuma chave de verdade.
const URL_BASE = "https://projeto-falso.supabase.invalid";
const CHAVE_FALSA = `falsa-${crypto.randomUUID()}`;

function comRespostas(respostas: unknown[]) {
  const pedidos: Request[] = [];
  const falso: typeof fetch = (entrada, init) => {
    const pedido = new Request(entrada as RequestInfo, init);
    pedidos.push(pedido);
    return Promise.resolve(
      new Response(JSON.stringify(respostas.shift() ?? []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { banco: bancoSupabase(URL_BASE, CHAVE_FALSA, { fetch: falso }), pedidos };
}

Deno.test("acharContaConectada filtra por ig_user_id, conectada e fora do modo demonstração", async () => {
  const { banco, pedidos } = comRespostas([[{ id: "c1", user_id: "u1" }], []]);
  assertEquals(await banco.acharContaConectada("1784"), { id: "c1", user_id: "u1" });
  assertEquals(await banco.acharContaConectada("outro"), null);

  const u = new URL(pedidos[0].url);
  assertEquals(u.pathname, "/rest/v1/contas_instagram");
  assertEquals(u.searchParams.get("ig_user_id"), "eq.1784");
  assertEquals(u.searchParams.get("status"), "eq.conectada");
  assertEquals(u.searchParams.get("demonstracao"), "eq.false");
  assertEquals(pedidos[0].headers.get("authorization"), `Bearer ${CHAVE_FALSA}`);
  assertEquals(pedidos[0].method, "GET");
});

Deno.test("automacoesAtivas pega só as ligadas da conta, da mais antiga pra mais nova", async () => {
  const linhas = [{ id: "a1", qualquer_post: true, media_id: null, palavras: ["quero"] }];
  const { banco, pedidos } = comRespostas([linhas]);
  assertEquals(await banco.automacoesAtivas("c1"), linhas);

  const u = new URL(pedidos[0].url);
  assertEquals(u.pathname, "/rest/v1/automacoes");
  assertEquals(u.searchParams.get("conta_id"), "eq.c1");
  assertEquals(u.searchParams.get("ativa"), "eq.true");
  assertEquals(u.searchParams.get("order"), "criado_em.asc,id.asc");
});

Deno.test("registrarComentario é insert ... on conflict (comment_id) do nothing", async () => {
  const novo = {
    comment_id: "C-1", user_id: "u1", conta_id: "c1", automacao_id: "a1", media_id: "m1",
    autor_ig_id: "99", autor_username: "ana", texto: "quero", palavra: "quero", comentado_em: "2026-10-14T12:00:00.000Z",
  };
  const { banco, pedidos } = comRespostas([[{ id: "novo" }], []]);
  assertEquals(await banco.registrarComentario(novo), true); // entrou
  assertEquals(await banco.registrarComentario(novo), false); // já existia: o PostgREST devolve vazio

  const p = pedidos[0];
  assertEquals(p.method, "POST");
  const u = new URL(p.url);
  assertEquals(u.pathname, "/rest/v1/comentarios");
  assertEquals(u.searchParams.get("on_conflict"), "comment_id");
  const prefer = p.headers.get("prefer") ?? "";
  assert(prefer.includes("resolution=ignore-duplicates"), `Prefer: ${prefer}`);
  assertEquals(await p.json(), novo);
});

Deno.test("erro do PostgREST vira exceção (o processamento registra e segue)", async () => {
  const falho: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ message: "boom", code: "XX000" }), { status: 500 }));
  const banco = bancoSupabase(URL_BASE, CHAVE_FALSA, { fetch: falho });
  let erro: unknown = null;
  try {
    await banco.automacoesAtivas("c1");
  } catch (e) {
    erro = e;
  }
  assert(erro instanceof Error && erro.message.startsWith("automacoes:"));
});
