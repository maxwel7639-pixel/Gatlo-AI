import { assert, assertEquals, assertRejects } from "@std/assert";
import type { PGlite } from "@electric-sql/pglite";
import { criarPostgres, criarUsuario } from "./pg.ts";

/**
 * A cobrança no PIX AUTOMÁTICO (Asaas), com o Asaas SIMULADO: o fetch global vira
 * três servidores falsos (o script teste:funcoes roda sem --allow-net):
 *  - o Asaas, com estado (clientes, autorizações e cobranças que cada teste monta);
 *  - o Mercado Pago, só para o cruzamento entre os dois gateways;
 *  - o Supabase (PostgREST), que por trás é o PGlite com as migrations todas, ou
 *    seja, o `registrar_pagamento` e o `guardar_autorizacao_asaas` de verdade.
 * Nenhum centavo e nenhum pedido saem daqui; as chaves abaixo são falsas.
 *
 * Os mesmos testes do cartão (cobranca_test.ts e webhook_rota_test.ts), agora pelo
 * `POST` exportado da rota do Asaas: (a) aviso forjado não libera, (b) cobrança
 * confirmada libera 1 mês, (c) o mesmo aviso duas vezes não credita dobrado, (d)
 * valor abaixo do preço travado não libera, (e) o preço vem de `regras` no
 * servidor, (f) pagamento de autorização que não é a guardada não credita, (g) a
 * rota HTTP tem teste próprio.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-falsa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-falsa";
process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-teste-falso";
process.env.ASAAS_API_KEY = "$aact_teste_falsa";
const TOKEN = "token-falso-do-webhook-asaas-com-mais-de-32-caracteres";
process.env.ASAAS_WEBHOOK_TOKEN = TOKEN;
delete process.env.ASAAS_AMBIENTE; // sem a variável = sandbox

const { POST } = await import("../../../app/api/asaas-webhook/route.ts");
const { abrirAutorizacaoDoServidor } = await import("../../../lib/asaas-servidor.ts");
const { abrirCheckout } = await import("../../../lib/mp-checkout.ts");
const { limparCpfCnpj } = await import("../../../lib/cpf-cnpj.ts");

const CPF = "529.982.247-25"; // CPF válido de teste (só dígito verificador, de ninguém)
const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });

/* ------------------------------------------------------------ Asaas simulado */

type Cobranca = {
  id: string;
  customer: string | null;
  value: number | null;
  status: string;
  billingType: string;
  subscription: string | null;
  refunds: unknown[];
};
type Autorizacao = {
  id: string;
  status: string;
  customerId: string;
  subscriptionId: string | null;
  payload: string | null;
  encodedImage: string | null;
};

class AsaasFalso {
  clientes = new Map<string, { id: string; externalReference: string }>();
  autorizacoes = new Map<string, Autorizacao>();
  cobrancas = new Map<string, Cobranca>();
  criados: { caminho: string; corpo: Record<string, unknown>; cabecalhos: Headers }[] = [];
  foraDoAr = false;
  private n = 0;

  /** Monta o caso comum: cliente cus_1 do usuário, autorização aut-1 ativa dele, cobrança pay_1 paga. */
  montar(userId: string, o: { valor?: number; cobranca?: string; subscription?: string | null } = {}) {
    this.clientes.set("cus_1", { id: "cus_1", externalReference: `assinatura|${userId}` });
    this.autorizacoes.set("aut-1", {
      id: "aut-1",
      status: "ACTIVE",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      payload: null,
      encodedImage: null,
    });
    this.cobrancas.set(o.cobranca ?? "pay_1", {
      id: o.cobranca ?? "pay_1",
      customer: "cus_1",
      value: o.valor ?? 97.9,
      status: "RECEIVED",
      billingType: "PIX",
      subscription: o.subscription ?? null,
      refunds: [],
    });
  }

  responder = (p: Request): Response => {
    const u = new URL(p.url);
    const caminho = u.pathname.replace(/^\/v3/, "");
    if (u.origin !== "https://api-sandbox.asaas.com") return json({ message: `ambiente errado: ${u.origin}` }, 500);
    if (p.headers.get("access_token") !== "$aact_teste_falsa") return json({ errors: [{ description: "chave" }] }, 401);
    if (!p.headers.get("user-agent")) return json({ errors: [{ description: "sem User-Agent" }] }, 400);
    if (this.foraDoAr) return json({ errors: [{ description: "fora do ar" }] }, 503);

    const id = decodeURIComponent(caminho.split("/").pop() ?? "");
    const ler = <T>(m: Map<string, T>) => (m.has(id) ? json(m.get(id)) : json({ errors: [{ description: "não encontrado" }] }, 404));
    if (p.method === "GET" && caminho.startsWith("/customers/")) return ler(this.clientes);
    if (p.method === "GET" && caminho.startsWith("/payments/")) return ler(this.cobrancas);
    if (p.method === "GET" && caminho.startsWith("/pix/automatic/authorizations/")) return ler(this.autorizacoes);
    return json({ errors: [{ description: `fora do roteiro: ${p.method} ${caminho}` }] }, 500);
  };

