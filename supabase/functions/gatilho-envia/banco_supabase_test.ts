import { assert, assertEquals } from "@std/assert";
import { bancoSupabase } from "./banco_supabase.ts";

// O Postgres dos outros testes cobre a lógica; aqui se confere só o PEDIDO que o acesso de
// produção (supabase-js sobre PostgREST) monta, com um fetch falso. As condições dentro do
// pedido (as do `reservar`, por exemplo) são o que segura a DM de sair duas vezes.
// Nenhuma rede, nenhuma chave de verdade.
const URL_BASE = "https://projeto-falso.supabase.invalid";
const CHAVE_FALSA = `falsa-${crypto.randomUUID()}`;

type Resposta = { corpo?: unknown; status?: number; headers?: Record<string, string> };

function comRespostas(respostas: Resposta[]) {
  const pedidos: Request[] = [];
  const falso: typeof fetch = (entrada, init) => {
    const pedido = new Request(entrada as RequestInfo, init);
    pedidos.push(pedido);
    const r = respostas.shift() ?? {};
    return Promise.resolve(
      new Response(pedido.method === "HEAD" ? null : JSON.stringify(r.corpo ?? []), {
        status: r.status ?? 200,
        headers: { "Content-Type": "application/json", ...r.headers },
      }),
    );
  };
  return { banco: bancoSupabase(URL_BASE, CHAVE_FALSA, { fetch: falso }), pedidos };
}

const q = (p: Request) => new URL(p.url).searchParams;
const caminho = (p: Request) => new URL(p.url).pathname;

Deno.test("regras lê a tabela e devolve cada número pelo nome (regra faltando é erro)", async () => {
  const linhas = [
    ["envio_max_por_rodada", "6"],
    ["envio_intervalo_segundos", 5],
    ["envio_pausa_direct_min", 180],
    ["envio_pausa_resposta_min", 45],
    ["respostas_publicas_max_24h", 200],
    ["fila_janela_dias", 6],
    ["consulta_posts_recentes_dias", 7],
    ["consulta_posts_por_rodada", 5],
    ["teste_dias", 7],
  ].map(([chave, valor]) => ({ chave, valor }));
  const { banco, pedidos } = comRespostas([{ corpo: linhas }, { corpo: linhas.slice(1) }]);

  assertEquals(await banco.regras(), {
    envioMaxPorRodada: 6,
    envioIntervaloSegundos: 5,
    envioPausaDirectMin: 180,
    envioPausaRespostaMin: 45,
    respostasPublicasMax24h: 200,
    filaJanelaDias: 6,
    consultaPostsRecentesDias: 7,
    consultaPostsPorRodada: 5,
  });
  assertEquals(caminho(pedidos[0]), "/rest/v1/regras");
  assertEquals(pedidos[0].headers.get("authorization"), `Bearer ${CHAVE_FALSA}`);

  let erro: unknown = null;
  try {
    await banco.regras();
  } catch (e) {
    erro = e;
  }
  assert(erro instanceof Error && erro.message.includes("envio_max_por_rodada"));
});

Deno.test("contasConectadas: só conectada e fora da demonstração, em páginas de 1000", async () => {
  const pagina = (n: number, de = 0) => Array.from({ length: n }, (_, i) => ({ id: `c${de + i}`, user_id: "u", ig_user_id: "i" }));
  const { banco, pedidos } = comRespostas([{ corpo: pagina(1000) }, { corpo: pagina(3, 1000) }]);
  const contas = await banco.contasConectadas();
  assertEquals(contas.length, 1003);
  assertEquals(pedidos.length, 2);
  const u = q(pedidos[0]);
  assertEquals(caminho(pedidos[0]), "/rest/v1/contas_instagram");
  assertEquals(u.get("status"), "eq.conectada");
  assertEquals(u.get("demonstracao"), "eq.false");
  assertEquals([q(pedidos[0]).get("offset"), q(pedidos[0]).get("limit")], ["0", "1000"]);
  assertEquals([q(pedidos[1]).get("offset"), q(pedidos[1]).get("limit")], ["1000", "1000"]);
});

Deno.test("assinaturaLiberada chama assinatura_situacao e só aceita liberada = true", async () => {
  const { banco, pedidos } = comRespostas([
    { corpo: [{ liberada: true }] },
    { corpo: [{ liberada: false }] },
    { corpo: [] },
  ]);
  assertEquals(await banco.assinaturaLiberada("u1"), true);
  assertEquals(await banco.assinaturaLiberada("u1"), false);
  assertEquals(await banco.assinaturaLiberada("sem-assinatura"), false);
  assertEquals(caminho(pedidos[0]), "/rest/v1/rpc/assinatura_situacao");
  assertEquals(await pedidos[0].json(), { p_user_id: "u1" });
});

