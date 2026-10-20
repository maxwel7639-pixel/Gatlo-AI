import { assert, assertEquals, assertRejects } from "@std/assert";
import type { PGlite } from "@electric-sql/pglite";
import { criarPostgres, criarUsuario } from "./pg.ts";
import {
  processarAviso,
  receberAviso,
  type RegistroPagamento,
  type ResultadoRegistro,
} from "../../../lib/mp-webhook.ts";
import { abrirCheckout, type DepsCheckout } from "../../../lib/mp-checkout.ts";
import { assinaturaValida } from "../../../lib/mp-assinatura.ts";
import { criarAssinatura, lerReferencia } from "../../../lib/mercadopago.ts";

/**
 * A cobrança do cartão (assinatura recorrente do Mercado Pago, `preapproval`)
 * com o MP SIMULADO: o fetch global vira um falso que responde como a API deles
 * (o script teste:funcoes roda sem --allow-net) e o banco é o PGlite com as
 * migrations todas — o mesmo `registrar_pagamento` que a rota chama no Supabase.
 * Nenhum centavo sai daqui e nenhum pedido sai daqui.
 *
 * A prova destes testes: um aviso forjado não libera nada; pagamento aprovado
 * libera e empurra o período em 1 mês; o mesmo aviso duas vezes não credita
 * dobrado; valor abaixo do preço não libera.
 */

process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-teste-falso";
const SEGREDO = "segredo-falso-do-mp";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SEGREDO;

