import { assert, assertEquals } from "@std/assert";
import type { PGlite } from "@electric-sql/pglite";
import { criarPostgres, criarUsuario } from "./pg.ts";

/**
 * A ROTA do webhook do Mercado Pago (app/api/mercadopago-webhook/route.ts) e a
 * ação de assinar, rodadas DE VERDADE, sem nada de rede:
 *  - o `POST` exportado pela rota recebe um `Request` real;
 *  - o fetch global vira dois servidores falsos: a API do Mercado Pago (roteiro
 *    de cada teste) e o Supabase (PostgREST), que por trás é o PGlite com as
 *    migrations todas, ou seja, o `registrar_pagamento` e o `guardar_preapproval`
 *    de verdade;
 *  - as variáveis de ambiente são falsas e entram ANTES do import da rota
 *    (lib/env.ts lê o ambiente quando carrega).
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-falsa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-falsa";
process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-teste-falso";
const SEGREDO = "segredo-falso-do-mp";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SEGREDO;

const { POST } = await import("../../../app/api/mercadopago-webhook/route.ts");
const { abrirCheckoutDoServidor } = await import("../../../lib/mp-checkout-servidor.ts");

async function assinar(dataId: string, requestId: string, segredo = SEGREDO, ts = "1700000000"): Promise<string> {
  const cod = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", new Uint8Array(cod.encode(segredo)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new Uint8Array(cod.encode(manifesto))));
  return `ts=${ts},v1=${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------------------------------------ servidores falsos */

type Servidores = { pedidos: Request[]; bancoFora: boolean };

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });

/** O PostgREST do Supabase, em cima do PGlite: só o que a rota e a ação usam. */
async function postgrest(db: PGlite, p: Request, s: Servidores): Promise<Response> {
  const u = new URL(p.url);
  const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
  if (rpc === "registrar_pagamento") {
    if (s.bancoFora) return json({ message: "banco fora do ar" }, 500);
    const a = await p.clone().json();
    const r = await db.query<{ r: string }>(
      `select public.registrar_pagamento($1::text, $2::text, $3::uuid, $4::int, $5::text) as r`,
      [a.p_gateway, a.p_gateway_pagamento_id, a.p_user_id, a.p_valor_centavos, a.p_gateway_assinatura_id],
    );
    return json(r.rows[0].r);
  }
  if (rpc === "guardar_preapproval") {
    const a = await p.clone().json();
    const r = await db.query<{ r: boolean }>(`select public.guardar_preapproval($1::uuid, $2::text, $3::int) as r`, [
      a.p_user_id,
      a.p_gateway_assinatura_id,
      a.p_valor_centavos,
    ]);
    return json(r.rows[0].r);
  }
  if (u.pathname === "/rest/v1/regras") {
    return json((await db.query(`select chave, valor::text as valor from public.regras`)).rows);
  }
  if (u.pathname === "/rest/v1/assinaturas") {
    const dono = u.searchParams.get("user_id")?.replace(/^eq\./, "");
    const linhas = (await db.query(
      `select status, gateway, gateway_assinatura_id from public.assinaturas where user_id = $1`,
      [dono],
    )).rows;
    return p.headers.get("accept")?.includes("object+json") ? json(linhas[0] ?? null) : json(linhas);
  }
  return json({ message: `fora do roteiro: ${p.method} ${u.pathname}` }, 500);
}

function comServidores<T>(
  db: PGlite,
  mp: (p: Request) => Response | undefined,
  f: (s: Servidores) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const s: Servidores = { pedidos: [], bancoFora: false };
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const p = new Request(entrada as RequestInfo, init);
    s.pedidos.push(p);
    const host = new URL(p.url).host;
    if (host === "api.mercadopago.com") return mp(p) ?? json({ message: "fora do roteiro" }, 500);
    if (host === "supabase.invalid") return await postgrest(db, p, s);
    return json({ message: `host inesperado: ${host}` }, 500);
  }) as typeof fetch;
  return f(s).finally(() => {
    globalThis.fetch = original;
  });
}

