import { assert, assertEquals } from "@std/assert";
import { type Api, lerPedido, moderar } from "../../../lib/instagram/moderacao.ts";
import { enviarDmDoComentario, listarComentarios, ocultarComentario } from "../../../lib/instagram/meta.ts";
import type { Comentario } from "../../../lib/instagram/tipos.ts";

// Tela "Comentários do post": o dono clica e o servidor confere antes de chamar a Meta.
// A Meta é SIMULADA (api falsa ou fetch falso); nenhuma chamada sai de verdade.

const CONTA = "17841400000000001";
const ctx = { token: "falso", igUserId: CONTA, postIds: ["m1"] };

const com = (id: string, autorId: string, respostas: Comentario[] = []): Comentario => ({
  id,
  texto: "quero",
  username: `u${id}`,
  autorId,
  publicadoEm: "2026-11-13T10:00:00Z",
  oculto: false,
  respostas,
});
const COMENTARIOS = [com("c1", "outra", [com("r1", CONTA)]), com("c2", CONTA)];

function apiFalsa() {
  const chamadas: string[] = [];
  const api: Api = {
    listarComentarios: () => Promise.resolve(COMENTARIOS),
    comentarNoPost: (_t, m, x) => (chamadas.push(`comentar ${m} ${x}`), Promise.resolve("n1")),
    responderComentario: (_t, c, x) => (chamadas.push(`responder ${c} ${x}`), Promise.resolve("n2")),
    enviarDmDoComentario: (_t, u, c, x) => (chamadas.push(`dm ${u} ${c} ${x}`), Promise.resolve("n3")),
    ocultarComentario: (_t, c, o) => (chamadas.push(`ocultar ${c} ${o}`), Promise.resolve()),
    apagarComentario: (_t, c) => (chamadas.push(`apagar ${c}`), Promise.resolve()),
  };
  return { api, chamadas };
}

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

Deno.test("lerPedido: recusa ação, id e texto ruins", () => {
  assert("erro" in lerPedido(form({ acao: "editar", mediaId: "m1", commentId: "c1" })));
  assert("erro" in lerPedido(form({ acao: "ocultar", mediaId: "m1/../x", commentId: "c1" })));
  assert("erro" in lerPedido(form({ acao: "ocultar", mediaId: "m1" })));
  assert("erro" in lerPedido(form({ acao: "dm", mediaId: "m1", commentId: "c1", texto: "   " })));
  assert("erro" in lerPedido(form({ acao: "dm", mediaId: "m1", commentId: "c1", texto: "a".repeat(1001) })));
  assertEquals(lerPedido(form({ acao: "comentar", mediaId: "m1", commentId: "c9", texto: " oi " })), {
    acao: "comentar",
    mediaId: "m1",
    commentId: null,
    texto: "oi",
  });
});

Deno.test("moderar: post de outra conta não chama a Meta", async () => {
  const { api, chamadas } = apiFalsa();
  const r = await moderar({ acao: "comentar", mediaId: "m9", commentId: null, texto: "oi" }, ctx, api);
  assertEquals(r.ok, false);
  assertEquals(chamadas, []);
});

Deno.test("moderar: comentário que não é do post não chama a Meta", async () => {
  const { api, chamadas } = apiFalsa();
  const r = await moderar({ acao: "ocultar", mediaId: "m1", commentId: "zz", texto: "" }, ctx, api);
  assertEquals(r.ok, false);
  assertEquals(chamadas, []);
});

Deno.test("moderar: DM só para comentário de outra pessoa, de primeiro nível", async () => {
  const { api, chamadas } = apiFalsa();
  assertEquals((await moderar({ acao: "dm", mediaId: "m1", commentId: "c2", texto: "oi" }, ctx, api)).ok, false);
  assertEquals((await moderar({ acao: "dm", mediaId: "m1", commentId: "r1", texto: "oi" }, ctx, api)).ok, false);
  assertEquals((await moderar({ acao: "dm", mediaId: "m1", commentId: "c1", texto: "oi" }, ctx, api)).ok, true);
  assertEquals(chamadas, [`dm ${CONTA} c1 oi`]);
});

Deno.test("moderar: apagar só o que a própria conta escreveu (inclusive resposta)", async () => {
  const { api, chamadas } = apiFalsa();
  assertEquals((await moderar({ acao: "apagar", mediaId: "m1", commentId: "c1", texto: "" }, ctx, api)).ok, false);
  assertEquals((await moderar({ acao: "apagar", mediaId: "m1", commentId: "r1", texto: "" }, ctx, api)).ok, true);
  assertEquals(chamadas, ["apagar r1"]);
});

Deno.test("moderar: responder resposta é recusado; ocultar e mostrar passam", async () => {
  const { api, chamadas } = apiFalsa();
  assertEquals((await moderar({ acao: "responder", mediaId: "m1", commentId: "r1", texto: "oi" }, ctx, api)).ok, false);
  await moderar({ acao: "ocultar", mediaId: "m1", commentId: "c1", texto: "" }, ctx, api);
  await moderar({ acao: "mostrar", mediaId: "m1", commentId: "c1", texto: "" }, ctx, api);
  assertEquals(chamadas, ["ocultar c1 true", "ocultar c1 false"]);
});

async function comFetch<T>(responder: (p: Request) => Response, f: (pedidos: Request[]) => Promise<T>) {
  const original = globalThis.fetch;
  const pedidos: Request[] = [];
  globalThis.fetch = ((e: RequestInfo | URL, i?: RequestInit) => {
    const p = new Request(e as RequestInfo, i);
    pedidos.push(p);
    return Promise.resolve(responder(p));
  }) as typeof fetch;
  try {
    return await f(pedidos);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("meta: DM vai para /{ig-user-id}/messages com comment_id, token no cabeçalho", async () => {
  await comFetch(() => Response.json({ recipient_id: "x", message_id: "mid" }), async (pedidos) => {
    assertEquals(await enviarDmDoComentario("tk", CONTA, "c1", "oi"), "mid");
    const p = pedidos[0];
    assertEquals(p.method, "POST");
    assert(new URL(p.url).pathname.endsWith(`/${CONTA}/messages`));
    assertEquals(p.headers.get("authorization"), "Bearer tk");
    assert(!p.url.includes("tk"));
    assertEquals(await p.json(), { recipient: { comment_id: "c1" }, message: { text: "oi" } });
  });
});

Deno.test("meta: ocultar manda hide=true e lê respostas aninhadas", async () => {
  await comFetch(
    (p) =>
      p.method === "POST"
        ? Response.json({ success: true })
        : Response.json({
          data: [{ id: "c1", text: "a", hidden: true, from: { id: "9", username: "ana" }, replies: { data: [{ id: "r1", text: "b" }] } }],
        }),
    async (pedidos) => {
      await ocultarComentario("tk", "c1", true);
      assertEquals(new URL(pedidos[0].url).searchParams.get("hide"), "true");
      const lista = await listarComentarios("tk", "m1");
      assertEquals(lista[0].oculto, true);
      assertEquals(lista[0].username, "ana"); // sem "username", vale from.username
      assertEquals(lista[0].autorId, "9");
      assertEquals(lista[0].respostas[0].id, "r1");
    },
  );
});