  /** Os POSTs (criar cliente e autorização) precisam do corpo, que só se lê com await. */
  async criar(p: Request): Promise<Response> {
    const caminho = new URL(p.url).pathname.replace(/^\/v3/, "");
    const corpo = (await p.clone().json()) as Record<string, unknown>;
    this.criados.push({ caminho, corpo, cabecalhos: p.headers });
    if (caminho === "/customers") {
      const id = `cus_n${++this.n}`;
      this.clientes.set(id, { id, externalReference: String(corpo.externalReference) });
      return json({ id });
    }
    if (caminho === "/pix/automatic/authorizations") {
      const id = `aut-n${++this.n}`;
      const a: Autorizacao = {
        id,
        status: "CREATED",
        customerId: String(corpo.customerId),
        subscriptionId: `sub_n${this.n}`,
        payload: `00020126PIXCOPIAECOLA${this.n}`,
        encodedImage: `QVNBQVM${this.n}`,
      };
      this.autorizacoes.set(id, a);
      return json(a);
    }
    return json({ errors: [{ description: `fora do roteiro: POST ${caminho}` }] }, 500);
  }
}

/* ------------------------------------------------ Supabase (PostgREST) falso */

type Servidores = { pedidos: Request[]; bancoFora: boolean; asaas: AsaasFalso; mp: (p: Request) => Response };

async function postgrest(db: PGlite, p: Request, s: Servidores): Promise<Response> {
  const u = new URL(p.url);
  const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
  const a = rpc ? await p.clone().json() : null;
  if (rpc === "registrar_pagamento") {
    if (s.bancoFora) return json({ message: "banco fora do ar" }, 500);
    const r = await db.query<{ r: string }>(
      `select public.registrar_pagamento($1::text, $2::text, $3::uuid, $4::int, $5::text) as r`,
      [a.p_gateway, a.p_gateway_pagamento_id, a.p_user_id, a.p_valor_centavos, a.p_gateway_assinatura_id],
    );
    return json(r.rows[0].r);
  }
  if (rpc === "guardar_autorizacao_asaas") {
    const r = await db.query<{ r: boolean }>(`select public.guardar_autorizacao_asaas($1::uuid, $2::text, $3::text, $4::int) as r`, [
      a.p_user_id,
      a.p_cliente_id,
      a.p_autorizacao_id,
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
      `select status, gateway, gateway_assinatura_id, gateway_cliente_id from public.assinaturas where user_id = $1`,
      [dono],
    )).rows;
    return p.headers.get("accept")?.includes("object+json") ? json(linhas[0] ?? null) : json(linhas);
  }
  return json({ message: `fora do roteiro: ${p.method} ${u.pathname}` }, 500);
}

function comServidores<T>(db: PGlite, asaas: AsaasFalso, f: (s: Servidores) => Promise<T>, mp?: (p: Request) => Response): Promise<T> {
  const original = globalThis.fetch;
  const s: Servidores = { pedidos: [], bancoFora: false, asaas, mp: mp ?? (() => json({ message: "MP fora do roteiro" }, 500)) };
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const p = new Request(entrada as RequestInfo, init);
    s.pedidos.push(p);
    const host = new URL(p.url).host;
    if (host === "api-sandbox.asaas.com") return p.method === "POST" ? await asaas.criar(p) : asaas.responder(p);
    if (host === "api.mercadopago.com") return s.mp(p);
    if (host === "supabase.invalid") return await postgrest(db, p, s);
    return json({ message: `host inesperado: ${host}` }, 500);
  }) as typeof fetch;
  return f(s).finally(() => {
    globalThis.fetch = original;
  });
}

const doAsaas = (s: Servidores) => s.pedidos.filter((p) => new URL(p.url).host === "api-sandbox.asaas.com");
const caminhos = (s: Servidores) => doAsaas(s).map((p) => `${p.method} ${new URL(p.url).pathname.replace(/^\/v3/, "")}`);

/* ----------------------------------------------------------------- utilidades */

/** Usuário que já abriu o Pix Automático: autorização aut-1 e cliente cus_1 guardados, preço da época 97,90. */
async function usuarioComPix(db: PGlite): Promise<string> {
  const userId = await criarUsuario(db);
  await db.query(`select public.guardar_autorizacao_asaas($1::uuid, 'cus_1', 'aut-1', 9790)`, [userId]);
  return userId;
}

type Assinatura = { status: string; gateway: string | null; gateway_assinatura_id: string | null; gateway_cliente_id: string | null; valor_centavos: number | null; periodo_ate: string | null };
const assinaturaDe = async (db: PGlite, userId: string) =>
  (await db.query<Assinatura>(`select * from public.assinaturas where user_id = $1`, [userId])).rows[0];