/** O cabeçalho x-signature que o MP mandaria: HMAC-SHA256 do manifesto com o segredo. */
async function assinar(dataId: string, requestId: string, ts = "1700000000", segredo = SEGREDO): Promise<string> {
  const cod = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(cod.encode(segredo)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new Uint8Array(cod.encode(manifesto))));
  return `ts=${ts},v1=${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

type Registrar = (r: RegistroPagamento) => Promise<ResultadoRegistro>;

/** O banco por trás de `estornar_pagamento` (0007): o mesmo RPC que a rota usa. */
async function depsWebhookSobrePg(db: PGlite) {
  return {
    estornar: async (e: { gateway: "mercadopago" | "asaas"; gatewayPagamentoId: string }) =>
      (await db.query<{ r: "estornado" | "repetido" | "desconhecido" }>(
        `select public.estornar_pagamento($1::text, $2::text) as r`, [e.gateway, e.gatewayPagamentoId])).rows[0].r,
    cancelar: async () => {},
  };
}

/** O banco por trás da dependência `registrar`: o mesmo RPC que a rota usa. */
async function registrarSobrePg(db: PGlite): Promise<Registrar> {
  return async (r) => {
    const x = await db.query<{ registrar_pagamento: ResultadoRegistro }>(
      `select public.registrar_pagamento($1::text, $2::text, $3::uuid, $4::int, $5::text)
         as registrar_pagamento`,
      [r.gateway, r.gatewayPagamentoId, r.userId, r.valorCentavos, r.gatewayAssinaturaId],
    );
    return x.rows[0].registrar_pagamento;
  };
}

type Assinatura = {
  status: string;
  gateway: string | null;
  gateway_assinatura_id: string | null;
  valor_centavos: number | null;
  periodo_ate: string | null;
};

const assinaturaDe = async (db: PGlite, userId: string) =>
  (await db.query<Assinatura>(
    `select status, gateway, gateway_assinatura_id, valor_centavos, periodo_ate
       from public.assinaturas where user_id = $1`,
    [userId],
  )).rows[0];

const pagamentosDe = async (db: PGlite, userId: string) =>
  (await db.query<{ status: string; valor_centavos: number; gateway_pagamento_id: string }>(
    `select status, valor_centavos, gateway_pagamento_id from public.pagamentos
      where user_id = $1 order by criado_em`,
    [userId],
  )).rows;

/** Como o checkout faz: guarda o preapproval (e o preço da época) do usuário. Só pagamento desse preapproval credita. */
const guardarPreapproval = (db: PGlite, userId: string, id = "pa-1", valorCentavos = 9790) =>
  db.query(`select public.guardar_preapproval($1::uuid, $2::text, $3::int)`, [userId, id, valorCentavos]);

const roboliberado = async (db: PGlite, userId: string) =>
  (await db.query<{ liberada: boolean }>(`select liberada from public.assinatura_situacao($1)`, [userId])).rows[0]
    .liberada;

/** Mercado Pago simulado: cada pedido vira um Response do roteiro de teste. */
function comMP<T>(
  api: (pedido: Request, n: number) => Response | undefined,
  f: (pedidos: Request[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const pedidos: Request[] = [];
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const pedido = new Request(entrada as RequestInfo, init);
    pedidos.push(pedido);
    return Promise.resolve(api(pedido, pedidos.length) ?? Response.json({ message: "fora do roteiro" }, { status: 500 }));
  }) as typeof fetch;
  return f(pedidos).finally(() => {
    globalThis.fetch = original;
  });
}

const idDoCaminho = (p: Request) => new URL(p.url).pathname.split("/").pop() ?? "";

Deno.test("cobrança: o preço vem de regras (banco) e não existe escrito no código do MP", async () => {
  const db = await criarPostgres();
  const preco = Number(
    (await db.query<{ preco: string }>(`select public.regra('preco_mensal_centavos') as preco`)).rows[0].preco,
  );
  assertEquals(preco, 9790, "o preço do produto é regra do banco, como o PLANO mandou");

  const fonte = await Deno.readTextFile(new URL("../../../lib/mercadopago.ts", import.meta.url));
  assert(!fonte.includes("9790") && !fonte.includes("97.9"), "não pode ter preço de assinatura escrito no código");
  assert(fonte.includes("o.precoCentavos / 100"), "o valor que vai pro MP é o que quem chamou mandou");

  const userId = await criarUsuario(db);
  await comMP(
    () => Response.json({ id: "pa-novo", init_point: "https://mp.example/checkout/abc", sandbox_init_point: null }),
    async (pedidos) => {
      const r = await criarAssinatura({ userId, email: "cliente@exemplo.invalid", precoCentavos: preco });
      assertEquals(r, { id: "pa-novo", url: "https://mp.example/checkout/abc" }, "o cliente vai pro checkout do MP");

      const [p] = pedidos;
      const u = new URL(p.url);
      assertEquals(`${u.origin}${u.pathname}`, "https://api.mercadopago.com/preapproval");
      assertEquals(p.method, "POST");
      assertEquals(p.headers.get("authorization"), "Bearer APP_USR-teste-falso");
      assertEquals(p.headers.get("x-idempotency-key"), `assinatura-${userId}-primeira`, "o duplo clique manda a mesma chave");

      const corpo = (await p.json()) as Record<string, unknown>;
      const recorrente = corpo.auto_recurring as Record<string, unknown>;
      assertEquals(recorrente.transaction_amount, preco / 100, "em reais, e é o preço do banco");
      assertEquals(recorrente.frequency, 1);
      assertEquals(recorrente.frequency_type, "months");
      assertEquals(recorrente.currency_id, "BRL");
      assertEquals(corpo.external_reference, `assinatura|${userId}`);
      assertEquals(corpo.payer_email, "cliente@exemplo.invalid");
      assertEquals(corpo.status, "pending");
      assert(String(corpo.notification_url).endsWith("/api/mercadopago-webhook"), "o aviso cai na nossa rota");
    },
  );
});

Deno.test("cobrança: aviso forjado não libera nada (o MP nem conhece aquele id)", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const registrar = await registrarSobrePg(db);

  await comMP(
    () => Response.json({ message: "not found" }, { status: 404 }),
    async () => {
      const r = await processarAviso({ tipo: "payment", id: "999999" }, registrar);

      assertEquals(r.tratado, "erro", "a resposta é erro, então a rota manda 500 e o MP tenta de novo");
      assertEquals(await pagamentosDe(db, userId), [], "nada foi registrado");
      const a = await assinaturaDe(db, userId);
      assertEquals(a.status, "trial", "a assinatura continuou de teste");
      assertEquals(a.periodo_ate, null, "o período não andou");
    },
  );
});

Deno.test("cobrança: o corpo diz aprovado, a API diz pending — não libera", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const registrar = await registrarSobrePg(db);

  await comMP(
    (p) =>
      Response.json({
        id: idDoCaminho(p),
        status: "pending",
        transaction_amount: 97.9,
        external_reference: `assinatura|${userId}`,
        preapproval_id: null,
        currency_id: "BRL",
        transaction_amount_refunded: 0,
      }),
    async () => {
      const r = await processarAviso({ tipo: "payment", id: "42" }, registrar);

      assertEquals(r, { tratado: "ignorado", motivo: "pagamento pending" });
      assertEquals(await pagamentosDe(db, userId), []);
      assertEquals((await assinaturaDe(db, userId)).status, "trial");
    },
  );
});

Deno.test("cobrança: pagamento aprovado libera o robô e empurra o período em 1 mês", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  await guardarPreapproval(db, userId);
  const registrar = await registrarSobrePg(db);

  await comMP(
    (p) =>
      Response.json({
        id: idDoCaminho(p),
        status: "approved",
        transaction_amount: 97.9,
        external_reference: `assinatura|${userId}`,
        preapproval_id: "pa-1",
        currency_id: "BRL",
        transaction_amount_refunded: 0,
      }),
    async () => {
      const r = await processarAviso({ tipo: "payment", id: "1001" }, registrar);
      assertEquals(r, { tratado: "liberado", userId });

      const a = await assinaturaDe(db, userId);
      assertEquals(a.status, "ativa");
      assertEquals(a.gateway, "mercadopago");
      assertEquals(a.gateway_assinatura_id, "pa-1");
      assertEquals(a.valor_centavos, 9790);
      const dias = (new Date(a.periodo_ate!).getTime() - Date.now()) / 86_400_000;
      assert(dias > 26 && dias < 33, `o período devia andar ~1 mês, andou ${dias.toFixed(1)} dias`);

      const pgs = await pagamentosDe(db, userId);
      assertEquals(pgs.length, 1);
      assertEquals(pgs[0].status, "aprovado");
      assertEquals(pgs[0].gateway_pagamento_id, "1001");
      assertEquals(await roboliberado(db, userId), true, "assinatura_situacao libera o robô");
    },
  );
});

Deno.test("cobrança: o mesmo aviso duas vezes não credita dobrado", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  await guardarPreapproval(db, userId);
  const registrar = await registrarSobrePg(db);

  await comMP(
    (p) =>
      Response.json({
        id: idDoCaminho(p),
        status: "approved",
        transaction_amount: 97.9,
        external_reference: `assinatura|${userId}`,
        preapproval_id: "pa-1",
        currency_id: "BRL",
        transaction_amount_refunded: 0,
      }),
    async () => {
      const primeiro = await processarAviso({ tipo: "payment", id: "1001" }, registrar);
      assertEquals(primeiro, { tratado: "liberado", userId });
      const depoisDoPrimeiro = await assinaturaDe(db, userId);

      // o MP reenvia o mesmo aviso (e o painel deles deixa reenviar na mão)
      const segundo = await processarAviso({ tipo: "payment", id: "1001" }, registrar);
      assertEquals(segundo.tratado, "ignorado");

      assertEquals((await pagamentosDe(db, userId)).length, 1, "um pagamento na tabela, não dois");
      const depoisDoSegundo = await assinaturaDe(db, userId);
      assertEquals(depoisDoSegundo.periodo_ate, depoisDoPrimeiro.periodo_ate, "o período não andou duas vezes");
      assertEquals(depoisDoSegundo.valor_centavos, 9790);
    },
  );
});

Deno.test("cobrança: valor abaixo do preço não libera (fica registrado como divergente)", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  await guardarPreapproval(db, userId);
  const registrar = await registrarSobrePg(db);

  await comMP(
    (p) =>
      Response.json({
        id: idDoCaminho(p),
        status: "approved",
        transaction_amount: 90,
        external_reference: `assinatura|${userId}`,
        preapproval_id: "pa-1",
        currency_id: "BRL",
        transaction_amount_refunded: 0,
      }),
    async () => {
      const r = await processarAviso({ tipo: "payment", id: "777" }, registrar);

      assertEquals(r.tratado, "ignorado", "aprovado, mas o valor não cobre o preço de regras");
      const pgs = await pagamentosDe(db, userId);
      assertEquals(pgs.length, 1, "o pagamento fica guardado como prova");
      assertEquals(pgs[0].status, "valor_divergente");
      assertEquals(pgs[0].valor_centavos, 9000);
      const a = await assinaturaDe(db, userId);
      assertEquals(a.status, "trial", "a assinatura continuou de teste");
      assertEquals(a.periodo_ate, null, "o período não andou um centavo");
    },
  );
});

const respostaDoPagamento = (
  userId: string,
  valor = 97.9,
  status = "approved",
  extra: Record<string, unknown> = {},
) =>
(p: Request) =>
  Response.json({
    id: idDoCaminho(p),
    status,
    transaction_amount: valor,
    external_reference: `assinatura|${userId}`,
    preapproval_id: "pa-1",
    currency_id: "BRL",
    transaction_amount_refunded: 0,
    ...extra,
  });

Deno.test("cobrança: assinatura autorizada sozinha não libera; autorizada + 1º pagamento = 1 mês, não 2", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  await guardarPreapproval(db, userId);
  const registrar = await registrarSobrePg(db);

  await comMP(respostaDoPagamento(userId), async (pedidos) => {
    // o MP avisa "preapproval" (autorizada) e "payment" (o 1º débito): são ids diferentes
    const a = await processarAviso({ tipo: "preapproval", id: "pa-1" }, registrar);
    assertEquals(a.tratado, "ignorado", "autorizar não é dinheiro na conta");
    // desde o C3 o aviso de preapproval consulta a API (para ver se foi cancelado), mas não credita
    assertEquals(pedidos.length, 1, "só a consulta do preapproval");
    assertEquals((await assinaturaDe(db, userId)).status, "trial");

    assertEquals(await processarAviso({ tipo: "payment", id: "5001" }, registrar), { tratado: "liberado", userId });
    const depois = await assinaturaDe(db, userId);
    assertEquals(depois.gateway_assinatura_id, "pa-1", "o preapproval fica guardado para o cancelamento (C3)");
    assertEquals((await pagamentosDe(db, userId)).length, 1);

    // reenvio do aviso de preapproval e do pagamento: o período não anda
    await processarAviso({ tipo: "preapproval", id: "pa-1" }, registrar);
    await processarAviso({ tipo: "payment", id: "5001" }, registrar);
    assertEquals((await assinaturaDe(db, userId)).periodo_ate, depois.periodo_ate);
  });
});

Deno.test("cobrança: a rota rejeita assinatura errada, ausente ou sem segredo, sem consultar o MP nem tocar no banco", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  let chamadas = 0;
  const registrarSobre = await registrarSobrePg(db);
  const registrar: Registrar = (r) => {
    chamadas++;
    return registrarSobre(r);
  };
  const aviso = { tipo: "payment", id: "9001", requestId: "req-9" };

  // a API simulada diria "aprovado": o aviso forjado só liberaria se a trava da assinatura falhasse
  await comMP(respostaDoPagamento(userId), async (pedidos) => {
    const casos: [string, string | null][] = [
      ["ausente", null],
      ["lixo", "ts=1,v1=xx"],
      ["segredo errado", await assinar("9001", "req-9", "1700000000", "outro-segredo")],
      ["id trocado (assinou o 1, mandou o 9001)", await assinar("1", "req-9")],
    ];
    for (const [nome, assinatura] of casos) {
      const r = await receberAviso({ ...aviso, assinatura }, registrar);
      assertEquals(r.status, 401, `assinatura ${nome} tem que dar 401`);
      assertEquals(r.corpo, { erro: "não autorizado" }, `${nome}: a resposta não conta o motivo a um anônimo`);
    }

    const guardado = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    try {
      const r = await receberAviso({ ...aviso, assinatura: await assinar("9001", "req-9") }, registrar);
      assertEquals(r.status, 401, "sem MERCADOPAGO_WEBHOOK_SECRET nada passa (falha fechada)");
      assertEquals(r.corpo, { erro: "não autorizado" }, "e não conta que falta o segredo");
    } finally {
      process.env.MERCADOPAGO_WEBHOOK_SECRET = guardado;
    }

    assertEquals(pedidos.length, 0, "nenhuma chamada à API do MP");
    assertEquals(chamadas, 0, "registrar_pagamento nunca foi chamado");
  });
  assertEquals(await pagamentosDe(db, userId), []);
  const a = await assinaturaDe(db, userId);
  assertEquals(a.status, "trial");
  assertEquals(a.periodo_ate, null, "o período não andou");
});

Deno.test("cobrança: assinatura boa, mas a API diz outra coisa do que o corpo diz — não libera", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const registrar = await registrarSobrePg(db);
  const assinatura = await assinar("9002", "req-1");

  // o corpo (que só o atacante escreve) fala "approved"; a API do MP fala outra coisa
  for (const status of ["pending", "rejected", "cancelled", "refunded"]) {
    await comMP(respostaDoPagamento(userId, 97.9, status), async () => {
      const r = await receberAviso({ tipo: "payment", id: "9002", assinatura, requestId: "req-1" }, registrar, await depsWebhookSobrePg(db));
      assertEquals(r.status, 200);
      assertEquals(r.corpo.tratado, "ignorado", `status ${status} na API não libera`);
    });
  }
  assertEquals(await pagamentosDe(db, userId), []);
  assertEquals((await assinaturaDe(db, userId)).status, "trial");

  // a API não conhece o id (aviso inventado): erro → 500, o MP reenvia; nada creditado
  await comMP(() => Response.json({ message: "not found" }, { status: 404 }), async () => {
    const r = await receberAviso({ tipo: "payment", id: "9002", assinatura, requestId: "req-1" }, registrar);
    assertEquals(r.status, 500);
  });
  assertEquals(await pagamentosDe(db, userId), []);
});

Deno.test("cobrança: pela rota, aviso bom libera 1 mês e o mesmo aviso de novo não credita dobrado", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  await guardarPreapproval(db, userId);
  const registrar = await registrarSobrePg(db);
  const aviso = { tipo: "payment", id: "5002", assinatura: await assinar("5002", "req-2"), requestId: "req-2" };

  await comMP(respostaDoPagamento(userId), async () => {
    assertEquals(await receberAviso(aviso, registrar), { status: 200, corpo: { tratado: "liberado" } });
    const periodo = (await assinaturaDe(db, userId)).periodo_ate;

    const dois = await receberAviso(aviso, registrar);
    assertEquals(dois.status, 200, "repetido não é erro: o MP para de reenviar");
    assertEquals(dois.corpo.tratado, "ignorado");
    assertEquals((await pagamentosDe(db, userId)).length, 1);
    assertEquals((await assinaturaDe(db, userId)).periodo_ate, periodo);
  });
});

Deno.test("cobrança: falha ao gravar vira 500 (o MP reenvia), não 'ignorado'", async () => {
  const userId = "0b2f9a10-1234-4abc-9def-000000000001";
  await comMP(respostaDoPagamento(userId), async () => {
    const r = await receberAviso(
      { tipo: "payment", id: "5003", assinatura: await assinar("5003", "req-3"), requestId: "req-3" },
      () => Promise.reject(new Error("banco fora do ar")),
    );
    assertEquals(r.status, 500);
  });
});

Deno.test("cobrança: o cliente logado não chama registrar_pagamento nem escreve na própria assinatura", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false)`);
  let negou = 0;
  try {
    for (const sql of [
      `select public.registrar_pagamento('mercadopago', 'x1', '${userId}'::uuid, 9790, null)`,
      `update public.assinaturas set status = 'ativa', periodo_ate = now() + interval '1 year' where user_id = '${userId}'`,
      `insert into public.pagamentos (gateway, gateway_pagamento_id, user_id, status, valor_centavos)
         values ('mercadopago', 'x2', '${userId}', 'aprovado', 9790)`,
      `select public.guardar_preapproval('${userId}'::uuid, 'pa-x', 1)`,
    ]) {
      try {
        await db.query(sql);
      } catch {
        negou++;
      }
    }
  } finally {
    await db.exec(`reset role`);
  }
  assertEquals(negou, 4, "as 4 tentativas têm que ser negadas pelo banco");
  assertEquals((await assinaturaDe(db, userId)).status, "trial");
  assertEquals(await pagamentosDe(db, userId), []);
});

