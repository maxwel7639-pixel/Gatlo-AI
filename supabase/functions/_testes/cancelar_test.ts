import { assert, assertEquals } from "@std/assert";
import type { PGlite } from "@electric-sql/pglite";
import { criarPostgres, criarUsuario } from "./pg.ts";

/**
 * CANCELAR E ESTORNAR (C3), com Mercado Pago e Asaas SIMULADOS no `fetch` e o
 * Supabase (PostgREST) falso em cima do PGlite com as migrations 0001..0007, ou
 * seja, `marcar_assinatura`, `estornar_pagamento` e `registrar_pagamento` de
 * verdade. Os webhooks são os `POST` exportados das rotas, com `Request` real.
 * Nenhuma rede, nenhuma credencial (as chaves abaixo são falsas).
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-falsa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-falsa";
process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-teste-falso";
const SEGREDO = "segredo-falso-do-mp";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SEGREDO;
process.env.ASAAS_API_KEY = "$aact_teste_falsa";
const TOKEN = "token-falso-do-webhook-asaas-com-mais-de-32-caracteres";
process.env.ASAAS_WEBHOOK_TOKEN = TOKEN;
delete process.env.ASAAS_AMBIENTE;

const mpRota = await import("../../../app/api/mercadopago-webhook/route.ts");
const asaasRota = await import("../../../app/api/asaas-webhook/route.ts");
const { cancelarDoUsuario, cancelarEApagar, cancelarPeloBotao } = await import("../../../lib/cancelar-servidor.ts");

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });

/* --------------------------------------------------------------- gateways falsos */

class Gateways {
  // Mercado Pago
  preapprovals = new Map<string, { id: string; status: string; external_reference: string | null; init_point: string | null }>();
  pagamentos = new Map<string, Record<string, unknown>>();
  // Asaas
  clientes = new Map<string, { id: string; externalReference: string }>();
  autorizacoes = new Map<string, { id: string; status: string; customerId: string; subscriptionId: string | null }>();
  cobrancas = new Map<string, Record<string, unknown>>();
  // o que foi pedido de mudança (PUT/DELETE), em ordem, e quando o banco apagou o usuário
  mutacoes: string[] = [];
  cancelamentoFalha = false;
  consultaMPFalha = false;

  preapproval(id: string, userId: string, status = "authorized") {
    this.preapprovals.set(id, { id, status, external_reference: `assinatura|${userId}`, init_point: null });
  }
  pagamentoMP(id: string, userId: string, extra: Record<string, unknown> = {}) {
    this.pagamentos.set(id, {
      id,
      status: "approved",
      transaction_amount: 97.9,
      external_reference: `assinatura|${userId}`,
      preapproval_id: "pa-1",
      currency_id: "BRL",
      transaction_amount_refunded: 0,
      ...extra,
    });
  }
  asaas(userId: string, o: { autorizacao?: string; status?: string; subscription?: string | null } = {}) {
    this.clientes.set("cus_1", { id: "cus_1", externalReference: `assinatura|${userId}` });
    const id = o.autorizacao ?? "aut-1";
    this.autorizacoes.set(id, { id, status: o.status ?? "ACTIVE", customerId: "cus_1", subscriptionId: o.subscription === undefined ? "sub_1" : o.subscription });
  }
  cobranca(id: string, extra: Record<string, unknown> = {}) {
    this.cobrancas.set(id, {
      id, customer: "cus_1", value: 97.9, status: "RECEIVED", billingType: "PIX", subscription: "sub_1", refunds: [], ...extra,
    });
  }

  async responder(p: Request): Promise<Response> {
    const u = new URL(p.url);
    const caminho = u.pathname.replace(/^\/v3/, "");
    const id = decodeURIComponent(caminho.split("/").pop() ?? "");
    const ler = <T>(m: Map<string, T>) => (m.has(id) ? json(m.get(id)) : json({ message: "não encontrado", errors: [{ description: "não encontrado" }] }, 404));

    if (u.host === "api.mercadopago.com") {
      if (p.method === "GET" && caminho.startsWith("/preapproval/")) {
        return this.consultaMPFalha ? json({ message: "fora do ar" }, 503) : ler(this.preapprovals);
      }
      if (p.method === "GET" && caminho.startsWith("/v1/payments/")) return ler(this.pagamentos);
      if (p.method === "PUT" && caminho.startsWith("/preapproval/")) {
        const corpo = await p.clone().json();
        this.mutacoes.push(`mp PUT ${id} ${corpo.status}`);
        if (this.cancelamentoFalha) return json({ message: "fora do ar" }, 503);
        const pa = this.preapprovals.get(id);
        if (!pa) return json({ message: "não existe" }, 404);
        pa.status = corpo.status;
        return json(pa);
      }
    }
    if (u.host === "api-sandbox.asaas.com") {
      if (p.method === "GET" && caminho.startsWith("/customers/")) return ler(this.clientes);
      if (p.method === "GET" && caminho.startsWith("/payments/")) return ler(this.cobrancas);
      if (p.method === "GET" && caminho.startsWith("/pix/automatic/authorizations/")) return ler(this.autorizacoes);
      if (p.method === "DELETE" && caminho.startsWith("/pix/automatic/authorizations/")) {
        this.mutacoes.push(`asaas DELETE autorizacao ${id}`);
        if (this.cancelamentoFalha) return json({ errors: [{ description: "fora do ar" }] }, 503);
        const a = this.autorizacoes.get(id);
        if (!a) return json({}, 404);
        a.status = "CANCELLED";
        return json(a);
      }
      if (p.method === "DELETE" && caminho.startsWith("/subscriptions/")) {
        this.mutacoes.push(`asaas DELETE assinatura ${id}`);
        if (this.cancelamentoFalha) return json({ errors: [{ description: "fora do ar" }] }, 503);
        return json({ deleted: true, id });
      }
    }
    return json({ message: `fora do roteiro: ${p.method} ${u.host}${caminho}` }, 500);
  }
}