const doMP = (s: Servidores) => s.pedidos.filter((p) => new URL(p.url).host === "api.mercadopago.com");
const idDoCaminho = (p: Request) => new URL(p.url).pathname.split("/").pop() ?? "";

/** A API do MP dizendo que o pagamento <id> foi aprovado, do preapproval pa-1. */
const pagamentoAprovado = (userId: string) => (p: Request) =>
  json({
    id: idDoCaminho(p),
    status: "approved",
    transaction_amount: 97.9,
    external_reference: `assinatura|${userId}`,
    preapproval_id: "pa-1",
    currency_id: "BRL",
    transaction_amount_refunded: 0,
  });

async function usuarioComPreapproval(db: PGlite, preapproval = "pa-1"): Promise<string> {
  const userId = await criarUsuario(db);
  await db.query(`select public.guardar_preapproval($1::uuid, $2::text, 9790)`, [userId, preapproval]);
  return userId;
}

const statusDe = async (db: PGlite, userId: string) =>
  (await db.query<{ status: string }>(`select status from public.assinaturas where user_id = $1`, [userId])).rows[0].status;
const pagamentosDe = async (db: PGlite, userId: string) =>
  (await db.query<{ status: string }>(`select status from public.pagamentos where user_id = $1`, [userId])).rows;

/** Um POST do MP: `urlId` vai em ?data.id=, `corpo` no JSON, `assinarId` é o id que entrou na assinatura. */
async function postar(
  o: { urlId?: string; urlType?: string; corpo?: unknown; assinarId?: string; segredo?: string; requestId?: string },
): Promise<Response> {
  const url = new URL("https://gatlo.test/api/mercadopago-webhook");
  if (o.urlId) url.searchParams.set("data.id", o.urlId);
  if (o.urlType) url.searchParams.set("type", o.urlType);
  const requestId = o.requestId ?? "req-1";
  const headers = new Headers({ "content-type": "application/json" });
  if (o.assinarId) {
    headers.set("x-request-id", requestId);
    headers.set("x-signature", await assinar(o.assinarId, requestId, o.segredo));
  }
  return await POST(new Request(url, { method: "POST", headers, body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo) }));
}

/** Pega o que sai em console.error (o log do servidor). */
async function capturandoErros<T>(f: () => Promise<T>): Promise<{ resultado: T; erros: string[] }> {
  const original = console.error;
  const erros: string[] = [];
  console.error = (...a: unknown[]) => void erros.push(a.join(" "));
  try {
    return { resultado: await f(), erros };
  } finally {
    console.error = original;
  }
}

/* ------------------------------------------------------------------- a rota */

Deno.test("rota: assinatura ausente, lixo, errada ou sem segredo = 401 só 'não autorizado' (o motivo vai pro log), sem MP e sem banco", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPreapproval(db);

  await comServidores(db, pagamentoAprovado(userId), async (s) => {
    const corpo = { type: "payment", data: { id: "9001" } };
    const casos: [string, Parameters<typeof postar>[0], string][] = [
      ["ausente", { urlId: "9001", corpo }, "sem x-signature"],
      ["segredo errado", { urlId: "9001", corpo, assinarId: "9001", segredo: "outro" }, "hash divergente"],
      ["id trocado", { urlId: "9001", corpo, assinarId: "1" }, "hash divergente"],
    ];
    for (const [nome, o, motivo] of casos) {
      const { resultado: r, erros } = await capturandoErros(() => postar(o));
      assertEquals(r.status, 401, nome);
      assertEquals(await r.json(), { erro: "não autorizado" }, `${nome}: a resposta não conta o motivo`);
      assert(erros.some((e) => e.includes(motivo)), `${nome}: o motivo "${motivo}" tem que ir pro log, foi: ${erros}`);
    }

    const guardado = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    try {
      const { resultado: r, erros } = await capturandoErros(() => postar({ urlId: "9001", corpo, assinarId: "9001" }));
      assertEquals(r.status, 401);
      const texto = JSON.stringify(await r.json());
      assert(!texto.includes("MERCADOPAGO"), `a resposta não pode contar que falta o segredo: ${texto}`);
      assert(erros.some((e) => e.includes("MERCADOPAGO_WEBHOOK_SECRET não configurado")), "o log conta");
    } finally {
      process.env.MERCADOPAGO_WEBHOOK_SECRET = guardado;
    }

    assertEquals(doMP(s).length, 0, "nenhuma consulta ao MP");
    assertEquals(s.pedidos.length, 0, "nenhuma chamada ao banco");
  });
  assertEquals(await pagamentosDe(db, userId), []);
});

