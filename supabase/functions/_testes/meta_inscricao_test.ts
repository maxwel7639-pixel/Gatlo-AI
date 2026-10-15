import { assert, assertEquals, assertRejects } from "@std/assert";
import { ErroMeta, inscreverComentarios } from "../../../lib/instagram/meta.ts";

// A inscrição da conta no webhook, com a Meta SIMULADA: o fetch é trocado por um
// falso e o token é inventado. Nenhuma chamada real.
const TOKEN_FALSO = `falso-${crypto.randomUUID()}`;

async function comMeta<T>(resposta: { status?: number; corpo: unknown }, f: (pedidos: Request[]) => Promise<T>) {
  const original = globalThis.fetch;
  const pedidos: Request[] = [];
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    pedidos.push(new Request(entrada as RequestInfo, init));
    return Promise.resolve(
      new Response(JSON.stringify(resposta.corpo), {
        status: resposta.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    return await f(pedidos);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("inscreverComentarios: POST /me/subscribed_apps?subscribed_fields=comments com o token no cabeçalho", async () => {
  await comMeta({ corpo: { success: true } }, async (pedidos) => {
    await inscreverComentarios(TOKEN_FALSO);
    assertEquals(pedidos.length, 1);
    const u = new URL(pedidos[0].url);
    assertEquals(u.origin, "https://graph.instagram.com");
    assert(u.pathname.endsWith("/me/subscribed_apps"), u.pathname);
    assertEquals(u.searchParams.get("subscribed_fields"), "comments");
    assertEquals(pedidos[0].method, "POST");
    assertEquals(pedidos[0].headers.get("authorization"), `Bearer ${TOKEN_FALSO}`);
    assert(!pedidos[0].url.includes(TOKEN_FALSO), "o token não vai na URL (acaba em log)");
  });
});

Deno.test("inscreverComentarios: erro da Meta e resposta sem success viram ErroMeta", async () => {
  await comMeta({ status: 400, corpo: { error: { message: "token ruim", code: 190 } } }, async () => {
    const e = await assertRejects(() => inscreverComentarios(TOKEN_FALSO), ErroMeta);
    assertEquals(e.codigo, 190);
    assertEquals(e.tokenInvalido, true);
  });
  await comMeta({ corpo: { success: false } }, async () => {
    await assertRejects(() => inscreverComentarios(TOKEN_FALSO), ErroMeta, "não confirmou");
  });
});