async function postgrest(db: PGlite, p: Request): Promise<Response> {
  const u = new URL(p.url);
  const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
  const a = rpc ? await p.clone().json() : null;
  if (rpc === "registrar_pagamento") {
    const r = await db.query<{ r: string }>(`select public.registrar_pagamento($1::text, $2::text, $3::uuid, $4::int, $5::text) as r`, [
      a.p_gateway, a.p_gateway_pagamento_id, a.p_user_id, a.p_valor_centavos, a.p_gateway_assinatura_id,
    ]);
    return json(r.rows[0].r);
  }
  if (rpc === "marcar_assinatura") {
    const r = await db.query<{ r: string }>(`select public.marcar_assinatura($1::uuid, $2::text, $3::text, $4::text) as r`, [
      a.p_user_id, a.p_status, a.p_gateway, a.p_gateway_assinatura_id,
    ]);
    return json(r.rows[0].r);
  }
  if (rpc === "estornar_pagamento") {
    const r = await db.query<{ r: string }>(`select public.estornar_pagamento($1::text, $2::text) as r`, [a.p_gateway, a.p_gateway_pagamento_id]);
    return json(r.rows[0].r);
  }
  if (u.pathname === "/rest/v1/assinaturas") {
    const dono = u.searchParams.get("user_id")?.replace(/^eq\./, "");
    const linhas = (await db.query(`select status, gateway, gateway_assinatura_id from public.assinaturas where user_id = $1`, [dono])).rows;
    return p.headers.get("accept")?.includes("object+json") ? json(linhas[0] ?? null) : json(linhas);
  }
  return json({ message: `fora do roteiro: ${p.method} ${u.pathname}` }, 500);
}

function comServidores<T>(db: PGlite, g: Gateways, f: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const p = new Request(entrada as RequestInfo, init);
    const host = new URL(p.url).host;
    if (host === "supabase.invalid") return await postgrest(db, p);
    return await g.responder(p);
  }) as typeof fetch;
  return f().finally(() => {
    globalThis.fetch = original;
  });
}

/* ----------------------------------------------------------------- utilidades */