Deno.test("cobrança: a assinatura do cabeçalho confere o manifesto inteiro (id, request-id e ts)", async () => {
  const hex = (await assinar("123", "req-1")).split("v1=")[1];
  assertEquals(await assinaturaValida(`ts=1700000000,v1=${hex}`, "req-1", "123"), { valida: true });
  assertEquals((await assinaturaValida(null, "req-1", "123")).valida, false, "sem header não passa");
  assertEquals((await assinaturaValida("ts=1,v1=xx", "req-1", "123")).valida, false, "malformado não passa");
  assertEquals((await assinaturaValida(`ts=1700000001,v1=${hex}`, "req-1", "123")).valida, false, "ts trocado muda o hash");
  assertEquals((await assinaturaValida(`ts=1700000000,v1=${"0".repeat(64)}`, "req-1", "123")).valida, false);
  assertEquals((await assinaturaValida(`ts=1700000000,v1=${hex}`, "outro-request", "123")).valida, false);
  assertEquals((await assinaturaValida(`ts=1700000000,v1=${hex}`, "req-1", "124")).valida, false, "id trocado");
});

Deno.test("cobrança: a referência só aceita assinatura com uuid de verdade", () => {
  const uuid = "0b2f9a10-1234-4abc-9def-000000000001";
  assertEquals(lerReferencia(`assinatura|${uuid}`), { tipo: "assinatura", userId: uuid });
  assertEquals(lerReferencia("assinatura|abc"), null, "sem uuid não é gente");
  assertEquals(lerReferencia("isca|123"), null, "outro tipo de referência não libera assinatura");
  assertEquals(lerReferencia(null), null);
  assertEquals(lerReferencia(""), null);
});