const pagamentosDe = async (db: PGlite, userId: string) =>
  (await db.query<{ status: string; valor_centavos: number; gateway_pagamento_id: string }>(
    `select status, valor_centavos, gateway_pagamento_id from public.pagamentos where user_id = $1 order by criado_em`,
    [userId],
  )).rows;

const aviso = (pagamentoId: string, event = "PAYMENT_RECEIVED") => ({
  id: "evt_1",
  event,
  dateCreated: "2026-10-18 10:00:00",
  payment: { id: pagamentoId, status: "RECEIVED", value: 97.9 },
});

/** Um POST do Asaas à rota. `token: null` = sem o cabeçalho. */
function postar(corpo: unknown, token: string | null = TOKEN, bruto?: string): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("asaas-access-token", token);
  return POST(new Request("https://gatlo.test/api/asaas-webhook", { method: "POST", headers, body: bruto ?? JSON.stringify(corpo) }));
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

/* ======================================================= (a) aviso forjado */

Deno.test("asaas (a): token ausente, errado, de outro tamanho ou sem ASAAS_WEBHOOK_TOKEN = 401 só 'não autorizado', sem Asaas e sem banco", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);
  const asaas = new AsaasFalso();
  asaas.montar(userId);

  await comServidores(db, asaas, async (s) => {
    const casos: [string, string | null, string][] = [
      ["ausente", null, "sem asaas-access-token"],
      ["errado", "token-errado", "token divergente"],
      ["vazio", "", "sem asaas-access-token"],
      ["prefixo certo, resto errado", TOKEN.slice(0, -1) + "X", "token divergente"],
      ["o certo com sobra", TOKEN + "x", "token divergente"],
    ];
    for (const [nome, token, motivo] of casos) {
      const { resultado: r, erros } = await capturandoErros(() => postar(aviso("pay_1"), token));
      assertEquals(r.status, 401, nome);
      assertEquals(await r.json(), { erro: "não autorizado" }, `${nome}: a resposta não conta o motivo`);
      assert(erros.some((e) => e.includes(motivo)), `${nome}: o motivo "${motivo}" tem que ir pro log, foi: ${erros}`);
    }

    // SEM segredo configurado nada passa, nem o cabeçalho "certo" nem um vazio
    const guardado = process.env.ASAAS_WEBHOOK_TOKEN;
    try {
      for (const valor of [undefined, ""]) {
        if (valor === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
        else process.env.ASAAS_WEBHOOK_TOKEN = valor;
        for (const token of [TOKEN, "", null]) {
          const { resultado: r, erros } = await capturandoErros(() => postar(aviso("pay_1"), token));
          assertEquals(r.status, 401);
          const texto = JSON.stringify(await r.json());
          assert(!texto.includes("ASAAS"), `a resposta não pode contar que falta o segredo: ${texto}`);
          assert(erros.some((e) => e.includes("ASAAS_WEBHOOK_TOKEN não configurado")), "o log conta");
        }
      }
    } finally {
      process.env.ASAAS_WEBHOOK_TOKEN = guardado;
    }

    assertEquals(s.pedidos.length, 0, "nenhuma consulta ao Asaas e nenhuma chamada ao banco");
  });
  assertEquals(await pagamentosDe(db, userId), []);
  assertEquals((await assinaturaDe(db, userId)).status, "trial");
});

Deno.test("asaas (a): token bom, mas o corpo diz recebido e a API diz outra coisa (ou nada) — não libera", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);

  const casos: [string, (c: Cobranca) => void, string][] = [
    ["PENDING", (c) => (c.status = "PENDING"), "cobrança PENDING"],
    ["OVERDUE", (c) => (c.status = "OVERDUE"), "cobrança OVERDUE"],
    ["REFUNDED", (c) => (c.status = "REFUNDED"), "cobrança REFUNDED"],
    ["boleto", (c) => (c.billingType = "BOLETO"), "forma BOLETO"],
    ["com devolução", (c) => (c.refunds = [{ value: 10 }]), "cobrança com devolução"],
    ["sem cliente", (c) => (c.customer = null), "cobrança sem valor ou cliente"],
    ["sem valor", (c) => (c.value = null), "cobrança sem valor ou cliente"],
  ];
  for (const [nome, mexer, motivo] of casos) {
    const asaas = new AsaasFalso();
    asaas.montar(userId);
    mexer(asaas.cobrancas.get("pay_1")!);
    await comServidores(db, asaas, async () => {
      const r = await postar(aviso("pay_1")); // o corpo do aviso jura que está pago
      assertEquals([r.status, await r.json()], [200, { tratado: "ignorado", motivo }], nome);
    });
  }

  // a cobrança nem existe no Asaas: ignora (200), não trava a fila com 500 eterno
  await comServidores(db, new AsaasFalso(), async () => {
    const r = await postar(aviso("pay_9999"));
    assertEquals([r.status, (await r.json()).motivo], [200, "cobrança não existe no Asaas"]);
  });

  assertEquals(await pagamentosDe(db, userId), [], "nada foi registrado");
  assertEquals((await assinaturaDe(db, userId)).status, "trial");
});