Deno.test("pausa e token leem pela conta; sem linha, pausa vazia e token null", async () => {
  const { banco, pedidos } = comRespostas([
    { corpo: [] },
    { corpo: [{ direct_ate: "2026-10-15T12:00:00+00:00", resposta_ate: null }] },
    { corpo: [] },
    { corpo: [{ token_cifrado: "v1.a.b", expira_em: null }] },
  ]);
  assertEquals(await banco.pausa("c1"), { direct_ate: null, resposta_ate: null });
  assertEquals((await banco.pausa("c1")).direct_ate, "2026-10-15T12:00:00+00:00");
  assertEquals(await banco.token("c1"), null);
  assertEquals(await banco.token("c1"), { token_cifrado: "v1.a.b", expira_em: null });
  assertEquals(q(pedidos[0]).get("conta_id"), "eq.c1");
  assertEquals(caminho(pedidos[0]), "/rest/v1/envio_pausa");
  assertEquals(caminho(pedidos[2]), "/rest/v1/tokens_instagram");
});

const AUTO = { id: "a1", codigo: "abc123", mensagem_dm: "oi", link_titulo: "Abrir", resposta_publica: null, ativa: true };

Deno.test("fila: sem automação desligada, um pedido só; sem reservados, sem enviados, sem erro, dentro da janela, mais antigo primeiro", async () => {
  const { banco, pedidos } = comRespostas([
    { corpo: [] }, // automações desligadas
    { corpo: [{ id: "k1", comment_id: "C1", dm_tentativas: 0, automacoes: AUTO }, { id: "k2", comment_id: "C2", dm_tentativas: 0, automacoes: null }] },
  ]);
  const itens = await banco.fila("c1", new Date("2026-10-09T12:00:00Z"), 6, new Date("2026-10-15T11:50:00Z"));

  assertEquals(itens, [
    { id: "k1", comment_id: "C1", dm_tentativas: 0, automacao: AUTO },
    { id: "k2", comment_id: "C2", dm_tentativas: 0, automacao: null },
  ]);
  assertEquals(caminho(pedidos[0]), "/rest/v1/automacoes");
  assertEquals(q(pedidos[0]).get("conta_id"), "eq.c1");
  assertEquals(q(pedidos[0]).get("ativa"), "eq.false");

  const u = q(pedidos[1]);
  assertEquals(caminho(pedidos[1]), "/rest/v1/comentarios");
  assertEquals(u.get("conta_id"), "eq.c1");
  assertEquals(u.get("dm_em"), "is.null");
  assertEquals(u.get("dm_erro"), "is.null");
  assertEquals(u.get("dm_tentativas"), null, "a fila não filtra por dm_tentativas: quem decide é a reserva em voo");
  assertEquals(u.getAll("or"), ["(dm_reservado_em.is.null,dm_reservado_em.lt.2026-10-15T11:50:00.000Z)"]);
  assertEquals(u.get("recebido_em"), "gt.2026-10-09T12:00:00.000Z");
  assertEquals(u.get("order"), "recebido_em.asc,id.asc");
  assertEquals(u.get("limit"), "6");
  assert(u.get("select")!.includes("automacoes("));
});

Deno.test("fila: comentário de automação desligada fica de fora, mas o de automação apagada (automacao_id nulo) entra", async () => {
  const { banco, pedidos } = comRespostas([{ corpo: [{ id: "d1" }, { id: "d2" }] }, { corpo: [] }]);
  await banco.fila("c1", new Date(), 2, new Date("2026-10-15T11:50:00Z"));
  // dois filtros "or" no mesmo pedido: o PostgREST junta os dois com AND
  assertEquals(q(pedidos[1]).getAll("or"), [
    "(dm_reservado_em.is.null,dm_reservado_em.lt.2026-10-15T11:50:00.000Z)",
    "(automacao_id.is.null,automacao_id.not.in.(d1,d2))",
  ]);
});