/* ------------------------------------------------------------------ */
/* Os achados dos conferentes do C1                                    */
/* ------------------------------------------------------------------ */

/** Pega o que o código manda para console.error (o alerta que o Maxwel vê no log da Vercel). */
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

const mudarPreco = (db: PGlite, centavos: number) =>
  db.exec(`update public.regras set valor = ${centavos} where chave = 'preco_mensal_centavos'`);

/** O miolo do checkout ligado ao banco de verdade (PGlite), como a ação liga ao Supabase. */
function depsSobrePg(db: PGlite, userId: string): DepsCheckout {
  return {
    lerPreco: async () =>
      Number((await db.query<{ v: string }>(`select public.regra('preco_mensal_centavos') as v`)).rows[0].v),
    assinaturaAtual: async () => {
      const r = (await db.query<{ status: string; gateway: string | null; gateway_assinatura_id: string | null }>(
        `select status, gateway, gateway_assinatura_id from public.assinaturas where user_id = $1`,
        [userId],
      )).rows[0];
      return r ? { status: r.status, gateway: r.gateway, gatewayAssinaturaId: r.gateway_assinatura_id } : null;
    },
    guardar: async (id, valor) => {
      const r = await db.query<{ ok: boolean }>(
        `select public.guardar_preapproval($1::uuid, $2::text, $3::int) as ok`,
        [userId, id, valor],
      );
      if (r.rows[0].ok !== true) throw new Error("não gravou");
    },
  };
}