/* ============================================ (b) confirmada libera 1 mês */

Deno.test("asaas (b): cobrança recebida libera o robô, grava gateway asaas e empurra o período em 1 mês; confirmada também", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);
  const asaas = new AsaasFalso();
  asaas.montar(userId);

  await comServidores(db, asaas, async (s) => {
    const antes = Date.now();
    const r = await postar(aviso("pay_1"));
    assertEquals([r.status, await r.json()], [200, { tratado: "liberado" }]);

    const a = await assinaturaDe(db, userId);
    assertEquals([a.status, a.gateway, a.gateway_assinatura_id, a.valor_centavos], ["ativa", "asaas", "aut-1", 9790]);
    const dias = (new Date(a.periodo_ate!).getTime() - antes) / 86_400_000;
    assert(dias > 27 && dias < 32, `o período tem que ir ~1 mês à frente, foi ${dias.toFixed(1)} dias`);
    assertEquals((await pagamentosDe(db, userId)).map((p) => [p.status, p.valor_centavos]), [["aprovado", 9790]]);
    assertEquals(
      (await db.query<{ liberada: boolean }>(`select liberada from public.assinatura_situacao($1)`, [userId])).rows[0].liberada,
      true,
    );
    // consultou a verdade na API: cobrança, cliente (o dono) e autorização (a guardada)
    assertEquals(caminhos(s), ["GET /payments/pay_1", "GET /customers/cus_1", "GET /pix/automatic/authorizations/aut-1"]);
  });
});

Deno.test("asaas (b): PAYMENT_CONFIRMED libera; eventos de autorização e de outros tipos só dão 200 'ignorado' sem consultar o Asaas", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);
  const asaas = new AsaasFalso();
  asaas.montar(userId);

  await comServidores(db, asaas, async (s) => {
    for (const evento of [
      "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED",
      "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED",
      "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED",
      "PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED",
      "PAYMENT_CREATED",
      "PAYMENT_OVERDUE",
      "QUALQUER_COISA",
    ]) {
      const r = await postar(aviso("pay_1", evento));
      assertEquals([r.status, (await r.json()).tratado], [200, "ignorado"], evento);
    }
    assertEquals(s.pedidos.length, 0, "evento que não credita não gasta consulta nem toca no banco");
    assertEquals((await assinaturaDe(db, userId)).status, "trial", "autorizar não libera: quem credita é a cobrança paga");

    const r = await postar(aviso("pay_1", "PAYMENT_CONFIRMED"));
    assertEquals([r.status, (await r.json()).tratado], [200, "liberado"]);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");
  });
});

/* ============================================ (c) o mesmo aviso, duas vezes */

Deno.test("asaas (c): o mesmo aviso duas vezes, ou RECEIVED e depois CONFIRMED da mesma cobrança, não credita dobrado", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);
  const asaas = new AsaasFalso();
  asaas.montar(userId);

  await comServidores(db, asaas, async () => {
    assertEquals((await (await postar(aviso("pay_1"))).json()).tratado, "liberado");
    const periodo = (await assinaturaDe(db, userId)).periodo_ate;

    for (const evento of ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]) {
      const r = await postar(aviso("pay_1", evento));
      assertEquals([r.status, await r.json()], [200, { tratado: "ignorado", motivo: "aviso repetido" }], evento);
    }
    assertEquals((await pagamentosDe(db, userId)).length, 1, "1 linha só em pagamentos");
    assertEquals((await assinaturaDe(db, userId)).periodo_ate, periodo, "o período não andou de novo");

    // uma cobrança NOVA (o mês seguinte, da assinatura) soma mais 1 mês
    asaas.cobrancas.set("pay_2", { ...asaas.cobrancas.get("pay_1")!, id: "pay_2", subscription: "sub_1" });
    assertEquals((await (await postar(aviso("pay_2"))).json()).tratado, "liberado");
    assertEquals((await pagamentosDe(db, userId)).length, 2);
    assert(new Date((await assinaturaDe(db, userId)).periodo_ate!) > new Date(periodo!), "o 2º mês empurrou o período");
  });
});

/* ======================================== (d) valor abaixo do preço travado */

