import { assert, assertEquals } from "@std/assert";
import { reinscrever } from "../../../lib/instagram/reinscrever.ts";

// O cron diário da Vercel inscreve de novo as contas conectadas nos avisos de comentário.
// A Meta é SIMULADA: o fetch é trocado por um falso, os tokens são inventados e nenhuma
// chamada sai de verdade (o script teste:funcoes roda sem --allow-net).
const token = () => `falso-${crypto.randomUUID()}`;

async function comMeta<T>(
  responder: (pedido: Request, n: number) => Response,
  f: (pedidos: Request[], logs: unknown[][]) => Promise<T>,
) {
  const original = globalThis.fetch;
  const erro = console.error;
  const pedidos: Request[] = [];
  const logs: unknown[][] = [];
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const pedido = new Request(entrada as RequestInfo, init);
    pedidos.push(pedido);
    return Promise.resolve(responder(pedido, pedidos.length));
  }) as typeof fetch;
  console.error = (...a) => void logs.push(a);
  try {
    return await f(pedidos, logs);
  } finally {
    globalThis.fetch = original;
    console.error = erro;
  }
}

const sucesso = () => Response.json({ success: true });

Deno.test("reinscrever: POST subscribed_apps com o token de CADA conta (inclusive de quem já estava inscrita)", async () => {
  const contas = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((id) => ({ id, token: token() }));
  await comMeta(sucesso, async (pedidos) => {
    const r = await reinscrever(contas);

    assertEquals(r, { inscritas: 7, falhas: 0 });
    assertEquals(pedidos.length, 7);
    for (const p of pedidos) {
      const u = new URL(p.url);
      assertEquals(u.origin, "https://graph.instagram.com");
      assert(u.pathname.endsWith("/me/subscribed_apps"), u.pathname);
      assertEquals(u.searchParams.get("subscribed_fields"), "comments");
      assertEquals(p.method, "POST");
    }
    assertEquals(
      pedidos.map((p) => p.headers.get("authorization")).sort(),
      contas.map((c) => `Bearer ${c.token}`).sort(),
    );
  });
});

Deno.test("reinscrever: a falha de uma conta vai para o log e não para as outras", async () => {
  const contas = ["boa-1", "ruim", "rede", "boa-2"].map((id) => ({ id, token: token() }));
  const porToken = new Map(contas.map((c) => [`Bearer ${c.token}`, c.id]));
  await comMeta(
    (pedido) => {
      const id = porToken.get(pedido.headers.get("authorization") ?? "");
      if (id === "ruim") return Response.json({ error: { message: "token ruim", code: 190 } }, { status: 400 });
      if (id === "rede") return Response.json({ success: false }); // a Meta não confirmou
      return sucesso();
    },
    async (pedidos, logs) => {
      const r = await reinscrever(contas);

      assertEquals(r, { inscritas: 2, falhas: 2 });
      assertEquals(pedidos.length, 4, "as quatro foram tentadas");
      assertEquals(logs.map((l) => l[1]).sort(), ["rede", "ruim"], "o log leva o id da conta com problema");
      assert(!JSON.stringify(logs).includes("falso-"), "nenhum token no log");
    },
  );
});

Deno.test("reinscrever: uma conta que lança erro inesperado também não derruba o resto", async () => {
  const chamadas: string[] = [];
  const logs: unknown[][] = [];
  const erro = console.error;
  console.error = (...a) => void logs.push(a);
  try {
    const r = await reinscrever(
      [{ id: "a", token: "t-a" }, { id: "b", token: "t-b" }, { id: "c", token: "t-c" }],
      (t) => {
        chamadas.push(t);
        return t === "t-b" ? Promise.reject(new Error("quebrou")) : Promise.resolve();
      },
    );
    assertEquals(r, { inscritas: 2, falhas: 1 });
    assertEquals(chamadas.sort(), ["t-a", "t-b", "t-c"]);
    assertEquals(logs.length, 1);
  } finally {
    console.error = erro;
  }
});

Deno.test("reinscrever: sem contas não chama a Meta", async () => {
  await comMeta(sucesso, async (pedidos) => {
    assertEquals(await reinscrever([]), { inscritas: 0, falhas: 0 });
    assertEquals(pedidos.length, 0);
  });
});