/** MP simulado do checkout: POST /preapproval cria pa-1, pa-2...; GET /preapproval/<id> responde o estado do roteiro. */
function mpDoCheckout(estados: Record<string, string>, prefixo = "pa") {
  let criados = 0;
  return (p: Request) => {
    if (p.method === "POST") {
      const id = `${prefixo}-${++criados}`;
      estados[id] = "pending";
      return Response.json({ id, init_point: `https://mp.example/checkout/${id}`, sandbox_init_point: null });
    }
    const id = idDoCaminho(p);
    return id in estados
      ? Response.json({ id, status: estados[id], init_point: `https://mp.example/checkout/${id}` })
      : Response.json({ message: "not found" }, { status: 404 });
  };
}

const criacoes = (pedidos: Request[]) => pedidos.filter((p) => p.method === "POST");

Deno.test("checkout: o preço enviado ao MP é o de regras no servidor (muda quando regras muda) e o id e o preço da época ficam guardados", async () => {
  const db = await criarPostgres();
  const u1 = await criarUsuario(db);
  const u2 = await criarUsuario(db);

  await comMP(mpDoCheckout({}), async (pedidos) => {
    // abrirCheckout não tem onde receber preço: o único caminho é lerPreco (regras)
    assertEquals(await abrirCheckout({ id: u1, email: "a@exemplo.invalid" }, depsSobrePg(db, u1)), {
      url: "https://mp.example/checkout/pa-1",
    });
    const corpo1 = (await criacoes(pedidos)[0].json()) as { auto_recurring: { transaction_amount: number } };
    assertEquals(corpo1.auto_recurring.transaction_amount, 97.9);

    const a = await assinaturaDe(db, u1);
    assertEquals([a.status, a.gateway, a.gateway_assinatura_id, a.valor_centavos], ["trial", "mercadopago", "pa-1", 9790]);

    await mudarPreco(db, 12000);
    await abrirCheckout({ id: u2, email: "b@exemplo.invalid" }, depsSobrePg(db, u2));
    const corpo2 = (await criacoes(pedidos)[1].json()) as { auto_recurring: { transaction_amount: number } };
    assertEquals(corpo2.auto_recurring.transaction_amount, 120, "preço novo de regras, vindo do servidor");
    assertEquals((await assinaturaDe(db, u2)).valor_centavos, 12000);
  });
});