Deno.test("asaas (d): valor abaixo do preço não libera (fica 'valor_divergente' com ALERTA); o preço travado da assinatura vale mesmo se regras subir", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);
  const asaas = new AsaasFalso();

  await comServidores(db, asaas, async () => {
    asaas.montar(userId, { valor: 90 });
    const { resultado: r, erros } = await capturandoErros(() => postar(aviso("pay_1")));
    assertEquals([r.status, (await r.json()).motivo], [200, "valor_divergente"]);
    assertEquals((await assinaturaDe(db, userId)).status, "trial");
    assertEquals((await pagamentosDe(db, userId)).map((p) => [p.status, p.valor_centavos]), [["valor_divergente", 9000]]);
    assert(erros.some((e) => e.includes("ALERTA valor_divergente") && e.includes("pay_1")), `sem alerta: ${erros}`);

    // o preço sobe depois da assinatura: quem já assinou segue pagando o da época...
    await db.exec(`update public.regras set valor = 12000 where chave = 'preco_mensal_centavos'`);
    asaas.cobrancas.set("pay_2", { ...asaas.cobrancas.get("pay_1")!, id: "pay_2", value: 97.9 });
    assertEquals((await (await postar(aviso("pay_2"))).json()).tratado, "liberado", "97,90 < 120,00, mas é o preço travado");
    // ...e abaixo do travado continua não liberando
    asaas.cobrancas.set("pay_3", { ...asaas.cobrancas.get("pay_1")!, id: "pay_3", value: 97.89 });
    assertEquals((await (await postar(aviso("pay_3"))).json()).motivo, "valor_divergente");
  });
});

/* ===================================== (e) o preço vem de regras no servidor */

Deno.test("asaas (e): o valor enviado ao Asaas é o de regras no banco; mudou a regra, mudou o valor; o cliente só manda o CPF/CNPJ", async () => {
  const db = await criarPostgres();
  const u1 = await criarUsuario(db);
  const u2 = await criarUsuario(db);
  const asaas = new AsaasFalso();
  const usuario = (id: string) => ({ id, email: `${id.slice(0, 8)}@exemplo.invalid`, nome: "Maria Teste" });
  const ultima = () => asaas.criados.filter((c) => c.caminho === "/pix/automatic/authorizations").at(-1)!.corpo as {
    value: number;
    frequency: string;
    paymentCreationMode: string;
    contractId: string;
    customerId: string;
    immediateQrCode: { originalValue: number };
  };

  const realNow = Date.now;
  try {
    await comServidores(db, asaas, async () => {
      assertEquals(abrirAutorizacaoDoServidor.length, 2, "a função só recebe o usuário e o documento: preço ninguém manda");
      const r1 = await abrirAutorizacaoDoServidor(usuario(u1), CPF);
      assertEquals(r1, { payload: "00020126PIXCOPIAECOLA2", imagem: "QVNBQVM2" });
      assertEquals(ultima().value, 97.9, "o preço de regras hoje");
      assertEquals(ultima().immediateQrCode.originalValue, 97.9, "o 1º pagamento tem o mesmo preço");
      assertEquals([ultima().frequency, ultima().paymentCreationMode], ["MONTHLY", "SUBSCRIPTION"]);
      assertEquals(ultima().contractId, u1.replaceAll("-", ""), "contractId cabe nos 35 caracteres do Asaas");

      const a1 = await assinaturaDe(db, u1);
      assertEquals([a1.gateway, a1.gateway_cliente_id, a1.gateway_assinatura_id, a1.valor_centavos], ["asaas", "cus_n1", "aut-n2", 9790]);

      await db.exec(`update public.regras set valor = 12000 where chave = 'preco_mensal_centavos'`);
      // `regras()` guarda 5 min em cache: anda o relógio para ler o valor novo
      Date.now = () => realNow() + 6 * 60_000;
      await abrirAutorizacaoDoServidor(usuario(u2), CPF);
      assertEquals(ultima().value, 120, "a regra mudou, o valor enviado ao Asaas mudou");
      assertEquals(ultima().immediateQrCode.originalValue, 120);
      assertEquals((await assinaturaDe(db, u2)).valor_centavos, 12000, "o preço da época fica guardado");
      assertEquals((await assinaturaDe(db, u1)).valor_centavos, 9790, "quem já assinou segue com o dele");
    });
  } finally {
    Date.now = realNow;
  }

  // o cliente criado no Asaas leva o dono na referência e o CPF só em dígitos; a chave e o User-Agent foram
  const cliente = asaas.criados.find((c) => c.caminho === "/customers")!;
  assertEquals(cliente.corpo.externalReference, `assinatura|${u1}`);
  assertEquals(cliente.corpo.cpfCnpj, "52998224725");
  assertEquals(cliente.cabecalhos.get("access_token"), "$aact_teste_falsa");
  assert(cliente.cabecalhos.get("user-agent"));
});

Deno.test("asaas (e): CPF/CNPJ inválido é recusado antes de qualquer chamada ao Asaas; o validador confere os dígitos", async () => {
  assertEquals(limparCpfCnpj("529.982.247-25"), "52998224725");
  assertEquals(limparCpfCnpj("11.222.333/0001-81"), "11222333000181");
  for (const ruim of ["", "123", "529.982.247-24", "111.111.111-11", "11.222.333/0001-82", "abc", "5299822472a"]) {
    assertEquals(limparCpfCnpj(ruim), null, `"${ruim}" não é documento`);
  }

  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const asaas = new AsaasFalso();
  await comServidores(db, asaas, async (s) => {
    const r = await abrirAutorizacaoDoServidor({ id: userId, email: "a@exemplo.invalid", nome: null }, "123.456.789-00");
    assertEquals(r, { erro: "CPF ou CNPJ inválido. Confere os números e tenta de novo." });
    assertEquals(doAsaas(s).length, 0);
    assertEquals((await assinaturaDe(db, userId)).gateway, null, "nada foi guardado");
  });
});