async function assinar(dataId: string, requestId: string): Promise<string> {
  const cod = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", new Uint8Array(cod.encode(SEGREDO)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new Uint8Array(cod.encode(`id:${dataId};request-id:${requestId};ts:1700000000;`))));
  return `ts=1700000000,v1=${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Aviso do MP com assinatura boa (`type` e `data.id` na URL, como o MP manda). */
async function avisoMP(tipo: string, id: string): Promise<Response> {
  const url = new URL("https://gatlo.test/api/mercadopago-webhook");
  url.searchParams.set("data.id", id);
  url.searchParams.set("type", tipo);
  const headers = new Headers({ "content-type": "application/json", "x-request-id": "req-1", "x-signature": await assinar(id, "req-1") });
  return await mpRota.POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ type: tipo, data: { id } }) }));
}

function avisoAsaas(corpo: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("asaas-access-token", token);
  return asaasRota.POST(new Request("https://gatlo.test/api/asaas-webhook", { method: "POST", headers, body: JSON.stringify(corpo) }));
}

const eventoAut = (event: string, id: string) => ({ id: "evt_1", event, authorization: { id } });
const eventoPag = (event: string, id: string) => ({ id: "evt_2", event, payment: { id } });

type Linha = { status: string; periodo_ate: string | null; gateway: string | null; gateway_assinatura_id: string | null };
const assinaturaDe = async (db: PGlite, userId: string) =>
  (await db.query<Linha>(`select status, periodo_ate, gateway, gateway_assinatura_id from public.assinaturas where user_id = $1`, [userId])).rows[0];
const situacaoDe = async (db: PGlite, userId: string) =>
  (await db.query<{ status: string; liberada: boolean }>(`select status, liberada from public.assinatura_situacao($1)`, [userId])).rows[0];
const pagamentosDe = async (db: PGlite, userId: string) =>
  (await db.query<{ gateway_pagamento_id: string; status: string }>(
    `select gateway_pagamento_id, status from public.pagamentos where user_id = $1 order by gateway_pagamento_id`, [userId])).rows;

/** Usuário com cartão pago: preapproval pa-1 guardado, pagamento 1001 creditado (status ativa, 1 mês). */
async function usuarioPagoNoCartao(db: PGlite, g: Gateways): Promise<string> {
  const userId = await criarUsuario(db);
  await db.query(`select public.guardar_preapproval($1::uuid, 'pa-1', 9790)`, [userId]);
  g.preapproval(`pa-1`, userId);
  g.pagamentoMP("1001", userId);
  await comServidores(db, g, async () => assertEquals((await (await avisoMP("payment", "1001")).json()).tratado, "liberado"));
  return userId;
}

/** Usuário com Pix pago: autorização aut-1 guardada, cobrança pay_1 creditada. */
async function usuarioPagoNoPix(db: PGlite, g: Gateways): Promise<string> {
  const userId = await criarUsuario(db);
  await db.query(`select public.guardar_autorizacao_asaas($1::uuid, 'cus_1', 'aut-1', 9790)`, [userId]);
  g.asaas(userId);
  g.cobranca("pay_1");
  await comServidores(db, g, async () => assertEquals((await (await avisoAsaas(eventoPag("PAYMENT_RECEIVED", "pay_1"))).json()).tratado, "liberado"));
  return userId;
}

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

/* ====================================== 1. status só muda quando o gateway confirma */

Deno.test("cancelar (MP): o clique só pede ao gateway; o banco muda quando o aviso chega e a API confirma", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);

  await comServidores(db, g, async () => {
    // o botão: pede o cancelamento ao MP e NÃO toca no banco
    assertEquals(await cancelarDoUsuario(userId), "cancelado");
    assertEquals(g.mutacoes, ["mp PUT pa-1 cancelled"]);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa", "o clique não muda o banco");

    // aviso forjado: assinatura boa, mas a API diz que ainda está autorizada
    g.preapprovals.get("pa-1")!.status = "authorized";
    assertEquals((await (await avisoMP("subscription_preapproval", "pa-1")).json()).motivo, "assinatura: o crédito vem do pagamento");
    assertEquals((await assinaturaDe(db, userId)).status, "ativa", "a API não confirmou: nada muda");

    // aviso de verdade: a API confirma o cancelamento
    g.preapprovals.get("pa-1")!.status = "cancelled";
    const r = await avisoMP("subscription_preapproval", "pa-1");
    assertEquals([r.status, (await r.json()).tratado], [200, "cancelada"]);
    assertEquals((await assinaturaDe(db, userId)).status, "cancelada");

    // reenvio e o tipo antigo do aviso: continua cancelada, sem erro
    assertEquals((await (await avisoMP("preapproval", "pa-1")).json()).motivo, "cancelamento repetida");
    // o botão de novo (já cancelado no MP): não pede outra vez
    assertEquals(await cancelarDoUsuario(userId), "ja_cancelado");
    assertEquals(g.mutacoes.length, 1);
  });
});

Deno.test("cancelar (MP): aviso sem assinatura boa dá 401 sem consultar nada; preapproval que não é o guardado nunca muda o status", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);

  await comServidores(db, g, async () => {
    const sem = await mpRota.POST(new Request("https://gatlo.test/api/mercadopago-webhook?data.id=pa-1&type=preapproval", { method: "POST", body: "{}" }));
    assertEquals(sem.status, 401);

    // outro preapproval do mesmo usuário (ex.: um checkout velho), cancelado de verdade na API
    g.preapproval("pa-velho", userId, "cancelled");
    const { resultado: r, erros } = await capturandoErros(() => avisoMP("subscription_preapproval", "pa-velho"));
    assertEquals((await r.json()).motivo, "cancelamento nao_guardada");
    assert(erros.some((e) => e.includes("não é o guardado")), "vai pro log");
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");
    assertEquals((await situacaoDe(db, userId)).liberada, true);
  });
});

Deno.test("cancelar (MP): cancelado mantém o acesso até o fim do período pago, sem carência; depois disso o robô para", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);
  g.preapprovals.get("pa-1")!.status = "cancelled";

  await comServidores(db, g, async () => {
    await avisoMP("subscription_preapproval", "pa-1");
    assertEquals(await situacaoDe(db, userId), { status: "cancelada", liberada: true });

    // o período acabou há 1 dia: ativa ainda teria a carência de 3 dias; cancelada não tem
    await db.query(`update public.assinaturas set periodo_ate = now() - interval '1 day' where user_id = $1`, [userId]);
    assertEquals(await situacaoDe(db, userId), { status: "cancelada", liberada: false });
  });
});

Deno.test("cancelar: teste sem pagamento não vira cancelada (cancelar um checkout pendente não mata os dias de teste)", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await criarUsuario(db);
  await db.query(`select public.guardar_preapproval($1::uuid, 'pa-1', 9790)`, [userId]);
  g.preapproval("pa-1", userId, "cancelled");

  await comServidores(db, g, async () => {
    assertEquals((await (await avisoMP("subscription_preapproval", "pa-1")).json()).motivo, "cancelamento sem_efeito");
    assertEquals(await situacaoDe(db, userId), { status: "trial", liberada: true });
  });
});

Deno.test("cancelar (Asaas): o clique cancela a autorização e a assinatura no Asaas sem tocar no banco; o aviso conferido na API é que muda", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoPix(db, g);

  await comServidores(db, g, async () => {
    assertEquals(await cancelarDoUsuario(userId), "cancelado");
    assertEquals(g.mutacoes, ["asaas DELETE autorizacao aut-1", "asaas DELETE assinatura sub_1"]);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa", "o clique não muda o banco");

    // sem token: 401
    assertEquals((await avisoAsaas(eventoAut("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED", "aut-1"), "errado")).status, 401);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");

    // corpo jura CANCELLED mas a API diz que está ativa: nada muda
    g.autorizacoes.get("aut-1")!.status = "ACTIVE";
    let r = await avisoAsaas(eventoAut("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED", "aut-1"));
    assertEquals((await r.json()).motivo, "autorização ACTIVE");
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");

    // a API confirma
    g.autorizacoes.get("aut-1")!.status = "CANCELLED";
    r = await avisoAsaas(eventoAut("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED", "aut-1"));
    assertEquals([r.status, (await r.json()).tratado], [200, "cancelada"]);
    assertEquals(await situacaoDe(db, userId), { status: "cancelada", liberada: true });

    // reenvio
    assertEquals((await (await avisoAsaas(eventoAut("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED", "aut-1"))).json()).motivo, "cancelamento repetida");
  });
});

Deno.test("cancelar (Asaas): autorização que não é a guardada, id malformado ou inexistente nunca muda o status; REFUSED antes de pagar não mata o teste", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoPix(db, g);

  await comServidores(db, g, async () => {
    // outra autorização do mesmo cliente, cancelada de verdade
    g.asaas(userId, { autorizacao: "aut-velha", status: "CANCELLED" });
    const { resultado: r, erros } = await capturandoErros(() => avisoAsaas(eventoAut("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED", "aut-velha")));
    assertEquals((await r.json()).motivo, "autorização não é a guardada");
    assert(erros.some((e) => e.includes("não é a guardada")));
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");

    for (const id of ["../customers", "", "nao-existe"]) {
      const x = await avisoAsaas(eventoAut("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED", id));
      assertEquals(x.status, 200);
      assertEquals((await x.json()).tratado, "ignorado");
    }
    assertEquals((await avisoAsaas({ event: "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED" })).status, 200);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");
  });

  // quem ainda está no teste e teve a autorização recusada continua no teste
  const outro = await criarUsuario(db);
  await db.query(`select public.guardar_autorizacao_asaas($1::uuid, 'cus_2', 'aut-2', 9790)`, [outro]);
  g.clientes.set("cus_2", { id: "cus_2", externalReference: `assinatura|${outro}` });
  g.autorizacoes.set("aut-2", { id: "aut-2", status: "REFUSED", customerId: "cus_2", subscriptionId: null });
  await comServidores(db, g, async () => {
    const x = await avisoAsaas(eventoAut("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED", "aut-2"));
    assertEquals((await x.json()).motivo, "cancelamento sem_efeito");
    assertEquals(await situacaoDe(db, outro), { status: "trial", liberada: true });
  });
});

/* ======================================== 2. usuário logado não muda o status pela API */

Deno.test("cancelar: anon e authenticated não executam marcar_assinatura nem estornar_pagamento e não escrevem em assinaturas", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);

  for (const papel of ["anon", "authenticated"]) {
    const nega = async (sql: string) => {
      try {
        await db.transaction(async (tx) => {
          await tx.exec(`set local role ${papel}`);
          await tx.exec(`set local request.jwt.claim.sub = '${userId}'`);
          await tx.query(sql);
        });
      } catch (e) {
        assert(/permission denied|row-level security/.test(String(e)), `${papel}: erro inesperado em "${sql}": ${e}`);
        return;
      }
      throw new Error(`${papel} conseguiu: ${sql}`);
    };
    await nega(`select public.marcar_assinatura('${userId}', 'cancelada', 'mercadopago', 'pa-1')`);
    await nega(`select public.estornar_pagamento('mercadopago', '1001')`);
    await nega(`update public.assinaturas set status = 'cancelada' where user_id = '${userId}'`);
    await nega(`update public.assinaturas set periodo_ate = now() + interval '10 years' where user_id = '${userId}'`);
    await nega(`update public.pagamentos set status = 'estornado'`);
  }
  const quem = (await db.query<{ a: boolean; l: boolean; s: boolean }>(
    `select has_function_privilege('anon', 'public.marcar_assinatura(uuid,text,text,text)', 'execute') as a,
            has_function_privilege('authenticated', 'public.marcar_assinatura(uuid,text,text,text)', 'execute') as l,
            has_function_privilege('service_role', 'public.marcar_assinatura(uuid,text,text,text)', 'execute') as s`)).rows[0];
  assertEquals([quem.a, quem.l, quem.s], [false, false, true]);
  assertEquals((await assinaturaDe(db, userId)).status, "ativa");
});

Deno.test("cancelar: marcar_assinatura só aceita 'cancelada'", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  for (const status of ["ativa", "estornado", "trial", "qualquer"]) {
    let erro = "";
    try {
      await db.query(`select public.marcar_assinatura($1::uuid, $2, 'mercadopago', 'pa-1')`, [userId, status]);
    } catch (e) {
      erro = String(e);
    }
    assert(erro.includes("não é aceito"), `${status}: ${erro}`);
  }
});

/* ============================= 3a. excluir conta cancela ANTES de apagar, falha fechada */

Deno.test("excluir conta (MP): cancela o preapproval antes de apagar; se o cancelamento falha, a conta NÃO é apagada", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);

  await comServidores(db, g, async () => {
    const ordem: string[] = [];
    const apagar = async () => {
      ordem.push("deleteUser");
      return null;
    };

    // MP fora do ar: falha fechada
    g.cancelamentoFalha = true;
    const { resultado: falhou } = await capturandoErros(() => cancelarEApagar(userId, apagar));
    assertEquals(falhou, "gateway");
    assertEquals(ordem, [], "deleteUser não rodou");
    assertEquals(g.preapprovals.get("pa-1")!.status, "authorized");

    // MP de volta: cancela e SÓ DEPOIS apaga
    g.cancelamentoFalha = false;
    g.mutacoes.length = 0;
    const antes = async () => {
      ordem.push(`antes do deleteUser: ${g.mutacoes.join(",")}`);
      return null;
    };
    assertEquals(await cancelarEApagar(userId, antes), "ok");
    assertEquals(ordem, ["antes do deleteUser: mp PUT pa-1 cancelled"]);

    // erro ao apagar é devolvido
    const { resultado: erroApagar } = await capturandoErros(() => cancelarEApagar(userId, async () => ({ message: "banco caiu" })));
    assertEquals(erroApagar, "apagar");
  });
});

Deno.test("excluir conta (Asaas): cancela autorização e assinatura antes de apagar; falha do Asaas não apaga; quem nunca assinou apaga direto", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoPix(db, g);

  await comServidores(db, g, async () => {
    let apagou = 0;
    const apagar = async () => {
      apagou++;
      return null;
    };
    g.cancelamentoFalha = true;
    assertEquals((await capturandoErros(() => cancelarEApagar(userId, apagar))).resultado, "gateway");
    assertEquals(apagou, 0);

    g.cancelamentoFalha = false;
    g.mutacoes.length = 0;
    assertEquals(await cancelarEApagar(userId, apagar), "ok");
    assertEquals([apagou, g.mutacoes], [1, ["asaas DELETE autorizacao aut-1", "asaas DELETE assinatura sub_1"]]);

    // quem nunca abriu checkout não tem nada a cancelar
    const novo = await criarUsuario(db);
    g.mutacoes.length = 0;
    assertEquals(await cancelarEApagar(novo, apagar), "ok");
    assertEquals([apagou, g.mutacoes], [2, []]);
  });
});

/* ======================================== 3b. estorno e chargeback depois de pago */

Deno.test("estorno (MP): refunded e charged_back tiram o mês E cancelam a assinatura no gateway; o reenvio não tira 2 meses", async () => {
  for (const status of ["refunded", "charged_back"]) {
    const db = await criarPostgres();
    const g = new Gateways();
    const userId = await usuarioPagoNoCartao(db, g);
    assertEquals(await situacaoDe(db, userId), { status: "ativa", liberada: true });

    await comServidores(db, g, async () => {
      // aviso forjado: a API ainda diz aprovado sem devolução
      assertEquals((await (await avisoMP("payment", "1001")).json()).motivo, "aviso repetido");
      assertEquals((await assinaturaDe(db, userId)).status, "ativa");
      assertEquals(g.mutacoes, []);

      g.pagamentoMP("1001", userId, { status });
      const r = await avisoMP("payment", "1001");
      assertEquals([r.status, (await r.json()).tratado], [200, "estornado"]);
      assertEquals(await situacaoDe(db, userId), { status: "estornado", liberada: false });
      assertEquals(await pagamentosDe(db, userId), [{ gateway_pagamento_id: "1001", status: "estornado" }]);
      assertEquals(g.mutacoes, ["mp PUT pa-1 cancelled"], "cancelou a guardada no MP");

      // reenvio: não tira outro mês e não pede o cancelamento de novo (já está cancelado)
      const periodo = (await assinaturaDe(db, userId)).periodo_ate;
      assertEquals((await (await avisoMP("payment", "1001")).json()).motivo, "estorno repetido");
      assertEquals((await assinaturaDe(db, userId)).periodo_ate, periodo);
      assertEquals(g.mutacoes.length, 1);
    });
  }
});

Deno.test("estorno (MP): se o cancelamento no gateway falha, a rota dá 500; o reenvio devolve 'repetido' mas cancela de novo", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);

  await comServidores(db, g, async () => {
    g.pagamentoMP("1001", userId, { status: "refunded" });
    g.cancelamentoFalha = true;
    const { resultado: r } = await capturandoErros(() => avisoMP("payment", "1001"));
    assertEquals(r.status, 500, "o MP reenvia");
    // o período já foi tirado (o estorno gravou antes de cancelar)
    assertEquals((await situacaoDe(db, userId)).liberada, false);
    assertEquals(g.preapprovals.get("pa-1")!.status, "authorized");

    g.cancelamentoFalha = false;
    const periodo = (await assinaturaDe(db, userId)).periodo_ate;
    const r2 = await avisoMP("payment", "1001");
    assertEquals([r2.status, (await r2.json()).motivo], [200, "estorno repetido"]);
    assertEquals(g.preapprovals.get("pa-1")!.status, "cancelled", "o reenvio cancelou no gateway");
    assertEquals((await assinaturaDe(db, userId)).periodo_ate, periodo, "não tirou o 2º mês");
  });
});

Deno.test("estorno (MP): devolução PARCIAL depois do crédito não tira nada e só alerta; pagamento nunca creditado não revoga; devolvido por inteiro tira só o mês dele", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);

  await comServidores(db, g, async () => {
    g.pagamentoMP("1002", userId);
    assertEquals((await (await avisoMP("payment", "1002")).json()).tratado, "liberado");
    const dois = new Date((await assinaturaDe(db, userId)).periodo_ate!).getTime();

    // pagamento de ninguém (nunca creditado) devolvido: nada acontece, nada é cancelado
    g.pagamentoMP("9999", userId, { status: "refunded" });
    assertEquals((await (await avisoMP("payment", "9999")).json()).motivo, "pagamento com devolução");
    assertEquals(new Date((await assinaturaDe(db, userId)).periodo_ate!).getTime(), dois);
    assertEquals(g.mutacoes, []);

    // parcial (10 de 97,90): só ALERTA, o período e o gateway ficam como estão
    g.pagamentoMP("1001", userId, { transaction_amount_refunded: 10 });
    const { resultado: r, erros } = await capturandoErros(() => avisoMP("payment", "1001"));
    assertEquals((await r.json()).motivo, "pagamento com devolução");
    assert(erros.some((e) => e.includes("ALERTA devolucao_parcial")), "o alerta vai pro log: " + erros);
    assertEquals(new Date((await assinaturaDe(db, userId)).periodo_ate!).getTime(), dois);
    assertEquals(await pagamentosDe(db, userId), [{ gateway_pagamento_id: "1001", status: "aprovado" }, { gateway_pagamento_id: "1002", status: "aprovado" }]);
    assertEquals(g.mutacoes, []);

    // o 2º mês devolvido por inteiro (approved com tudo devolvido): tira 1 mês, segue ativa com o 1º, e cancela no gateway
    g.pagamentoMP("1002", userId, { transaction_amount_refunded: 97.9 });
    assertEquals((await (await avisoMP("payment", "1002")).json()).tratado, "estornado");
    const um = new Date((await assinaturaDe(db, userId)).periodo_ate!).getTime();
    const dias = (dois - um) / 86_400_000;
    assert(dias > 27 && dias < 32, `tirou ~1 mês, tirou ${dias.toFixed(1)} dias`);
    assertEquals(await situacaoDe(db, userId), { status: "ativa", liberada: true });
    assertEquals(g.mutacoes, ["mp PUT pa-1 cancelled"]);

    // o 1º também: agora não sobra nada
    g.pagamentoMP("1001", userId, { status: "charged_back" });
    assertEquals((await (await avisoMP("payment", "1001")).json()).tratado, "estornado");
    assertEquals(await situacaoDe(db, userId), { status: "estornado", liberada: false });
  });
});

Deno.test("estorno (Asaas): PAYMENT_REFUNDED conferido na API tira o mês E cancela autorização e assinatura; parcial só alerta; o corpo sozinho não revoga", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoPix(db, g);

  await comServidores(db, g, async () => {
    // aviso forjado: o evento diz estornado, a API diz que a cobrança segue paga
    let r = await avisoAsaas(eventoPag("PAYMENT_REFUNDED", "pay_1"));
    assertEquals((await r.json()).motivo, "cobrança sem devolução");
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");
    assertEquals((await avisoAsaas(eventoPag("PAYMENT_REFUNDED", "pay_1"), "errado")).status, 401);

    // devolução parcial: cobrança segue RECEIVED com devoluções: só alerta
    g.cobranca("pay_1", { refunds: [{ value: 10 }] });
    const parcial = await capturandoErros(() => avisoAsaas(eventoPag("PAYMENT_PARTIALLY_REFUNDED", "pay_1")));
    assertEquals((await parcial.resultado.json()).motivo, "devolução parcial");
    assert(parcial.erros.some((e) => e.includes("ALERTA devolucao_parcial")));
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");
    assertEquals(g.mutacoes, []);

    g.cobranca("pay_1", { status: "REFUNDED" });
    r = await avisoAsaas(eventoPag("PAYMENT_REFUNDED", "pay_1"));
    assertEquals([r.status, (await r.json()).tratado], [200, "estornado"]);
    assertEquals(await situacaoDe(db, userId), { status: "estornado", liberada: false });
    assertEquals(await pagamentosDe(db, userId), [{ gateway_pagamento_id: "pay_1", status: "estornado" }]);
    assertEquals(g.mutacoes, ["asaas DELETE autorizacao aut-1", "asaas DELETE assinatura sub_1"]);

    // reenvio: não tira outro mês; tenta cancelar de novo (autorização já cancelada: só garante a assinatura, 404 aceito)
    const periodo = (await assinaturaDe(db, userId)).periodo_ate;
    assertEquals((await (await avisoAsaas(eventoPag("PAYMENT_REFUNDED", "pay_1"))).json()).motivo, "estorno repetido");
    assertEquals((await assinaturaDe(db, userId)).periodo_ate, periodo);
    assertEquals(g.autorizacoes.get("aut-1")!.status, "CANCELLED");

    // cobrança que nunca creditamos e id malformado
    g.cobranca("pay_2", { status: "REFUNDED" });
    assertEquals((await (await avisoAsaas(eventoPag("PAYMENT_REFUNDED", "pay_2"))).json()).motivo, "cobrança nunca creditada");
    assertEquals((await (await avisoAsaas(eventoPag("PAYMENT_REFUNDED", "../x"))).json()).motivo, "aviso sem id de cobrança");
  });
});

Deno.test("estorno (Asaas): se o cancelamento no Asaas falha, a rota dá 500 e o reenvio cancela", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoPix(db, g);

  await comServidores(db, g, async () => {
    g.cobranca("pay_1", { status: "REFUNDED" });
    g.cancelamentoFalha = true;
    const { resultado: r } = await capturandoErros(() => avisoAsaas(eventoPag("PAYMENT_REFUNDED", "pay_1")));
    assertEquals(r.status, 500);
    assertEquals(g.autorizacoes.get("aut-1")!.status, "ACTIVE");
    g.cancelamentoFalha = false;
    assertEquals((await (await avisoAsaas(eventoPag("PAYMENT_REFUNDED", "pay_1"))).json()).motivo, "estorno repetido");
    assertEquals(g.autorizacoes.get("aut-1")!.status, "CANCELLED");
    assertEquals((await situacaoDe(db, userId)).liberada, false);
  });
});

Deno.test("estorno: depois de estornado, um pagamento novo volta a liberar", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);
  await comServidores(db, g, async () => {
    g.pagamentoMP("1001", userId, { status: "refunded" });
    await avisoMP("payment", "1001");
    assertEquals((await situacaoDe(db, userId)).liberada, false);
    g.pagamentoMP("1003", userId);
    assertEquals((await (await avisoMP("payment", "1003")).json()).tratado, "liberado");
    assertEquals(await situacaoDe(db, userId), { status: "ativa", liberada: true });
  });
});

/* ================= botão com o gateway já cancelado, pagamento depois de cancelar, 404 do MP */

Deno.test("botão: gateway já cancelado marca cancelada (a API confirmou); teste e id que não é o guardado não mudam", async () => {
  // cartão: cancelado direto no MP, aviso perdido
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);
  await comServidores(db, g, async () => {
    g.preapprovals.get("pa-1")!.status = "cancelled";
    assertEquals(await cancelarPeloBotao(userId), "ja_cancelado");
    assertEquals(g.mutacoes, [], "não pediu de novo");
    assertEquals(await situacaoDe(db, userId), { status: "cancelada", liberada: true });
    // clicar de novo continua coerente
    assertEquals(await cancelarPeloBotao(userId), "ja_cancelado");
    assertEquals((await assinaturaDe(db, userId)).status, "cancelada");
  });

  // Pix: autorização já CANCELLED no Asaas
  const db2 = await criarPostgres();
  const g2 = new Gateways();
  const u2 = await usuarioPagoNoPix(db2, g2);
  await comServidores(db2, g2, async () => {
    g2.autorizacoes.get("aut-1")!.status = "CANCELLED";
    assertEquals(await cancelarPeloBotao(u2), "ja_cancelado");
    assertEquals((await assinaturaDe(db2, u2)).status, "cancelada");
  });

  // quem está só no teste (checkout pendente já cancelado) continua no teste
  const db3 = await criarPostgres();
  const g3 = new Gateways();
  const u3 = await criarUsuario(db3);
  await db3.query(`select public.guardar_preapproval($1::uuid, 'pa-1', 9790)`, [u3]);
  g3.preapproval("pa-1", u3, "cancelled");
  await comServidores(db3, g3, async () => {
    assertEquals(await cancelarPeloBotao(u3), "ja_cancelado");
    assertEquals(await situacaoDe(db3, u3), { status: "trial", liberada: true });
  });
});

Deno.test("botão: gateway ainda cobrando só pede o cancelamento e não grava; sem assinatura = nada", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);
  await comServidores(db, g, async () => {
    assertEquals(await cancelarPeloBotao(userId), "cancelado");
    assertEquals(g.mutacoes, ["mp PUT pa-1 cancelled"]);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa", "o aviso é que muda");
    assertEquals(await cancelarPeloBotao(await criarUsuario(db)), "nada");
  });
});

Deno.test("pagamento que chega com a assinatura cancelada dá o mês mas MANTÉM cancelada; assinar de novo desfaz o cancelamento", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);
  g.preapprovals.get("pa-1")!.status = "cancelled";

  await comServidores(db, g, async () => {
    await avisoMP("subscription_preapproval", "pa-1");
    assertEquals((await assinaturaDe(db, userId)).status, "cancelada");
    const antes = new Date((await assinaturaDe(db, userId)).periodo_ate!).getTime();

    // a cobrança que já estava a caminho quando o cliente cancelou
    g.pagamentoMP("1002", userId);
    assertEquals((await (await avisoMP("payment", "1002")).json()).tratado, "liberado");
    const depois = await assinaturaDe(db, userId);
    assertEquals(depois.status, "cancelada", "não ressuscita");
    const dias = (new Date(depois.periodo_ate!).getTime() - antes) / 86_400_000;
    assert(dias > 27 && dias < 32, `o mês entrou: ${dias.toFixed(1)} dias`);
    assertEquals(await situacaoDe(db, userId), { status: "cancelada", liberada: true });

    // assina de novo (checkout novo, com período pago sobrando): volta a ativa
    await db.query(`select public.guardar_preapproval($1::uuid, 'pa-2', 9790)`, [userId]);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");
    // sem período sobrando: vencida até o 1º pagamento do checkout novo, que então ativa
    await db.query(`update public.assinaturas set status = 'cancelada', periodo_ate = now() - interval '1 day' where user_id = $1`, [userId]);
    await db.query(`select public.guardar_preapproval($1::uuid, 'pa-3', 9790)`, [userId]);
    assertEquals((await situacaoDe(db, userId)).status, "vencida");
    g.preapproval("pa-3", userId);
    g.pagamentoMP("1003", userId, { preapproval_id: "pa-3" });
    assertEquals((await (await avisoMP("payment", "1003")).json()).tratado, "liberado");
    assertEquals(await situacaoDe(db, userId), { status: "ativa", liberada: true });
  });

  // o mesmo no Pix: nova autorização desfaz o cancelamento (tinha período pago)
  const db2 = await criarPostgres();
  const g2 = new Gateways();
  const u2 = await usuarioPagoNoPix(db2, g2);
  await db2.query(`update public.assinaturas set status = 'cancelada' where user_id = $1`, [u2]);
  await db2.query(`select public.guardar_autorizacao_asaas($1::uuid, 'cus_1', 'aut-2', 9790)`, [u2]);
  assertEquals((await assinaturaDe(db2, u2)).status, "ativa");
});

Deno.test("excluir conta (MP): preapproval que nem existe mais (404) não prende a exclusão; erro 5xx continua falhando fechado", async () => {
  const db = await criarPostgres();
  const g = new Gateways();
  const userId = await usuarioPagoNoCartao(db, g);

  await comServidores(db, g, async () => {
    let apagou = 0;
    const apagar = async () => {
      apagou++;
      return null;
    };
    // MP fora do ar na consulta (5xx): a conta fica
    g.consultaMPFalha = true;
    assertEquals((await capturandoErros(() => cancelarEApagar(userId, apagar))).resultado, "gateway");
    assertEquals(apagou, 0);
    g.consultaMPFalha = false;

    // o MP diz 404: não existe mais, nada cobrando, apaga (e não pediu cancelamento)
    g.preapprovals.delete("pa-1");
    assertEquals(await cancelarEApagar(userId, apagar), "ok");
    assertEquals([apagou, g.mutacoes], [1, []]);
  });
});
