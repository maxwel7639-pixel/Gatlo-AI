import { assert, assertEquals } from "@std/assert";
import { type Api, lerPedido, moderar } from "../../../lib/instagram/moderacao.ts";
import {
  ErroMeta,
  comentarNoPost,
  enviarDmDoComentario,
  lerComentario,
  listarComentarios,
  ocultarComentario,
} from "../../../lib/instagram/meta.ts";

// Tela "Comentários do post": o dono clica e o servidor confere antes de chamar a Meta.
// A Meta é SIMULADA (api falsa ou fetch falso); nenhuma chamada sai de verdade.

const CONTA = "17841400000000001";
const ctx = { token: "falso", igUserId: CONTA, postIds: ["m1"] };

// O que a Meta diria de cada comentário (GET /{comment-id}?fields=...,media,parent_id).
// r1 e r2: respostas (r2 é a que estaria na 2ª página de replies, fora da lista).
const NA_META: Record<string, { autorId: string; mediaId: string; paiId: string | null }> = {
  c1: { autorId: "outra", mediaId: "m1", paiId: null },
  c2: { autorId: CONTA, mediaId: "m1", paiId: null },
  r1: { autorId: CONTA, mediaId: "m1", paiId: "c1" },
  r2: { autorId: CONTA, mediaId: "m1", paiId: "c1" },
  x1: { autorId: "outra", mediaId: "m2", paiId: null },
};

function apiFalsa() {
  const chamadas: string[] = [];
  const api: Api = {
    lerComentario: (_t, id) => {
      const c = NA_META[id];
      if (!c) return Promise.reject(new ErroMeta("Unsupported get request", 100));
      return Promise.resolve({ id, username: `u${id}`, ...c });
    },
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

Deno.test("moderar: comentário de outro post, ou que a Meta não acha, não faz nada", async () => {
  const { api, chamadas } = apiFalsa();
  assertEquals((await moderar({ acao: "ocultar", mediaId: "m1", commentId: "x1", texto: "" }, ctx, api)).ok, false);
  assertEquals((await moderar({ acao: "ocultar", mediaId: "m1", commentId: "zz", texto: "" }, ctx, api)).ok, false);
  assertEquals(chamadas, []);
});

Deno.test("moderar: resposta fora da 1ª página da lista ainda pode ser apagada (lida pelo id)", async () => {
  const { api, chamadas } = apiFalsa();
  assertEquals((await moderar({ acao: "apagar", mediaId: "m1", commentId: "r2", texto: "" }, ctx, api)).ok, true);
  assertEquals(chamadas, ["apagar r2"]);
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

Deno.test("meta: 200 sem id não vira sucesso (comentar e DM)", async () => {
  for (const corpo of ["{}", "nao-json"]) {
    await comFetch(() => new Response(corpo, { status: 200 }), async () => {
      const r1 = await comentarNoPost("tk", "m1", "oi").then(() => "ok", (e) => e);
      const r2 = await enviarDmDoComentario("tk", CONTA, "c1", "oi").then(() => "ok", (e) => e);
      assert(r1 instanceof ErroMeta && r2 instanceof ErroMeta);
    });
  }
});

Deno.test("meta: lerComentario pede media e parent_id, com o token no cabeçalho", async () => {
  await comFetch(
    () => Response.json({ id: "r1", from: { id: CONTA, username: "eu" }, media: { id: "m1" }, parent_id: "c1" }),
    async (pedidos) => {
      assertEquals(await lerComentario("tk", "r1"), { id: "r1", autorId: CONTA, username: "eu", mediaId: "m1", paiId: "c1" });
      const u = new URL(pedidos[0].url);
      assert(u.pathname.endsWith("/r1"));
      assert(u.searchParams.get("fields")!.includes("media"));
      assert(u.searchParams.get("fields")!.includes("parent_id"));
      assertEquals(pedidos[0].headers.get("authorization"), "Bearer tk");
    },
  );
});