/* ================================= (f) autorização que não é a guardada */

Deno.test("asaas (f): pagamento de autorização, assinatura ou cliente que não é o guardado do usuário não credita (fica 'preapproval_divergente' com ALERTA)", async () => {
  const casos: [string, (a: AsaasFalso, userId: string) => unknown][] = [
    ["a guardada pertence a outro cliente no Asaas", (a) => (a.autorizacoes.get("aut-1")!.customerId = "cus_de_outro")],
    ["cobrança de outra assinatura (subscription diferente)", (a) => (a.cobrancas.get("pay_1")!.subscription = "sub_de_outro")],
    ["a guardada já não existe no Asaas", (a) => a.autorizacoes.delete("aut-1")],
  ];
  for (const [nome, mexer] of casos) {
    const db = await criarPostgres();
    const userId = await usuarioComPix(db);
    const asaas = new AsaasFalso();
    asaas.montar(userId, { subscription: "sub_1" });
    await mexer(asaas, userId);
    await comServidores(db, asaas, async () => {
      const { resultado: r, erros } = await capturandoErros(() => postar(aviso("pay_1")));
      assertEquals([r.status, (await r.json()).motivo], [200, "preapproval_divergente"], nome);
      assertEquals((await assinaturaDe(db, userId)).status, "trial", nome);
      assertEquals((await pagamentosDe(db, userId)).map((p) => p.status), ["preapproval_divergente"], nome);
      assert(erros.some((e) => e.includes("ALERTA preapproval_divergente")), `${nome}: sem alerta`);
    });
  }

  // sem nenhuma autorização guardada, ou com um preapproval do cartão guardado no lugar
  for (const [nome, preparar] of [
    ["usuário sem autorização guardada", async (_db: PGlite, _u: string) => {}],
    ["usuário com preapproval do cartão guardado", async (db: PGlite, u: string) => void await db.query(`select public.guardar_preapproval($1::uuid, 'aut-1', 9790)`, [u])],
  ] as const) {
    const db = await criarPostgres();
    const userId = await criarUsuario(db);
    await preparar(db, userId);
    const asaas = new AsaasFalso();
    asaas.montar(userId);
    await comServidores(db, asaas, async () => {
      const { resultado: r } = await capturandoErros(() => postar(aviso("pay_1")));
      assertEquals([r.status, (await r.json()).motivo], [200, "preapproval_divergente"], nome);
      assertEquals((await assinaturaDe(db, userId)).status, "trial", nome);
    });
  }

  // cliente sem a nossa referência (não é de nenhum usuário nosso): ignora sem registrar
  {
    const db = await criarPostgres();
    const userId = await usuarioComPix(db);
    const asaas = new AsaasFalso();
    asaas.montar(userId);
    asaas.clientes.get("cus_1")!.externalReference = "outra-coisa";
    await comServidores(db, asaas, async () => {
      const r = await postar(aviso("pay_1"));
      assertEquals([r.status, (await r.json()).motivo], [200, "cliente sem referência de assinatura"]);
    });
    assertEquals(await pagamentosDe(db, userId), []);
  }

  // o contraste: tudo batendo, cobrança mensal da assinatura (subscription = a da autorização) libera
  {
    const db = await criarPostgres();
    const userId = await usuarioComPix(db);
    const asaas = new AsaasFalso();
    asaas.montar(userId, { subscription: "sub_1" });
    await comServidores(db, asaas, async () => {
      assertEquals((await (await postar(aviso("pay_1"))).json()).tratado, "liberado");
    });
  }
});

Deno.test("asaas (f): no banco, pagamento do Asaas só credita com o id da autorização guardada e do mesmo gateway", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);
  const registrar = async (gateway: string, id: string, assinatura: string | null) =>
    (await db.query<{ r: string }>(`select public.registrar_pagamento($1, $2, $3::uuid, 9790, $4) as r`, [gateway, id, userId, assinatura])).rows[0].r;

  assertEquals(await registrar("asaas", "p1", "aut-de-outro"), "preapproval_divergente");
  assertEquals(await registrar("asaas", "p2", null), "preapproval_divergente");
  assertEquals(await registrar("mercadopago", "p3", "aut-1"), "preapproval_divergente", "mesmo id, gateway errado");
  assertEquals((await assinaturaDe(db, userId)).status, "trial");
  assertEquals(await registrar("asaas", "p4", "aut-1"), "liberado");
  assertEquals(await registrar("asaas", "p4", "aut-1"), "repetido");
});