Deno.test("checkout: 2º clique com checkout pendente devolve o MESMO checkout, sem criar outro preapproval", async () => {
  const db = await criarPostgres();
  const u = await criarUsuario(db);
  const deps = depsSobrePg(db, u);

  await comMP(mpDoCheckout({}), async (pedidos) => {
    const um = await abrirCheckout({ id: u, email: "a@exemplo.invalid" }, deps);
    const dois = await abrirCheckout({ id: u, email: "a@exemplo.invalid" }, deps);
    assertEquals(dois, um, "o mesmo link");
    assertEquals(criacoes(pedidos).length, 1, "um preapproval só");
  });
});

Deno.test("checkout: preapproval já autorizado ou pausado no MP recusa novo checkout, mesmo com a assinatura 'vencida' ou 'trial' no banco", async () => {
  for (const estado of ["authorized", "paused"]) {
    for (const statusNoBanco of ["trial", "vencida"]) {
      const db = await criarPostgres();
      const u = await criarUsuario(db);
      const estados: Record<string, string> = {};
      await comMP(mpDoCheckout(estados), async (pedidos) => {
        await abrirCheckout({ id: u, email: "a@exemplo.invalid" }, depsSobrePg(db, u));
        // cartão recusado e o MP tentando de novo (vencida), ou o 1º aviso que atrasou (trial)
        estados["pa-1"] = estado;
        await db.query(`update public.assinaturas set status = $2 where user_id = $1`, [u, statusNoBanco]);

        const r = await abrirCheckout({ id: u, email: "a@exemplo.invalid" }, depsSobrePg(db, u));
        assert("erro" in r, `${estado}/${statusNoBanco}: tem que recusar`);
        assertEquals(criacoes(pedidos).length, 1, "nenhum 2º preapproval");
      });
    }
  }
});