Deno.test("rota: aviso de payment com assinatura boa libera; repetido não credita de novo", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPreapproval(db);

  await comServidores(db, pagamentoAprovado(userId), async (s) => {
    const r = await postar({ urlId: "5001", corpo: { type: "payment", data: { id: "5001" } }, assinarId: "5001" });
    assertEquals([r.status, await r.json()], [200, { tratado: "liberado" }]);
    assertEquals(await statusDe(db, userId), "ativa");
    assertEquals(doMP(s).map((p) => new URL(p.url).pathname), ["/v1/payments/5001"], "consultou o MP pelo id");

    const de_novo = await postar({ urlId: "5001", corpo: { type: "payment", data: { id: "5001" } }, assinarId: "5001" });
    assertEquals(de_novo.status, 200);
    assertEquals((await de_novo.json()).tratado, "ignorado");
    assertEquals((await pagamentosDe(db, userId)).length, 1);
  });
});

Deno.test("rota: o data.id da URL manda no corpo; sem ele na URL vale o do corpo; URL fora do assinado dá 401", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPreapproval(db);

  await comServidores(db, pagamentoAprovado(userId), async (s) => {
    // id na URL (6001) e outro no corpo (9999): vale o da URL, que é o que o MP assina
    let r = await postar({ urlId: "6001", corpo: { type: "payment", data: { id: "9999" } }, assinarId: "6001" });
    assertEquals(r.status, 200);
    assertEquals(doMP(s).map((p) => new URL(p.url).pathname), ["/v1/payments/6001"]);

    // sem id na URL: usa o do corpo (assinatura feita com ele)
    r = await postar({ corpo: { type: "payment", data: { id: 6002 } }, assinarId: "6002" });
    assertEquals(r.status, 200);
    assertEquals(doMP(s).map((p) => new URL(p.url).pathname).at(-1), "/v1/payments/6002");

    // o corpo é do atacante: URL com um id e assinatura de outro não passa
    const antes = doMP(s).length;
    r = (await capturandoErros(() => postar({ urlId: "6003", corpo: { type: "payment", data: { id: "6004" } }, assinarId: "6004" }))).resultado;
    assertEquals(r.status, 401);
    assertEquals(doMP(s).length, antes, "e nem consulta o MP");
  });
});

Deno.test("rota: tipo payment credita; preapproval e tipo desconhecido só dão 200 'ignorado'; o tipo pode vir da URL", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPreapproval(db);

  await comServidores(db, pagamentoAprovado(userId), async (s) => {
    for (const tipo of ["preapproval", "subscription_preapproval", "plan"]) {
      const r = await postar({ urlId: "pa-1", corpo: { type: tipo, data: { id: "pa-1" } }, assinarId: "pa-1" });
      assertEquals(r.status, 200, tipo);
      assertEquals((await r.json()).tratado, "ignorado", tipo);
    }
    assertEquals(doMP(s).length, 0, "preapproval não gasta consulta");
    assertEquals(await statusDe(db, userId), "trial", "autorizar não libera");

    // sem tipo no corpo: o `type` da URL e o `topic` antigo do MP valem
    let r = await postar({ urlId: "7001", urlType: "payment", corpo: {}, assinarId: "7001" });
    assertEquals([r.status, (await r.json()).tratado], [200, "liberado"]);
    r = await postar({ urlId: "7002", corpo: { topic: "payment" }, assinarId: "7002" });
    assertEquals([r.status, (await r.json()).tratado], [200, "liberado"], "o `topic` antigo do MP também vale");
    assertEquals((await pagamentosDe(db, userId)).length, 2, "os dois pagamentos ficaram guardados");
  });
});