Deno.test("reservar é UM update com a condição dentro: dm_tentativas lido, dm_em nulo, dm_erro nulo", async () => {
  const { banco, pedidos } = comRespostas([{ corpo: [{ id: "k1" }] }, { corpo: [] }]);
  const quando = new Date("2026-10-15T12:00:00Z");
  assertEquals(await banco.reservar("k1", 2, quando), true);
  assertEquals(await banco.reservar("k1", 2, quando), false); // outra rodada levou: o PostgREST não devolve linha

  const p = pedidos[0];
  assertEquals(p.method, "PATCH");
  assertEquals(caminho(p), "/rest/v1/comentarios");
  const u = q(p);
  assertEquals(u.get("id"), "eq.k1");
  assertEquals(u.get("dm_tentativas"), "eq.2");
  assertEquals(u.get("dm_em"), "is.null");
  assertEquals(u.get("dm_erro"), "is.null");
  assertEquals(await p.json(), { dm_tentativas: 3, dm_reservado_em: "2026-10-15T12:00:00.000Z" });
  assert((p.headers.get("prefer") ?? "").includes("return=representation"), "precisa saber se alguma linha mudou");
});

Deno.test("liberarReserva devolve a tentativa só de quem a reservou e só em linha ainda sem resultado", async () => {
  const { banco, pedidos } = comRespostas([{ corpo: [] }]);
  await banco.liberarReserva("k1", 1);
  const u = q(pedidos[0]);
  assertEquals(u.get("dm_tentativas"), "eq.1");
  assertEquals(u.get("dm_em"), "is.null");
  assertEquals(u.get("dm_erro"), "is.null");
  assertEquals(await pedidos[0].json(), { dm_tentativas: 0, dm_reservado_em: null });
});

Deno.test("marcarDmOk e marcarDmErro só valem em linha com dm_em nulo", async () => {
  const { banco, pedidos } = comRespostas([{ corpo: [] }, { corpo: [] }]);
  await banco.marcarDmOk("k1", "igsid-9", new Date("2026-10-15T12:00:00Z"));
  await banco.marcarDmErro("k1", "(551) não pode");
  assertEquals(await pedidos[0].json(), { dm_em: "2026-10-15T12:00:00.000Z", igsid: "igsid-9" });
  assertEquals(await pedidos[1].json(), { dm_erro: "(551) não pode" });
  for (const p of pedidos) {
    assertEquals(p.method, "PATCH");
    assertEquals(q(p).get("id"), "eq.k1");
    assertEquals(q(p).get("dm_em"), "is.null");
  }
});

Deno.test("pausarDirect e pausarResposta são upsert por conta_id e só mandam as próprias colunas", async () => {
  const { banco, pedidos } = comRespostas([{ corpo: [] }, { corpo: [] }]);
  await banco.pausarDirect("c1", new Date("2026-10-15T15:00:00Z"), "limite");
  await banco.pausarResposta("c1", new Date("2026-10-15T12:45:00Z"), "limite de resposta");

  for (const p of pedidos) {
    assertEquals(p.method, "POST");
    assertEquals(caminho(p), "/rest/v1/envio_pausa");
    assertEquals(q(p).get("on_conflict"), "conta_id");
    assert((p.headers.get("prefer") ?? "").includes("resolution=merge-duplicates"));
  }
  assertEquals(await pedidos[0].json(), {
    conta_id: "c1",
    direct_ate: "2026-10-15T15:00:00.000Z",
    motivo: "limite",
    avisado_em: null,
  });
  assertEquals(await pedidos[1].json(), {
    conta_id: "c1",
    resposta_ate: "2026-10-15T12:45:00.000Z",
    motivo: "limite de resposta",
  });
});

Deno.test("respostasPublicasDesde conta as respostas da conta nas últimas 24 h", async () => {
  const { banco, pedidos } = comRespostas([{ headers: { "content-range": "*/37" } }]);
  assertEquals(await banco.respostasPublicasDesde("c1", new Date("2026-10-14T12:00:00Z")), 37);
  const u = q(pedidos[0]);
  assertEquals(u.get("conta_id"), "eq.c1");
  assertEquals(u.get("resposta_em"), "gt.2026-10-14T12:00:00.000Z");
});

Deno.test("marcarRespostaOk e marcarRespostaErro", async () => {
  const { banco, pedidos } = comRespostas([{ corpo: [] }, { corpo: [] }]);
  await banco.marcarRespostaOk("k1", new Date("2026-10-15T12:00:00Z"));
  await banco.marcarRespostaErro("k1", "(100) apagado");
  assertEquals(await pedidos[0].json(), { resposta_em: "2026-10-15T12:00:00.000Z" });
  assertEquals(await pedidos[1].json(), { resposta_erro: "(100) apagado" });
});

Deno.test("erro do PostgREST vira exceção (a conta falha, as outras seguem)", async () => {
  const { banco } = comRespostas([{ status: 500, corpo: { message: "boom", code: "XX000" } }]);
  let erro: unknown = null;
  try {
    await banco.reservar("k1", 0, new Date());
  } catch (e) {
    erro = e;
  }
  assert(erro instanceof Error && erro.message === "comentarios: boom");
});