Deno.test("checkout: preapproval cancelado no MP permite criar outro (chave de idempotência nova); assinatura ativa e MP fora do ar recusam", async () => {
  const db = await criarPostgres();
  const u = await criarUsuario(db);
  const estados: Record<string, string> = {};

  await comMP(mpDoCheckout(estados), async (pedidos) => {
    await abrirCheckout({ id: u, email: "a@exemplo.invalid" }, depsSobrePg(db, u));
    estados["pa-1"] = "cancelled";
    const r = await abrirCheckout({ id: u, email: "a@exemplo.invalid" }, depsSobrePg(db, u));
    assertEquals(r, { url: "https://mp.example/checkout/pa-2" });
    assertEquals(criacoes(pedidos)[1].headers.get("x-idempotency-key"), `assinatura-${u}-pa-1`);
    assertEquals((await assinaturaDe(db, u)).gateway_assinatura_id, "pa-2", "o id novo fica guardado");
  });

  // assinatura ativa: nem pergunta ao MP
  await db.query(`update public.assinaturas set status = 'ativa' where user_id = $1`, [u]);
  await comMP(mpDoCheckout(estados), async (pedidos) => {
    const r = await abrirCheckout({ id: u, email: "a@exemplo.invalid" }, depsSobrePg(db, u));
    assertEquals(r, { erro: "A tua assinatura já está ativa." });
    assertEquals(pedidos.length, 0);
  });

  // sem saber o estado no MP, não cria outro (falha fechada)
  await db.query(`update public.assinaturas set status = 'vencida' where user_id = $1`, [u]);
  await comMP(() => Response.json({ message: "fora" }, { status: 503 }), async (pedidos) => {
    await assertRejects(() => abrirCheckout({ id: u, email: "a@exemplo.invalid" }, depsSobrePg(db, u)));
    assertEquals(criacoes(pedidos).length, 0);
  });
});

Deno.test("preço travado por assinatura: reajuste em regras não prende quem já assinou; assinatura nova paga o preço novo", async () => {
  const db = await criarPostgres();
  const antigo = await criarUsuario(db);
  const novo = await criarUsuario(db);
  const registrar = await registrarSobrePg(db);

  await comMP(mpDoCheckout({}), async () => {
    await abrirCheckout({ id: antigo, email: "a@exemplo.invalid" }, depsSobrePg(db, antigo)); // pa-1 a 97,90
  });
  await mudarPreco(db, 12000); // o preço sobe depois da assinatura criada

  await comMP(respostaDoPagamento(antigo), async () => {
    const um = await processarAviso({ tipo: "payment", id: "7001" }, registrar);
    assertEquals(um, { tratado: "liberado", userId: antigo }, "o 1º débito é o preço da época");
    const dois = await processarAviso({ tipo: "payment", id: "7002" }, registrar);
    assertEquals(dois, { tratado: "liberado", userId: antigo }, "o débito do mês seguinte também");
    const a = await assinaturaDe(db, antigo);
    assertEquals(a.status, "ativa");
    const dias = (new Date(a.periodo_ate!).getTime() - Date.now()) / 86_400_000;
    assert(dias > 55 && dias < 66, `dois meses pagos, deu ${dias.toFixed(1)} dias`);
    assertEquals((await pagamentosDe(db, antigo)).map((x) => x.status), ["aprovado", "aprovado"]);
  });

  // o travado não vira desconto livre: abaixo do valor da época não libera
  const ruim = await criarUsuario(db);
  await mudarPreco(db, 9790);
  await comMP(mpDoCheckout({}, "pb"), async () => {
    await abrirCheckout({ id: ruim, email: "c@exemplo.invalid" }, depsSobrePg(db, ruim)); // travado em 97,90
  });
  await mudarPreco(db, 12000);
  await comMP(respostaDoPagamento(ruim, 90, "approved", { preapproval_id: "pb-1" }), async () => {
    const { resultado } = await capturandoErros(() => processarAviso({ tipo: "payment", id: "7003" }, registrar));
    assertEquals(resultado.tratado, "ignorado");
    assertEquals((await assinaturaDe(db, ruim)).status, "trial");
  });

  // quem assinou depois do reajuste tem o preço novo guardado e paga o preço atual (120,00)
  await guardarPreapproval(db, novo, "pc-1", 12000);
  await comMP(respostaDoPagamento(novo, 97.9, "approved", { preapproval_id: "pc-1" }), async () => {
    const { resultado } = await capturandoErros(() => processarAviso({ tipo: "payment", id: "7004" }, registrar));
    assertEquals(resultado.tratado, "ignorado");
    assertEquals((await pagamentosDe(db, novo))[0].status, "valor_divergente");
  });
});