Deno.test("rota: erro do banco ou do MP vira 500 (o MP reenvia) e não credita nada; pagamento de outro preapproval não libera", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPreapproval(db);
  const aviso = { urlId: "8001", corpo: { type: "payment", data: { id: "8001" } }, assinarId: "8001" };

  await comServidores(db, pagamentoAprovado(userId), async (s) => {
    s.bancoFora = true;
    const { resultado: r } = await capturandoErros(() => postar(aviso));
    assertEquals(r.status, 500, "o banco falhou: nunca 200");
    assertEquals(await statusDe(db, userId), "trial");
    s.bancoFora = false;

    // depois que o banco volta, o MP reenvia e agora credita (nada ficou preso)
    assertEquals((await postar(aviso)).status, 200);
    assertEquals(await statusDe(db, userId), "ativa");
  });

  await comServidores(db, () => json({ message: "fora" }, 503), async () => {
    const { resultado: r } = await capturandoErros(() => postar({ ...aviso, urlId: "8002", assinarId: "8002" }));
    assertEquals(r.status, 500, "o MP não respondeu: 500 para ele reenviar");
  });

  // M1 pela rota: o pagamento aponta para o usuário, mas vem de outro preapproval
  const outro = await usuarioComPreapproval(db, "pa-2");
  const deOutroPreapproval = (p: Request) =>
    json({
      id: idDoCaminho(p),
      status: "approved",
      transaction_amount: 97.9,
      external_reference: `assinatura|${outro}`,
      preapproval_id: "pa-do-atacante",
      currency_id: "BRL",
    });
  await comServidores(db, deOutroPreapproval, async () => {
    const { resultado: r, erros } = await capturandoErros(() =>
      postar({ urlId: "8003", corpo: { type: "payment", data: { id: "8003" } }, assinarId: "8003" })
    );
    assertEquals([r.status, (await r.json()).tratado], [200, "ignorado"]);
    assertEquals(await statusDe(db, outro), "trial");
    assertEquals((await pagamentosDe(db, outro)).map((x) => x.status), ["preapproval_divergente"]);
    assert(erros.some((e) => e.includes("ALERTA preapproval_divergente")), "solta o alerta");
  });
});

/* ------------------------------------------------------ assinar: o preço do servidor */

Deno.test("assinar: o valor enviado ao MP é o de regras no banco; mudou a regra, mudou o valor (e o cliente não manda preço)", async () => {
  const db = await criarPostgres();
  const u1 = await criarUsuario(db);
  const u2 = await criarUsuario(db);
  let criados = 0;
  const mp = (p: Request) =>
    p.method === "POST"
      ? json({ id: `pa-${++criados}`, init_point: `https://mp.example/checkout/${criados}`, sandbox_init_point: null })
      : json({ message: "não existe" }, 404);
  const valorEnviado = async (s: Servidores) =>
    ((await doMP(s).filter((p) => p.method === "POST").at(-1)!.json()) as { auto_recurring: { transaction_amount: number } })
      .auto_recurring.transaction_amount;

  const realNow = Date.now;
  try {
    await comServidores(db, mp, async (s) => {
      assertEquals(await abrirCheckoutDoServidor({ id: u1, email: "a@exemplo.invalid" }), { url: "https://mp.example/checkout/1" });
      assertEquals(await valorEnviado(s), 97.9, "o preço de regras hoje");

      await db.exec(`update public.regras set valor = 12000 where chave = 'preco_mensal_centavos'`);
      // `regras()` guarda 5 min em cache: anda o relógio para ler o valor novo
      Date.now = () => realNow() + 6 * 60_000;
      await abrirCheckoutDoServidor({ id: u2, email: "b@exemplo.invalid" });
      assertEquals(await valorEnviado(s), 120, "a regra mudou, o valor enviado ao MP mudou");
    });
  } finally {
    Date.now = realNow;
  }
});