Deno.test("asaas: o cliente logado não chama guardar_autorizacao_asaas nem registrar_pagamento", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false)`);
  let negou = 0;
  try {
    for (const sql of [
      `select public.guardar_autorizacao_asaas('${userId}'::uuid, 'cus_x', 'aut-x', 1)`,
      `select public.registrar_pagamento('asaas', 'pay_x', '${userId}'::uuid, 9790, null)`,
      `update public.assinaturas set status = 'ativa', gateway = 'asaas' where user_id = '${userId}'`,
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
  assertEquals(negou, 3);
  assertEquals((await assinaturaDe(db, userId)).status, "trial");
  assertEquals((await db.query(`select has_function_privilege('anon', 'public.guardar_autorizacao_asaas(uuid,text,text,int)', 'execute') as a`)).rows[0], { a: false });
});

/* ======================================================== (g) a rota HTTP */

Deno.test("asaas (g): a rota — id malformado e corpo que não é JSON ignoram; erro do banco ou do Asaas vira 500 e o reenvio credita", async () => {
  const db = await criarPostgres();
  const userId = await usuarioComPix(db);
  const asaas = new AsaasFalso();
  asaas.montar(userId);

  await comServidores(db, asaas, async (s) => {
    for (const id of ["../customers", "pay_1/../x", "", "PAY_1", "cus_1"]) {
      const r = await postar(aviso(id));
      assertEquals([r.status, (await r.json()).tratado], [200, "ignorado"], `id "${id}"`);
    }
    let r = await postar(null, TOKEN, "isto nao e json");
    assertEquals([r.status, (await r.json()).tratado], [200, "ignorado"], "corpo que não é JSON");
    r = await postar({ event: 123, payment: { id: 5 } });
    assertEquals([r.status, (await r.json()).tratado], [200, "ignorado"], "tipos errados");
    assertEquals(s.pedidos.length, 0, "nenhum desses gastou consulta");

    // o banco cai: 500 (o Asaas reenvia), nada creditado; quando volta, o reenvio credita
    s.bancoFora = true;
    const { resultado: caiu } = await capturandoErros(() => postar(aviso("pay_1")));
    assertEquals(caiu.status, 500, "o banco falhou: nunca 200");
    assertEquals((await assinaturaDe(db, userId)).status, "trial");
    s.bancoFora = false;
    assertEquals((await postar(aviso("pay_1"))).status, 200);
    assertEquals((await assinaturaDe(db, userId)).status, "ativa");

    // o Asaas fora do ar: 500 para ele reenviar depois
    asaas.cobrancas.set("pay_5", { ...asaas.cobrancas.get("pay_1")!, id: "pay_5" });
    asaas.foraDoAr = true;
    const { resultado: fora } = await capturandoErros(() => postar(aviso("pay_5")));
    assertEquals(fora.status, 500, "sem conseguir confirmar na API, nunca credita nem ignora");
    asaas.foraDoAr = false;
    assertEquals((await pagamentosDe(db, userId)).length, 1);
  });
});

Deno.test("asaas: cobrança de conta excluída é guardada sem dono, solta ALERTA e a rota responde 200", async () => {
  const db = await criarPostgres();
  const asaas = new AsaasFalso();
  const fantasma = crypto.randomUUID();
  asaas.montar(fantasma);
  await comServidores(db, asaas, async () => {
    const { resultado: r, erros } = await capturandoErros(() => postar(aviso("pay_1")));
    assertEquals([r.status, (await r.json()).motivo], [200, "sem_usuario"]);
    assert(erros.some((e) => e.includes("ALERTA cobranca_orfa")));
  });
  assertEquals((await db.query(`select user_id from public.pagamentos where gateway_pagamento_id = 'pay_1'`)).rows, [{ user_id: null }]);
});

/* ============================================ abrir a autorização (a ação) */

Deno.test("pix: 2º clique devolve o MESMO QR Code; ativa recusa; cancelada cria outra reaproveitando o cliente (sem pedir o CPF)", async () => {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const asaas = new AsaasFalso();
  const usuario = { id: userId, email: "a@exemplo.invalid", nome: null };
  const criacoes = (caminho: string) => asaas.criados.filter((c) => c.caminho === caminho).length;

  await comServidores(db, asaas, async () => {
    const primeiro = await abrirAutorizacaoDoServidor(usuario, CPF);
    assertEquals("payload" in primeiro && primeiro.payload, "00020126PIXCOPIAECOLA2");
    assertEquals(asaas.criados.find((c) => c.caminho === "/customers")!.corpo.name, "a", "sem nome, usa o começo do e-mail");

    // 2º clique, autorização ainda CREATED: o mesmo QR, nenhuma autorização nova
    assertEquals(await abrirAutorizacaoDoServidor(usuario, ""), primeiro);
    assertEquals(criacoes("/pix/automatic/authorizations"), 1);
    assertEquals(criacoes("/customers"), 1);

    // autorizada: recusa, não cria nada
    asaas.autorizacoes.get("aut-n2")!.status = "ACTIVE";
    const ativa = await abrirAutorizacaoDoServidor(usuario, "");
    assert("erro" in ativa && ativa.erro.includes("já está autorizado"));
    assertEquals(criacoes("/pix/automatic/authorizations"), 1);

    // cancelada: cria outra, no mesmo cliente, sem pedir o documento de novo
    asaas.autorizacoes.get("aut-n2")!.status = "CANCELLED";
    const outra = await abrirAutorizacaoDoServidor(usuario, "");
    assertEquals("payload" in outra && outra.payload, "00020126PIXCOPIAECOLA3");
    assertEquals(criacoes("/customers"), 1, "o cliente do Asaas foi reaproveitado");
    assertEquals(criacoes("/pix/automatic/authorizations"), 2);
    assertEquals((await assinaturaDe(db, userId)).gateway_assinatura_id, "aut-n3");

    // o Asaas fora do ar: não cria nada (falha fechada)
    asaas.autorizacoes.get("aut-n3")!.status = "REFUSED";
    asaas.foraDoAr = true;
    await assertRejects(() => abrirAutorizacaoDoServidor(usuario, ""));
    assertEquals(criacoes("/pix/automatic/authorizations"), 2);
  });

  // assinatura já ativa no banco: recusa antes de qualquer chamada
  await db.exec(`update public.assinaturas set status = 'ativa' where user_id = '${userId}'`);
  await comServidores(db, new AsaasFalso(), async (s) => {
    const r = await abrirAutorizacaoDoServidor(usuario, CPF);
    assertEquals(r, { erro: "A tua assinatura já está ativa." });
    assertEquals(doAsaas(s).length, 0);
  });
});

Deno.test("pix e cartão: nunca duas cobranças vivas entre os gateways (cartão em andamento barra o Pix e Pix em andamento barra o cartão)", async () => {
  const db = await criarPostgres();
  const asaas = new AsaasFalso();

  // cartão (MP) guardado e ainda pendente ou autorizado: o Pix recusa e não cria nada
  for (const statusMP of ["pending", "authorized", "paused"]) {
    const userId = await criarUsuario(db);
    await db.query(`select public.guardar_preapproval($1::uuid, $2, 9790)`, [userId, `pa-${statusMP}`]);
    await comServidores(db, asaas, async (s) => {
      const r = await abrirAutorizacaoDoServidor({ id: userId, email: "a@exemplo.invalid", nome: "A" }, CPF);
      assert("erro" in r && r.erro.includes("cartão em andamento"), statusMP);
      assertEquals(doAsaas(s).length, 0, statusMP);
    }, () => json({ id: `pa-${statusMP}`, status: statusMP, init_point: "https://mp.example/x" }));
  }
  // cartão cancelado no MP: o Pix pode abrir
  {
    const userId = await criarUsuario(db);
    await db.query(`select public.guardar_preapproval($1::uuid, 'pa-velho', 9790)`, [userId]);
    await comServidores(db, asaas, async () => {
      const r = await abrirAutorizacaoDoServidor({ id: userId, email: "a@exemplo.invalid", nome: "A" }, CPF);
      assert("payload" in r);
    }, () => json({ id: "pa-velho", status: "cancelled", init_point: null }));
  }

  // Pix em andamento (QR esperando ou autorizado): o checkout do cartão recusa, sem criar preapproval
  const chamadasMP: Request[] = [];
  const mp = (p: Request) => {
    chamadasMP.push(p);
    return p.method === "POST" ? json({ id: "pa-novo", init_point: "https://mp.example/novo" }) : json({ message: "não existe" }, 404);
  };
  const deps = (gatewayAssinaturaId: string) => ({
    lerPreco: async () => 9790,
    assinaturaAtual: async () => ({ status: "trial", gateway: "asaas", gatewayAssinaturaId }),
    guardar: async () => {},
  });
  for (const status of ["CREATED", "ACTIVE"]) {
    asaas.autorizacoes.set("aut-vivo", { id: "aut-vivo", status, customerId: "cus_1", subscriptionId: null, payload: "x", encodedImage: "y" });
    await comServidores(db, asaas, async () => {
      const r = await abrirCheckout({ id: crypto.randomUUID(), email: "a@exemplo.invalid" }, deps("aut-vivo"));
      assert("erro" in r && r.erro.includes("Pix Automático em andamento"), status);
    }, mp);
  }
  assertEquals(chamadasMP.length, 0, "nenhum preapproval foi criado");

  // Pix cancelado ou recusado: o cartão abre, e o id do Pix entra na chave de idempotência
  asaas.autorizacoes.set("aut-morto", { id: "aut-morto", status: "REFUSED", customerId: "cus_1", subscriptionId: null, payload: null, encodedImage: null });
  const userId = crypto.randomUUID();
  await comServidores(db, asaas, async () => {
    const r = await abrirCheckout({ id: userId, email: "a@exemplo.invalid" }, deps("aut-morto"));
    assertEquals(r, { url: "https://mp.example/novo" });
  }, mp);
  assertEquals(chamadasMP[0].headers.get("x-idempotency-key"), `assinatura-${userId}-aut-morto`);
});