Deno.test("valor divergente e cobrança de conta excluída soltam ALERTA (console.error) uma vez; o aviso repetido não", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const registrar = await registrarSobrePg(db);

  // 90,00 contra 97,90: o MP cobrou e nada liberou
  await guardarPreapproval(db, userId);
  await comMP(respostaDoPagamento(userId, 90), async () => {
    const { resultado, erros } = await capturandoErros(() => processarAviso({ tipo: "payment", id: "8001" }, registrar));
    assertEquals(resultado, { tratado: "ignorado", motivo: "valor_divergente" });
    assertEquals(erros.length, 1);
    assert(erros[0].includes("ALERTA valor_divergente") && erros[0].includes("8001"), erros[0]);
  });

  // a conta foi excluída e o MP segue cobrando: não pode virar 500 eterno
  const fantasma = "0b2f9a10-1234-4abc-9def-00000000dead";
  const aviso = { tipo: "payment", id: "8002", assinatura: await assinar("8002", "req-8"), requestId: "req-8" };
  await comMP(respostaDoPagamento(fantasma), async () => {
    const um = await capturandoErros(() => receberAviso(aviso, registrar));
    assertEquals(um.resultado, { status: 200, corpo: { tratado: "ignorado", motivo: "sem_usuario" } }, "200: o MP para de reenviar");
    assertEquals(um.erros.length, 1);
    assert(um.erros[0].includes("ALERTA cobranca_orfa") && um.erros[0].includes("8002"), um.erros[0]);

    const dois = await capturandoErros(() => receberAviso(aviso, registrar));
    assertEquals(dois.resultado.corpo.motivo, "aviso repetido");
    assertEquals(dois.erros.length, 0, "o alerta sai uma vez só");
  });
  const orfaos = await db.query<{ n: number }>(
    `select count(*)::int as n from public.pagamentos where user_id is null and gateway_pagamento_id = '8002'`,
  );
  assertEquals(orfaos.rows[0].n, 1, "o pagamento fica guardado sem dono, de prova para o estorno");
});

Deno.test("pagamento aprovado mas em outra moeda ou com devolução não libera", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const registrar = await registrarSobrePg(db);

  for (
    const [nome, extra] of [
      ["moeda", { currency_id: "USD" }],
      ["sem moeda", { currency_id: null }],
      ["devolvido", { transaction_amount_refunded: 97.9 }],
      ["devolução parcial", { transaction_amount_refunded: 10 }],
    ] as [string, Record<string, unknown>][]
  ) {
    await comMP(respostaDoPagamento(userId, 97.9, "approved", extra), async () => {
      // pagamento devolvido que nunca creditamos: o estorno não acha o que revogar (C3)
      assertEquals((await processarAviso({ tipo: "payment", id: "9100" }, registrar, await depsWebhookSobrePg(db))).tratado, "ignorado", nome);
    });
  }
  assertEquals(await pagamentosDe(db, userId), []);
  assertEquals((await assinaturaDe(db, userId)).status, "trial");
});

Deno.test("só credita pagamento do preapproval guardado: de outro, sem preapproval ou com o certo", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const registrar = await registrarSobrePg(db);
  await guardarPreapproval(db, userId, "pa-1");

  // o pagamento aponta para o usuário (external_reference), mas vem de outro preapproval ou de nenhum
  for (const [id, preapproval] of [["m1-outro", "pa-do-atacante"], ["m1-sem", null]] as [string, string | null][]) {
    await comMP(respostaDoPagamento(userId, 97.9, "approved", { preapproval_id: preapproval }), async () => {
      const { resultado, erros } = await capturandoErros(() => processarAviso({ tipo: "payment", id }, registrar));
      assertEquals(resultado, { tratado: "ignorado", motivo: "preapproval_divergente" }, id);
      assertEquals(erros.length, 1, "solta o alerta, como o valor_divergente");
      assert(erros[0].includes("ALERTA preapproval_divergente") && erros[0].includes(id), erros[0]);
    });
    const a = await assinaturaDe(db, userId);
    assertEquals(a.status, "trial", `${id}: não liberou`);
    assertEquals(a.periodo_ate, null, `${id}: o período não andou`);
    assertEquals(a.gateway_assinatura_id, "pa-1", `${id}: o preapproval guardado não foi trocado`);
  }
  assertEquals((await pagamentosDe(db, userId)).map((p) => p.status), ["preapproval_divergente", "preapproval_divergente"]);

  // o certo (preapproval guardado) credita
  await comMP(respostaDoPagamento(userId, 97.9, "approved", { preapproval_id: "pa-1" }), async () => {
    assertEquals(await processarAviso({ tipo: "payment", id: "m1-certo" }, registrar), { tratado: "liberado", userId });
  });
  const a = await assinaturaDe(db, userId);
  assertEquals([a.status, a.gateway_assinatura_id], ["ativa", "pa-1"]);
  assert(a.periodo_ate !== null, "o período andou");
});
