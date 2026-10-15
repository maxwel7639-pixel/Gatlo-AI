import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { PGlite } from "@electric-sql/pglite";
import { cifrar } from "../../../lib/cripto.ts";
import { criarPostgres, criarUsuario } from "../_testes/pg.ts";
import { bancoEnviaSobrePg } from "../_testes/pg_envia.ts";
import { criarManipulador } from "./manipulador.ts";
import { criarMeta, ehLimite, foiRecusa, textoDoErro } from "./meta.ts";
import { type Banco, type DependenciasRodada, rodar } from "./rodada.ts";
import { iguaisEmTempoConstante } from "./seguranca.ts";
import { decifrarToken, importarChave } from "./token.ts";

// Tudo aqui é falso: a chave dos tokens e a do cron são sorteadas a cada execução, a Meta é
// um `fetch` injetado e o banco é um Postgres em memória. O script teste:funcoes roda sem
// --allow-net, então qualquer chamada de rede escapando daria erro.
const CHAVE_TOKENS = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
Deno.env.set("GATILHO_CHAVE_TOKENS", CHAVE_TOKENS); // é de onde o cifrar() de lib/cripto.ts lê
const CRON_CHAVE = `falsa-${crypto.randomUUID()}`;
const SITE = "https://gatlo.exemplo.invalid";
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

// ---------------------------------------------------------------- o banco

// Subir o Postgres (initdb + a migration inteira) leva uns 15 s: sobe UMA vez e, entre um
// teste e outro, apaga os usuários (as chaves estrangeiras levam junto contas, tokens,
// automações e comentários) e devolve a tabela `regras` ao que a migration pôs.
let postgres: Promise<{ db: PGlite; regras: { chave: string; valor: string; descricao: string }[] }> | null = null;

async function subir() {
  const db = await criarPostgres();
  const r = await db.query<{ chave: string; valor: string; descricao: string }>(
    `select chave, valor, descricao from public.regras`,
  );
  return { db, regras: r.rows };
}

async function mudarRegra(db: PGlite, chave: string, valor: number) {
  await db.query(`update public.regras set valor = $2 where chave = $1`, [chave, valor]);
}

// ---------------------------------------------------------------- dados

let contadorIg = 0;
let contadorComentario = 0;

type Conta = { userId: string; contaId: string; igUserId: string; token: string };

/** Usuário (com o teste de 7 dias que o gatilho do banco cria) + conta conectada + token cifrado. */
async function novaConta(
  db: PGlite,
  o: { token?: "vencido" | "sem" | "ilegivel"; status?: string; demonstracao?: boolean } = {},
): Promise<Conta> {
  const userId = await criarUsuario(db);
  const igUserId = `1784140000${String(++contadorIg).padStart(6, "0")}`;
  const r = await db.query<{ id: string }>(
    `insert into public.contas_instagram (user_id, ig_user_id, username, status, demonstracao)
     values ($1, $2, $3, $4, $5) returning id`,
    [userId, igUserId, `conta_${igUserId}`, o.status ?? "conectada", o.demonstracao ?? false],
  );
  const contaId = r.rows[0].id;
  const token = `IGAAtoken-falso-${crypto.randomUUID()}`;
  if (o.token !== "sem") {
    const cifrado = o.token === "ilegivel" ? "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" : cifrar(token);
    await db.query(
      `insert into public.tokens_instagram (conta_id, token_cifrado, expira_em) values ($1, $2, $3)`,
      [contaId, cifrado, new Date(Date.now() + (o.token === "vencido" ? -MINUTO : 30 * DIA)).toISOString()],
    );
  }
  return { userId, contaId, igUserId, token };
}

type OpcoesAutomacao = {
  resposta?: string | null;
  ativa?: boolean;
  mensagem?: string;
  titulo?: string;
};

async function novaAutomacao(db: PGlite, c: Conta, o: OpcoesAutomacao = {}) {
  const r = await db.query<{ id: string; codigo: string }>(
    `insert into public.automacoes
       (user_id, conta_id, nome, qualquer_post, palavras, mensagem_dm, link_url, link_titulo, resposta_publica, ativa)
     values ($1, $2, 'teste', true, array['quero'], $3, 'https://exemplo.invalid/oferta', $4, $5, $6)
     returning id, codigo`,
    [c.userId, c.contaId, o.mensagem ?? "Aqui está o seu link!", o.titulo ?? "Abrir", o.resposta ?? null, o.ativa ?? true],
  );
  return r.rows[0];
}

/** `ha` = há quantos ms a fila viu o comentário (recebido_em). */
async function novoComentario(
  db: PGlite,
  c: Conta,
  automacaoId: string | null,
  o: { ha?: number; commentId?: string } = {},
) {
  const commentId = o.commentId ?? `C-${++contadorComentario}`;
  const r = await db.query<{ id: string }>(
    `insert into public.comentarios (comment_id, user_id, conta_id, automacao_id, media_id, texto, palavra, recebido_em)
     values ($1, $2, $3, $4, 'M-1', 'quero muito', 'quero', $5) returning id`,
    [commentId, c.userId, c.contaId, automacaoId, new Date(Date.now() - (o.ha ?? 1000)).toISOString()],
  );
  return { id: r.rows[0].id, commentId };
}

/** N comentários em ordem de chegada (o primeiro é o mais antigo). */
async function fila(db: PGlite, c: Conta, automacaoId: string, n: number, comeco = 0) {
  const lista = [];
  for (let i = 0; i < n; i++) {
    lista.push(await novoComentario(db, c, automacaoId, { ha: 60 * MINUTO - (comeco + i) * 1000 }));
  }
  return lista;
}

type Linha = {
  id: string;
  dm_em: Date | null;
  dm_erro: string | null;
  dm_tentativas: number;
  igsid: string | null;
  resposta_em: Date | null;
  resposta_erro: string | null;
};

async function linha(db: PGlite, commentId: string): Promise<Linha> {
  const r = await db.query<Linha>(
    `select id, dm_em, dm_erro, dm_tentativas, igsid, resposta_em, resposta_erro
     from public.comentarios where comment_id = $1`,
    [commentId],
  );
  return r.rows[0];
}

async function pausaDe(db: PGlite, contaId: string) {
  const r = await db.query<{ direct_ate: Date | null; resposta_ate: Date | null; motivo: string | null }>(
    `select direct_ate, resposta_ate, motivo from public.envio_pausa where conta_id = $1`,
    [contaId],
  );
  return r.rows[0] ?? null;
}

async function semMexer(db: PGlite): Promise<string> {
  const r = await db.query(
    `select comment_id, dm_em, dm_erro, dm_tentativas, igsid, resposta_em, resposta_erro
     from public.comentarios order by comment_id`,
  );
  return JSON.stringify(r.rows);
}

// ---------------------------------------------------------------- a Meta de mentira

type Chamada = {
  tipo: "botao" // resposta privada com o modelo de botão
  | "texto" // resposta privada só com texto
  | "resposta"; // resposta pública ao comentário
  url: URL;
  token: string;
  // deno-lint-ignore no-explicit-any
  corpo: any;
  commentId: string;
};

type Responder = (c: Chamada, n: number) => Response | Promise<Response>;

const ok = (corpo: unknown = {}) => Response.json(corpo);
const erroMeta = (status: number, code: number, message: string) =>
  Response.json({ error: { message, type: "OAuthException", code } }, { status });
const LIMITE = () => erroMeta(400, 4, "Application request limit reached");

function metaFalsa(responder?: Responder) {
  const chamadas: Chamada[] = [];
  const falso: typeof fetch = async (entrada, init) => {
    const pedido = new Request(entrada as RequestInfo, init);
    const url = new URL(pedido.url);
    assertEquals(url.origin, "https://graph.instagram.com", "a função só fala com a Meta");
    assertEquals(pedido.method, "POST");
    const corpo = await pedido.json();
    const tipo = url.pathname.endsWith("/replies") ? "resposta" : corpo.message?.attachment ? "botao" : "texto";
    const commentId = tipo === "resposta" ? decodeURIComponent(url.pathname.split("/").at(-2)!) : corpo.recipient.comment_id;
    const chamada: Chamada = {
      tipo,
      url,
      token: (pedido.headers.get("authorization") ?? "").replace("Bearer ", ""),
      corpo,
      commentId,
    };
    chamadas.push(chamada);
    if (responder) return await responder(chamada, chamadas.length);
    return tipo === "resposta"
      ? ok({ id: `resp-${commentId}` })
      : ok({ recipient_id: `igsid-${commentId}`, message_id: `mid-${commentId}` });
  };
  return {
    fetch: falso,
    chamadas,
    de: (commentId: string) => chamadas.filter((c) => c.commentId === commentId),
  };
}
type MetaFalsa = ReturnType<typeof metaFalsa>;

// ---------------------------------------------------------------- rodar

type Cenario = Awaited<ReturnType<typeof montar>>;

async function montar() {
  const base = await (postgres ??= subir());
  const { db } = base;
  await db.exec("delete from auth.users");
  // devolve as regras ao que a migration pôs (inclusive a que um teste apagou)
  for (const r of base.regras) {
    await db.query(
      `insert into public.regras (chave, valor, descricao) values ($1, $2, $3)
       on conflict (chave) do update set valor = excluded.valor`,
      [r.chave, r.valor, r.descricao],
    );
  }
  const { banco, consultas } = bancoEnviaSobrePg(db);
  return { db, banco, consultas };
}

function teste(nome: string, corpo: (c: Cenario) => Promise<void>) {
  Deno.test(nome, async () => {
    await corpo(await montar());
  });
}

async function executar(
  c: { banco: Banco },
  meta: MetaFalsa,
  mais: Partial<DependenciasRodada> = {},
) {
  const esperas: number[] = [];
  const resumo = await rodar({
    banco: c.banco,
    meta: (token) => criarMeta({ token, fetch: meta.fetch }),
    chaveTokens: await importarChave(CHAVE_TOKENS),
    siteUrl: SITE,
    esperar: (ms) => {
      esperas.push(ms);
      return Promise.resolve();
    },
    agora: Date.now,
    orcamentoMs: 100_000,
    contasEmParalelo: 3,
    ...mais,
  });
  return { resumo, esperas };
}

/** Roda `fn` guardando o que foi para console.error / console.log (e sem sujar a saída do teste). */
async function capturandoLog<T>(fn: () => Promise<T>): Promise<{ r: T; erros: unknown[][]; logs: unknown[][] }> {
  const erros: unknown[][] = [];
  const logs: unknown[][] = [];
  const [e, l] = [console.error, console.log];
  console.error = (...a) => void erros.push(a);
  console.log = (...a) => void logs.push(a);
  try {
    return { r: await fn(), erros, logs };
  } finally {
    [console.error, console.log] = [e, l];
  }
}

const perto = (data: Date | null, esperado: number, tolerancia = 60_000) =>
  data !== null && Math.abs(data.getTime() - esperado) < tolerancia;

// ================================================================ a. envia e marca

teste("a. envia a DM com o botão e o link certos e marca dm_em e igsid", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { mensagem: "Oi! Segue o link.", titulo: "Ver oferta" });
  const [com] = await fila(c.db, conta, auto.id, 1);
  const meta = metaFalsa();

  const { resumo } = await executar(c, meta);

  assertEquals(meta.chamadas.length, 1);
  const p = meta.chamadas[0];
  assertEquals(p.tipo, "botao");
  assertEquals(p.url.pathname, `/v23.0/${conta.igUserId}/messages`);
  assertEquals(p.token, conta.token, "o token da conta, decifrado");
  assertEquals(p.corpo, {
    recipient: { comment_id: com.commentId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Oi! Segue o link.",
          buttons: [{ type: "web_url", url: `${SITE}/l/${auto.codigo}?c=${com.id}`, title: "Ver oferta" }],
        },
      },
    },
  });

  const l = await linha(c.db, com.commentId);
  assert(perto(l.dm_em, Date.now()), "dm_em marcado agora");
  assertEquals(l.igsid, `igsid-${com.commentId}`, "igsid = recipient_id da Meta");
  assertEquals(l.dm_erro, null);
  assertEquals(l.dm_tentativas, 1);
  assertEquals(l.resposta_em, null, "a automação não tem resposta pública");
  assertEquals(resumo.enviadas, 1);
  assertEquals(await pausaDe(c.db, conta.contaId), null);
});

teste("a. a versão da Graph API vem de INSTAGRAM_GRAPH_VERSAO quando configurada", async () => {
  const meta = metaFalsa();
  await criarMeta({ token: "t", fetch: meta.fetch, versao: "v25.0" }).enviarTexto("123", "C-9", "oi");
  assertEquals(meta.chamadas[0].url.pathname, "/v25.0/123/messages");
});

teste("a. quem já foi enviado, errou ou está em outra conta não é mexido", async (c) => {
  const conta = await novaConta(c.db);
  const demo = await novaConta(c.db, { demonstracao: true });
  const desligada = await novaConta(c.db, { status: "desconectada" });
  const auto = await novaAutomacao(c.db, conta);
  const feito = await novoComentario(c.db, conta, auto.id);
  const erro = await novoComentario(c.db, conta, auto.id);
  await c.db.query(`update public.comentarios set dm_em = now() where id = $1`, [feito.id]);
  await c.db.query(`update public.comentarios set dm_erro = 'antigo' where id = $1`, [erro.id]);
  for (const outra of [demo, desligada]) {
    await novoComentario(c.db, outra, (await novaAutomacao(c.db, outra)).id);
  }
  const antes = await semMexer(c.db);
  const meta = metaFalsa();

  await executar(c, meta);

  assertEquals(meta.chamadas.length, 0, "conta de demonstração e conta desconectada nem são olhadas");
  assertEquals(await semMexer(c.db), antes);
});

// ================================================================ b. limite

for (
  const [nome, resposta] of [
    ["código 4", () => erroMeta(400, 4, "Application request limit reached")],
    ["código 17", () => erroMeta(400, 17, "User request limit reached")],
    ["código 32", () => erroMeta(400, 32, "Page request limit reached")],
    ["código 613", () => erroMeta(400, 613, "Calls to this api have exceeded the rate limit.")],
    ["código 80002", () => erroMeta(400, 80002, "There have been too many calls to this Instagram account.")],
    ["texto 'limit how often'", () => erroMeta(400, 1, "We limit how often you can post content.")],
    ["HTTP 429", () => Response.json({}, { status: 429 })],
  ] as [string, () => Response][]
) {
  teste(`b. limite da Meta (${nome}): pausa a conta, sem dm_erro, e o 2º comentário nem é tentado`, async (c) => {
    const conta = await novaConta(c.db);
    const auto = await novaAutomacao(c.db, conta);
    const [primeiro, segundo] = await fila(c.db, conta, auto.id, 2);
    const meta = metaFalsa(resposta);

    const { resumo } = await executar(c, meta);

    assertEquals(meta.chamadas.length, 1, "parou no primeiro");
    assertEquals(meta.de(segundo.commentId).length, 0);
    const p = await pausaDe(c.db, conta.contaId);
    assert(p !== null && perto(p.direct_ate, Date.now() + 180 * MINUTO), "direct_ate = agora + envio_pausa_direct_min");
    assert(p.motivo && p.motivo.length > 0, "o motivo fica anotado");
    assertEquals(p.resposta_ate, null);
    for (const com of [primeiro, segundo]) {
      const l = await linha(c.db, com.commentId);
      assertEquals(l.dm_erro, null, "limite não marca erro: a pessoa segue na fila");
      assertEquals(l.dm_em, null);
      assertEquals(l.dm_tentativas, 0, "a reserva foi devolvida");
    }
    assertEquals(resumo.pausadas, 1);
    assertEquals(resumo.erros, 0);
  });
}

teste("b. enquanto a pausa vale a conta é pulada; vencida a pausa, a fila anda", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [com] = await fila(c.db, conta, auto.id, 1);

  await executar(c, metaFalsa(LIMITE)); // pausa
  const parada = metaFalsa();
  await executar(c, parada);
  assertEquals(parada.chamadas.length, 0, "pausada: nenhuma chamada");
  assertEquals((await linha(c.db, com.commentId)).dm_em, null);

  await c.db.query(`update public.envio_pausa set direct_ate = now() - interval '1 minute' where conta_id = $1`, [conta.contaId]);
  const livre = metaFalsa();
  await executar(c, livre);
  assertEquals(livre.chamadas.length, 1);
  assertNotEquals((await linha(c.db, com.commentId)).dm_em, null);
});

teste("b. o tempo da pausa vem da tabela regras", async (c) => {
  await mudarRegra(c.db, "envio_pausa_direct_min", 30);
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  await fila(c.db, conta, auto.id, 1);
  await executar(c, metaFalsa(LIMITE));
  const p = await pausaDe(c.db, conta.contaId);
  assert(p !== null && perto(p.direct_ate, Date.now() + 30 * MINUTO), "30 min, e não os 180 de antes");
});

teste("b. limite que vem só depois de o botão ser recusado também pausa (e não marca erro)", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [com] = await fila(c.db, conta, auto.id, 1);
  const meta = metaFalsa((ch) => (ch.tipo === "botao" ? erroMeta(400, 100, "botão recusado") : LIMITE()));

  await executar(c, meta);

  assertEquals(meta.chamadas.map((x) => x.tipo), ["botao", "texto"]);
  const l = await linha(c.db, com.commentId);
  assertEquals([l.dm_erro, l.dm_em, l.dm_tentativas], [null, null, 0]);
  assertNotEquals(await pausaDe(c.db, conta.contaId), null);
});

// ================================================================ c. erro comum

teste("c. erro comum: dm_erro e dm_tentativas + 1, e a rodada segue com o próximo", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [ruim, bom] = await fila(c.db, conta, auto.id, 2);
  // 551 = a pessoa não pode receber mensagem; o texto também é recusado
  const meta = metaFalsa((ch) =>
    ch.commentId === ruim.commentId ? erroMeta(400, 551, "Esta pessoa não está disponível\npara receber mensagens") : ok({ recipient_id: "99" })
  );

  const { resumo } = await executar(c, meta);

  const l = await linha(c.db, ruim.commentId);
  assertEquals(l.dm_erro, "(551) Esta pessoa não está disponível para receber mensagens");
  assertEquals(l.dm_tentativas, 1);
  assertEquals(l.dm_em, null);
  assertEquals(l.resposta_em, null);
  assertNotEquals((await linha(c.db, bom.commentId)).dm_em, null, "o erro de uma pessoa não para a fila");
  assertEquals(await pausaDe(c.db, conta.contaId), null, "erro comum não pausa a conta");
  assertEquals([resumo.erros, resumo.enviadas], [1, 1]);

  // e não volta pra fila: uma segunda rodada não tenta de novo
  const outra = metaFalsa();
  await executar(c, outra);
  assertEquals(outra.chamadas.length, 0);
});

teste("c. erro de rede ou 5xx: dm_erro SEM mandar de novo como texto (a DM pode ter saído)", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [a, b] = await fila(c.db, conta, auto.id, 2);
  const meta = metaFalsa((ch) => {
    if (ch.commentId === a.commentId) return erroMeta(500, 2, "Service temporarily unavailable");
    throw new TypeError("connection reset");
  });

  await executar(c, meta);

  assertEquals(meta.chamadas.map((x) => x.tipo), ["botao", "botao"], "nenhum reenvio como texto");
  assertEquals((await linha(c.db, a.commentId)).dm_erro, "(2) Service temporarily unavailable");
  assertEquals((await linha(c.db, b.commentId)).dm_erro, "connection reset");
  assertEquals(await pausaDe(c.db, conta.contaId), null);
});

teste("c. resposta de erro sem corpo vira um dm_erro legível", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [a] = await fila(c.db, conta, auto.id, 1);
  await executar(c, metaFalsa(() => new Response("<html>bad gateway</html>", { status: 502 })));
  assertEquals((await linha(c.db, a.commentId)).dm_erro, "Meta respondeu HTTP 502");
});

// ================================================================ d. botão recusado

teste("d. botão recusado (e não é limite): reenvia como texto com o link e marca dm_em", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { mensagem: "Seu link chegou" });
  const [com] = await fila(c.db, conta, auto.id, 1);
  const meta = metaFalsa((ch) =>
    ch.tipo === "botao" ? erroMeta(400, 100, "Unsupported message type") : ok({ recipient_id: "777" })
  );

  const { resumo } = await executar(c, meta);

  assertEquals(meta.chamadas.map((x) => x.tipo), ["botao", "texto"]);
  const texto = meta.chamadas[1];
  assertEquals(texto.url.pathname, `/v23.0/${conta.igUserId}/messages`);
  assertEquals(texto.corpo, {
    recipient: { comment_id: com.commentId },
    message: { text: `Seu link chegou\n\n${SITE}/l/${auto.codigo}?c=${com.id}` },
  });
  const l = await linha(c.db, com.commentId);
  assert(perto(l.dm_em, Date.now()));
  assertEquals([l.igsid, l.dm_erro, l.dm_tentativas], ["777", null, 1]);
  assertEquals(resumo.enviadas, 1);
});

teste("d. botão e texto recusados: dm_erro com o motivo do texto", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [com] = await fila(c.db, conta, auto.id, 1);
  const meta = metaFalsa((ch) =>
    ch.tipo === "botao" ? erroMeta(400, 100, "botão não") : erroMeta(400, 10903, "Já existe resposta privada")
  );
  await executar(c, meta);
  assertEquals(meta.chamadas.length, 2);
  const l = await linha(c.db, com.commentId);
  assertEquals(l.dm_erro, "(10903) Já existe resposta privada");
  assertEquals([l.dm_em, l.dm_tentativas], [null, 1]);
});

// ================================================================ e. assinatura

teste("e. assinatura não liberada: não envia nada e a fila fica intacta", async (c) => {
  const vencida = await novaConta(c.db);
  const cancelada = await novaConta(c.db);
  const ativaVencida = await novaConta(c.db);
  for (const conta of [vencida, cancelada, ativaVencida]) {
    await fila(c.db, conta, (await novaAutomacao(c.db, conta, { resposta: "Te mandei!" })).id, 2);
  }
  await c.db.query(`update public.assinaturas set trial_ate = now() - interval '1 second' where user_id = $1`, [vencida.userId]);
  await c.db.query(`update public.assinaturas set status = 'cancelada' where user_id = $1`, [cancelada.userId]);
  // paga, mas passou da carência de 3 dias
  await c.db.query(
    `update public.assinaturas set status = 'ativa', periodo_ate = now() - interval '4 days' where user_id = $1`,
    [ativaVencida.userId],
  );
  for (const conta of [vencida, cancelada, ativaVencida]) {
    const r = await c.db.query<{ liberada: boolean }>(`select liberada from public.assinatura_situacao($1)`, [conta.userId]);
    assertEquals(r.rows[0].liberada, false, "pré-condição: o banco diz liberada = false");
  }
  const antes = await semMexer(c.db);
  const meta = metaFalsa();

  const { resumo } = await executar(c, meta);

  assertEquals(meta.chamadas.length, 0);
  assertEquals(await semMexer(c.db), antes, "a fila fica guardada, sem erro e sem tentativa");
  assertEquals(resumo.puladas, 3);
  assertEquals(resumo.enviadas, 0);
});

teste("e. assinatura em dia (teste ou paga, inclusive na carência) envia", async (c) => {
  const teste7 = await novaConta(c.db);
  const naCarencia = await novaConta(c.db);
  for (const conta of [teste7, naCarencia]) await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 1);
  await c.db.query(
    `update public.assinaturas set status = 'ativa', periodo_ate = now() - interval '2 days' where user_id = $1`,
    [naCarencia.userId],
  );
  const meta = metaFalsa();
  await executar(c, meta);
  assertEquals(meta.chamadas.length, 2);
});

// ================================================================ f. contas independentes

teste("f. outra conta segue enviando enquanto uma está pausada", async (c) => {
  const pausada = await novaConta(c.db);
  const livre = await novaConta(c.db);
  const [p1] = await fila(c.db, pausada, (await novaAutomacao(c.db, pausada)).id, 1);
  const [l1, l2] = await fila(c.db, livre, (await novaAutomacao(c.db, livre)).id, 2);
  await c.db.query(
    `insert into public.envio_pausa (conta_id, direct_ate, motivo) values ($1, now() + interval '2 hours', 'limite')`,
    [pausada.contaId],
  );
  const meta = metaFalsa();

  await executar(c, meta);

  assertEquals(meta.de(p1.commentId).length, 0);
  assertEquals((await linha(c.db, p1.commentId)).dm_em, null);
  assertNotEquals((await linha(c.db, l1.commentId)).dm_em, null);
  assertNotEquals((await linha(c.db, l2.commentId)).dm_em, null);
  assert(meta.chamadas.every((x) => x.token === livre.token), "só o token da conta livre foi usado");
});

teste("f. o limite de uma conta, na mesma rodada, não para as outras (e cada uma usa o seu token)", async (c) => {
  const a = await novaConta(c.db);
  const b = await novaConta(c.db);
  const [a1, a2] = await fila(c.db, a, (await novaAutomacao(c.db, a)).id, 2);
  const [b1, b2, b3] = await fila(c.db, b, (await novaAutomacao(c.db, b)).id, 3);
  const meta = metaFalsa((ch) => (ch.token === a.token ? LIMITE() : ok({ recipient_id: "1" })));

  await executar(c, meta);

  assertNotEquals(await pausaDe(c.db, a.contaId), null);
  assertEquals(await pausaDe(c.db, b.contaId), null, "a pausa é por conta");
  assertEquals(meta.chamadas.filter((x) => x.token === a.token).length, 1);
  for (const com of [b1, b2, b3]) assertNotEquals((await linha(c.db, com.commentId)).dm_em, null);
  for (const com of [a1, a2]) assertEquals((await linha(c.db, com.commentId)).dm_em, null);
});

teste("f. uma conta com defeito no banco não derruba as outras", async (c) => {
  const quebrada = await novaConta(c.db);
  const boa = await novaConta(c.db);
  await fila(c.db, quebrada, (await novaAutomacao(c.db, quebrada)).id, 1);
  const [com] = await fila(c.db, boa, (await novaAutomacao(c.db, boa)).id, 1);
  const banco: Banco = {
    ...c.banco,
    fila: (contaId, desde, limite) =>
      contaId === quebrada.contaId ? Promise.reject(new Error("comentarios: boom")) : c.banco.fila(contaId, desde, limite),
  };
  const meta = metaFalsa();

  const { r: { resumo }, erros } = await capturandoLog(() => executar({ banco }, meta));

  assertEquals(resumo.falhas, 1);
  assertNotEquals((await linha(c.db, com.commentId)).dm_em, null);
  assertEquals(erros.length, 1);
  assert(String(erros[0].join(" ")).includes(quebrada.contaId), "o log diz qual conta");
});

// ================================================================ g. a chave do cron

type Env = Record<string, string | undefined>;

async function montarHttp() {
  const c = await montar();
  const meta = metaFalsa();
  let bancosPedidos = 0;
  const env: Env = {
    GATILHO_CRON_CHAVE: CRON_CHAVE,
    GATILHO_CHAVE_TOKENS: CHAVE_TOKENS,
    GATILHO_SITE_URL: `${SITE}/`,
  };
  const manipular = criarManipulador({
    env: (nome) => env[nome],
    banco: () => {
      bancosPedidos++;
      return c.banco;
    },
    fetch: meta.fetch,
    esperar: () => Promise.resolve(),
  });
  const chamar = (metodo = "POST", chave: string | null = CRON_CHAVE) =>
    manipular(
      new Request("http://localhost:54321/functions/v1/gatilho-envia", {
        method: metodo,
        headers: chave === null ? {} : { "x-cron-chave": chave },
        body: metodo === "POST" ? "{}" : undefined,
      }),
    );
  return { ...c, meta, env, chamar, bancosPedidos: () => bancosPedidos };
}

function testeHttp(nome: string, corpo: (c: Awaited<ReturnType<typeof montarHttp>>) => Promise<void>) {
  Deno.test(nome, async () => {
    await corpo(await montarHttp());
  });
}

testeHttp("g. chave do cron errada ou ausente: 401, sem tocar no banco, na Meta nem no log", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  await fila(c.db, conta, auto.id, 2);
  const antes = await semMexer(c.db);

  const { r: statuses, erros, logs } = await capturandoLog(async () => [
    (await c.chamar("POST", null)).status, // sem o cabeçalho
    (await c.chamar("POST", "")).status,
    (await c.chamar("POST", "chave-errada")).status,
    (await c.chamar("POST", CRON_CHAVE + "x")).status, // prefixo certo, sobra no fim
    (await c.chamar("POST", CRON_CHAVE.slice(0, -1))).status, // falta o último caractere
    (await c.chamar("POST", CRON_CHAVE.toUpperCase())).status,
  ]);

  assertEquals(statuses, [401, 401, 401, 401, 401, 401]);
  assertEquals(c.bancosPedidos(), 0, "nem o cliente do banco é criado");
  assertEquals(c.consultas.n, 0, "nenhuma consulta ao banco");
  assertEquals(c.meta.chamadas.length, 0, "nenhuma chamada à Meta");
  assertEquals(await semMexer(c.db), antes);
  assertEquals([erros.length, logs.length], [0, 0], "nada vai para o log");
});

testeHttp("g. outros métodos: 405, mesmo com a chave certa", async (c) => {
  for (const metodo of ["GET", "PUT", "DELETE", "PATCH"]) {
    assertEquals((await c.chamar(metodo)).status, 405, metodo);
  }
  assertEquals(c.bancosPedidos(), 0);
  assertEquals(c.consultas.n, 0);
});

testeHttp("g. sem GATILHO_CRON_CHAVE configurada: 503 'indisponível', detalhe só no console.error", async (c) => {
  delete c.env.GATILHO_CRON_CHAVE;
  const { r, erros } = await capturandoLog(async () => await c.chamar("POST", "qualquer-coisa"));
  assertEquals(r.status, 503);
  assertEquals(await r.text(), "indisponível");
  assertEquals(erros.length, 1);
  assert(String(erros[0][0]).includes("GATILHO_CRON_CHAVE"));
  // chave vazia no ambiente também não vira "chave em branco aceita"
  c.env.GATILHO_CRON_CHAVE = "";
  assertEquals((await (await capturandoLog(async () => await c.chamar("POST", ""))).r).status, 503);
  assertEquals(c.bancosPedidos(), 0);
  assertEquals(c.consultas.n, 0);
});

testeHttp("g. sem GATILHO_CHAVE_TOKENS ou GATILHO_SITE_URL (chave do cron certa): 503, sem tocar no banco", async (c) => {
  for (const falta of ["GATILHO_CHAVE_TOKENS", "GATILHO_SITE_URL"]) {
    const guardado = c.env[falta];
    delete c.env[falta];
    const { r, erros } = await capturandoLog(async () => await c.chamar());
    assertEquals(r.status, 503);
    assertEquals(await r.text(), "indisponível");
    assert(String(erros[0][0]).includes(falta));
    c.env[falta] = guardado;
  }
  c.env.GATILHO_SITE_URL = "gatlo.exemplo.invalid"; // sem http(s): o link da DM sairia quebrado
  assertEquals((await capturandoLog(async () => await c.chamar())).r.status, 503);
  assertEquals(c.bancosPedidos(), 0);
  assertEquals(c.meta.chamadas.length, 0);
});

testeHttp("g. chave certa: 200, envia, e o link usa o site sem a barra do fim", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [com] = await fila(c.db, conta, auto.id, 1);

  const { r, logs } = await capturandoLog(async () => await c.chamar());

  assertEquals(r.status, 200);
  const corpo = await r.json();
  assertEquals([corpo.ok, corpo.contas, corpo.enviadas], [true, 1, 1]);
  assertEquals(c.meta.chamadas[0].corpo.message.attachment.payload.buttons[0].url, `${SITE}/l/${auto.codigo}?c=${com.id}`);
  assertNotEquals((await linha(c.db, com.commentId)).dm_em, null);
  assertEquals(logs.length, 1);
  const log = JSON.stringify(logs[0]);
  assert(!log.includes(conta.token) && !log.includes(com.commentId), "o log do resumo só tem números");
});

testeHttp("g. falha do banco: 500 genérico e o detalhe só no log", async (c) => {
  const quebrado = criarManipulador({
    env: (nome) => c.env[nome],
    banco: () => ({ ...c.banco, regras: () => Promise.reject(new Error("regras: connection refused")) }),
    fetch: c.meta.fetch,
  });
  const { r, erros } = await capturandoLog(async () =>
    await quebrado(new Request("http://localhost/x", { method: "POST", headers: { "x-cron-chave": CRON_CHAVE } }))
  );
  assertEquals(r.status, 500);
  assert(!(await r.text()).includes("connection refused"));
  assert(String(erros[0].join(" ")).includes("connection refused"));
});

Deno.test("g. iguaisEmTempoConstante", () => {
  assert(iguaisEmTempoConstante("abc", "abc"));
  assert(!iguaisEmTempoConstante("abc", "abd"));
  assert(!iguaisEmTempoConstante("abc", "abcd"));
  assert(!iguaisEmTempoConstante("", "a"));
  assert(iguaisEmTempoConstante("", ""));
});

// ================================================================ h. a mesma DM nunca sai duas vezes

teste("h. duas rodadas ao mesmo tempo sobre a mesma fila: cada comentário recebe 1 chamada à Meta", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { resposta: "Te mandei na DM!" });
  const lista = await fila(c.db, conta, auto.id, 6);
  // a Meta demora e as rodadas se entrelaçam (esperar também cede a vez de verdade)
  const meta = metaFalsa(async (ch) => {
    await new Promise((r) => setTimeout(r, 5));
    return ch.tipo === "resposta" ? ok({ id: "r" }) : ok({ recipient_id: "1" });
  });
  const cede = () => new Promise<void>((r) => setTimeout(r, 1));

  const [um, dois] = await Promise.all([
    executar(c, meta, { esperar: cede }),
    executar(c, meta, { esperar: cede }),
  ]);

  for (const com of lista) {
    assertEquals(meta.de(com.commentId).filter((x) => x.tipo !== "resposta").length, 1, `DM de ${com.commentId}`);
    assertEquals(meta.de(com.commentId).filter((x) => x.tipo === "resposta").length, 1, `resposta de ${com.commentId}`);
    const l = await linha(c.db, com.commentId);
    assertNotEquals(l.dm_em, null);
    assertEquals(l.dm_tentativas, 1);
  }
  assertEquals(um.resumo.enviadas + dois.resumo.enviadas, 6);
  assertEquals(um.resumo.concorrencia + dois.resumo.concorrencia > 0, true, "alguém perdeu a disputa por uma linha");
});

teste("h. duas rodadas, uma começando no meio da outra (a DM ainda em voo): não repete", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const lista = await fila(c.db, conta, auto.id, 3);
  let segunda: Promise<unknown> | null = null;
  const meta = metaFalsa(async (ch, n) => {
    // no meio da 1ª DM da 1ª rodada (já reservada, ainda sem resposta da Meta), a 2ª rodada começa
    if (n === 1) segunda = executar(c, meta);
    await new Promise((r) => setTimeout(r, 20));
    return ok({ recipient_id: `i-${ch.commentId}` });
  });

  await executar(c, meta);
  await segunda;

  for (const com of lista) assertEquals(meta.de(com.commentId).length, 1, com.commentId);
});

teste("h. reservar: só uma de várias tentativas ao mesmo tempo leva a linha; e linha já enviada ou com erro não é reservada", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [com, feito, erro] = await fila(c.db, conta, auto.id, 3);
  await c.db.query(`update public.comentarios set dm_em = now() where id = $1`, [feito.id]);
  await c.db.query(`update public.comentarios set dm_erro = 'x' where id = $1`, [erro.id]);

  const resultados = await Promise.all(Array.from({ length: 8 }, () => c.banco.reservar(com.id, 0)));
  assertEquals(resultados.filter(Boolean).length, 1);
  assertEquals((await linha(c.db, com.commentId)).dm_tentativas, 1);
  assertEquals(await c.banco.reservar(com.id, 0), false, "valor lido velho");
  assertEquals(await c.banco.reservar(feito.id, 0), false);
  assertEquals(await c.banco.reservar(erro.id, 0), false);
});

teste("h. marcar dm_em / dm_erro só vale em linha que ainda tem dm_em nulo", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [a] = await fila(c.db, conta, auto.id, 1);
  await c.banco.marcarDmOk(a.id, "primeiro", new Date("2026-10-01T10:00:00Z"));
  await c.banco.marcarDmOk(a.id, "segundo", new Date("2026-10-02T10:00:00Z"));
  await c.banco.marcarDmErro(a.id, "tarde demais");
  const la = await linha(c.db, a.commentId);
  assertEquals([la.igsid, la.dm_erro, la.dm_em?.toISOString()], ["primeiro", null, "2026-10-01T10:00:00.000Z"]);
});

teste("h. a marca de dm_em que falha é tentada de novo (e a DM não sai duas vezes)", async (c) => {
  const conta = await novaConta(c.db);
  const [com] = await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 1);
  let falhas = 0;
  const banco: Banco = {
    ...c.banco,
    marcarDmOk: (...a) => (falhas++ < 2 ? Promise.reject(new Error("rede")) : c.banco.marcarDmOk(...a)),
  };
  const meta = metaFalsa();
  await executar({ banco }, meta);
  assertEquals(meta.chamadas.length, 1);
  assertNotEquals((await linha(c.db, com.commentId)).dm_em, null);
});

teste("h. DM aceita pela Meta mas banco fora do ar: o comentário NÃO volta pra fila (nada de DM repetida)", async (c) => {
  const conta = await novaConta(c.db);
  const [com] = await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 1);
  const banco: Banco = { ...c.banco, marcarDmOk: () => Promise.reject(new Error("banco fora")) };
  const meta = metaFalsa();

  const { r: { resumo } } = await capturandoLog(() => executar({ banco }, meta));
  assertEquals(resumo.falhas, 1);

  const l = await linha(c.db, com.commentId);
  assertEquals([l.dm_em, l.dm_erro, l.dm_tentativas], [null, null, 1], "fica reservado");
  const outra = metaFalsa();
  await executar(c, outra);
  assertEquals(outra.chamadas.length, 0, "a próxima rodada não repete a DM");
});

// ================================================================ i. números vêm da tabela regras

teste("i. envio_max_por_rodada vem da tabela regras", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const lista = await fila(c.db, conta, auto.id, 10);

  await mudarRegra(c.db, "envio_max_por_rodada", 2);
  const m1 = metaFalsa();
  await executar(c, m1);
  assertEquals(m1.chamadas.length, 2);
  assertEquals(m1.chamadas.map((x) => x.commentId), [lista[0].commentId, lista[1].commentId], "os mais antigos primeiro");

  await mudarRegra(c.db, "envio_max_por_rodada", 5);
  const m2 = metaFalsa();
  await executar(c, m2);
  assertEquals(m2.chamadas.length, 5);
  assertEquals(m2.chamadas[0].commentId, lista[2].commentId);

  await mudarRegra(c.db, "envio_max_por_rodada", 1);
  const m3 = metaFalsa();
  await executar(c, m3);
  assertEquals(m3.chamadas.length, 1);
});

teste("i. envio_intervalo_segundos vem da tabela regras (e só se espera ENTRE uma DM e outra)", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  await fila(c.db, conta, auto.id, 3);

  await mudarRegra(c.db, "envio_intervalo_segundos", 9);
  const r1 = await executar(c, metaFalsa());
  assertEquals(r1.esperas, [9000, 9000], "3 DMs = 2 esperas");

  await fila(c.db, conta, auto.id, 2, 10);
  await mudarRegra(c.db, "envio_intervalo_segundos", 1);
  const r2 = await executar(c, metaFalsa());
  assertEquals(r2.esperas, [1000]);

  await fila(c.db, conta, auto.id, 1, 20);
  assertEquals((await executar(c, metaFalsa())).esperas, [], "uma DM só: não espera");
});

teste("i. fila_janela_dias vem da tabela regras", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const velho = await novoComentario(c.db, conta, auto.id, { ha: 8 * DIA });
  const recente = await novoComentario(c.db, conta, auto.id, { ha: 5 * DIA });

  const m1 = metaFalsa();
  await executar(c, m1);
  assertEquals(m1.chamadas.map((x) => x.commentId), [recente.commentId]);

  await mudarRegra(c.db, "fila_janela_dias", 10);
  const m2 = metaFalsa();
  await executar(c, m2);
  assertEquals(m2.chamadas.map((x) => x.commentId), [velho.commentId]);
});

teste("i. regra faltando é erro, nunca um número inventado", async (c) => {
  await c.db.query(`delete from public.regras where chave = 'envio_intervalo_segundos'`);
  const conta = await novaConta(c.db);
  await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 1);
  const meta = metaFalsa();
  let erro: unknown = null;
  try {
    await executar(c, meta);
  } catch (e) {
    erro = e;
  }
  assert(erro instanceof Error && erro.message.includes("envio_intervalo_segundos"));
  assertEquals(meta.chamadas.length, 0);
});

// ================================================================ j. resposta pública

teste("j. a resposta pública sai quando a DM sai", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { resposta: "Te mandei na DM! 💌" });
  const [com] = await fila(c.db, conta, auto.id, 1);
  const meta = metaFalsa();

  const { resumo } = await executar(c, meta);

  assertEquals(meta.chamadas.map((x) => x.tipo), ["botao", "resposta"], "primeiro a DM, depois a resposta");
  const r = meta.chamadas[1];
  assertEquals(r.url.pathname, `/v23.0/${com.commentId}/replies`);
  assertEquals(r.corpo, { message: "Te mandei na DM! 💌" });
  assertEquals(r.token, conta.token);
  const l = await linha(c.db, com.commentId);
  assert(perto(l.resposta_em, Date.now()));
  assertNotEquals(l.dm_em, null);
  assertEquals(resumo.respostas, 1);
});

teste("j. sem resposta_publica na automação, ou DM com erro: nenhuma resposta", async (c) => {
  const conta = await novaConta(c.db);
  const sem = await novaAutomacao(c.db, conta, { resposta: null });
  const com = await novaAutomacao(c.db, conta, { resposta: "Te mandei!" });
  const [a] = await fila(c.db, conta, sem.id, 1);
  const b = await novoComentario(c.db, conta, com.id, { ha: 30 * MINUTO });
  const meta = metaFalsa((ch) => (ch.commentId === b.commentId ? erroMeta(400, 551, "não pode") : ok({ recipient_id: "1" })));

  await executar(c, meta);

  assertEquals(meta.chamadas.filter((x) => x.tipo === "resposta").length, 0);
  assertEquals((await linha(c.db, a.commentId)).resposta_em, null);
  assertEquals((await linha(c.db, b.commentId)).resposta_em, null);
});

teste("j. com resposta_ate no futuro a DM sai e a resposta não", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { resposta: "Te mandei!" });
  const lista = await fila(c.db, conta, auto.id, 2);
  await c.db.query(
    `insert into public.envio_pausa (conta_id, resposta_ate, motivo) values ($1, now() + interval '30 minutes', 'limite')`,
    [conta.contaId],
  );
  const meta = metaFalsa();

  await executar(c, meta);

  assertEquals(meta.chamadas.map((x) => x.tipo), ["botao", "botao"]);
  for (const com of lista) {
    const l = await linha(c.db, com.commentId);
    assertNotEquals(l.dm_em, null);
    assertEquals([l.resposta_em, l.resposta_erro], [null, null]);
  }

  // vencida a pausa da resposta, volta a responder
  await c.db.query(`update public.envio_pausa set resposta_ate = now() - interval '1 minute' where conta_id = $1`, [conta.contaId]);
  await fila(c.db, conta, auto.id, 1, 30);
  const livre = metaFalsa();
  await executar(c, livre);
  assertEquals(livre.chamadas.map((x) => x.tipo), ["botao", "resposta"]);
});

teste("j. acima do teto de respostas em 24 h só manda a DM (o teto vem da tabela regras)", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { resposta: "Te mandei!" });
  // 2 respostas nas últimas 24 h e 5 mais antigas (essas não contam)
  for (let i = 0; i < 2; i++) {
    const x = await novoComentario(c.db, conta, auto.id);
    await c.db.query(`update public.comentarios set dm_em = now(), resposta_em = now() - interval '23 hours' where id = $1`, [x.id]);
  }
  for (let i = 0; i < 5; i++) {
    const x = await novoComentario(c.db, conta, auto.id);
    await c.db.query(`update public.comentarios set dm_em = now(), resposta_em = now() - interval '25 hours' where id = $1`, [x.id]);
  }
  await mudarRegra(c.db, "respostas_publicas_max_24h", 4);
  await fila(c.db, conta, auto.id, 5, 100);
  const meta = metaFalsa();

  const { resumo } = await executar(c, meta);

  // 4 - 2 = 2 respostas de folga: as duas primeiras DMs respondem, as outras três não
  assertEquals(meta.chamadas.filter((x) => x.tipo === "botao").length, 5);
  assertEquals(meta.chamadas.filter((x) => x.tipo === "resposta").length, 2);
  assertEquals(resumo.respostas, 2);

  // no teto: a próxima rodada só manda a DM
  await fila(c.db, conta, auto.id, 1, 200);
  const outra = metaFalsa();
  await executar(c, outra);
  assertEquals(outra.chamadas.map((x) => x.tipo), ["botao"]);

  // sem resposta_publica_max_24h mudada, o teto padrão (200) folga
  await mudarRegra(c.db, "respostas_publicas_max_24h", 200);
  await fila(c.db, conta, auto.id, 1, 300);
  const folga = metaFalsa();
  await executar(c, folga);
  assertEquals(folga.chamadas.map((x) => x.tipo), ["botao", "resposta"]);
});

teste("j. limite na resposta: resposta_ate preenchida, a DM continua marcada, e as DMs seguintes saem sem resposta", async (c) => {
  await mudarRegra(c.db, "envio_pausa_resposta_min", 25);
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { resposta: "Te mandei!" });
  const [a, b, d] = await fila(c.db, conta, auto.id, 3);
  const meta = metaFalsa((ch) => (ch.tipo === "resposta" ? LIMITE() : ok({ recipient_id: "1" })));

  const { resumo } = await executar(c, meta);

  // só a 1ª resposta chegou à Meta; as outras DMs saem sem tentar responder
  assertEquals(meta.chamadas.map((x) => `${x.tipo}:${x.commentId}`), [
    `botao:${a.commentId}`,
    `resposta:${a.commentId}`,
    `botao:${b.commentId}`,
    `botao:${d.commentId}`,
  ]);
  const p = await pausaDe(c.db, conta.contaId);
  assert(p !== null && perto(p.resposta_ate, Date.now() + 25 * MINUTO), "resposta_ate = agora + envio_pausa_resposta_min");
  assertEquals(p.direct_ate, null, "o direct não pausa");
  for (const com of [a, b, d]) {
    const l = await linha(c.db, com.commentId);
    assertNotEquals(l.dm_em, null, "a DM segue marcada");
    assertEquals([l.dm_erro, l.resposta_em, l.resposta_erro], [null, null, null]);
  }
  assertEquals([resumo.enviadas, resumo.respostas, resumo.pausadas], [3, 0, 0]);
});

teste("j. limite na resposta não apaga a pausa do direct, e o inverso também", async (c) => {
  const conta = await novaConta(c.db);
  await c.banco.pausarDirect(conta.contaId, new Date(Date.now() + 90 * MINUTO), "direct");
  await c.banco.pausarResposta(conta.contaId, new Date(Date.now() + 20 * MINUTO), "resposta");
  const p = await pausaDe(c.db, conta.contaId);
  assert(perto(p!.direct_ate, Date.now() + 90 * MINUTO) && perto(p!.resposta_ate, Date.now() + 20 * MINUTO));
  await c.banco.pausarDirect(conta.contaId, new Date(Date.now() + 180 * MINUTO), "direct de novo");
  const q = await pausaDe(c.db, conta.contaId);
  assert(perto(q!.direct_ate, Date.now() + 180 * MINUTO) && perto(q!.resposta_ate, Date.now() + 20 * MINUTO));
});

teste("j. erro comum na resposta vai para resposta_erro e não atrapalha a DM", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta, { resposta: "Te mandei!" });
  const [a, b] = await fila(c.db, conta, auto.id, 2);
  const meta = metaFalsa((ch) =>
    ch.tipo === "resposta"
      ? ch.commentId === a.commentId ? erroMeta(400, 100, "Comentário apagado") : ok({ id: "r" })
      : ok({ recipient_id: "1" })
  );

  await executar(c, meta);

  const la = await linha(c.db, a.commentId);
  assertNotEquals(la.dm_em, null);
  assertEquals([la.resposta_em, la.resposta_erro], [null, "(100) Comentário apagado"]);
  assertNotEquals((await linha(c.db, b.commentId)).resposta_em, null, "a resposta seguinte tenta normalmente");
  assertEquals(await pausaDe(c.db, conta.contaId), null);
});

// ================================================================ k. fora da janela

teste("k. comentário mais velho que fila_janela_dias não é enviado", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const velho = await novoComentario(c.db, conta, auto.id, { ha: 6 * DIA + MINUTO });
  const muitoVelho = await novoComentario(c.db, conta, auto.id, { ha: 30 * DIA });
  const dentro = await novoComentario(c.db, conta, auto.id, { ha: 5 * DIA + 23 * 60 * MINUTO });
  const meta = metaFalsa();

  await executar(c, meta);

  assertEquals(meta.chamadas.map((x) => x.commentId), [dentro.commentId]);
  for (const com of [velho, muitoVelho]) {
    const l = await linha(c.db, com.commentId);
    assertEquals([l.dm_em, l.dm_erro, l.dm_tentativas], [null, null, 0], "fica como estava");
  }
});

// ================================================================ l. o token

teste("l. token cifrado por lib/cripto.ts decifra na função (e o decifrado vai no Authorization)", async (c) => {
  const conta = await novaConta(c.db);
  const [com] = await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 1);
  const meta = metaFalsa();
  await executar(c, meta);
  assertEquals(meta.chamadas[0].token, conta.token);
  assertNotEquals((await linha(c.db, com.commentId)).dm_em, null);
});

Deno.test("l. decifrarToken: o formato v1.<iv>.<cifra+tag> do cifrar() de verdade, acentos incluídos", async () => {
  const chave = await importarChave(CHAVE_TOKENS);
  for (const claro of ["IGAAabc123", "token-com-ação-€-😀", "x".repeat(400)]) {
    const cifrado = cifrar(claro);
    assert(cifrado.startsWith("v1."));
    assertEquals(await decifrarToken(cifrado, chave), claro);
  }
});

Deno.test("l. decifrarToken recusa chave errada, dado adulterado e formato desconhecido", async () => {
  const cifrado = cifrar("segredo");
  const outra = await importarChave(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
  const chave = await importarChave(CHAVE_TOKENS);
  for (const [nome, chv, texto] of [
    ["chave errada", outra, cifrado],
    ["adulterado", chave, cifrado.slice(0, -4) + (cifrado.endsWith("AAAA") ? "BBBB" : "AAAA")],
    ["versão", chave, cifrado.replace("v1.", "v2.")],
    ["sem partes", chave, "v1.so-o-iv"],
  ] as [string, CryptoKey, string][]) {
    let erro: unknown = null;
    try {
      await decifrarToken(texto, chv);
    } catch (e) {
      erro = e;
    }
    assert(erro, nome);
  }
  let curta: unknown = null;
  try {
    await importarChave(btoa("curta"));
  } catch (e) {
    curta = e;
  }
  assert(curta instanceof Error && curta.message.includes("32 bytes"));
});

teste("l. sem token, token vencido ou ilegível: pula a conta, sem marcar erro em ninguém", async (c) => {
  const sem = await novaConta(c.db, { token: "sem" });
  const vencido = await novaConta(c.db, { token: "vencido" });
  const ilegivel = await novaConta(c.db, { token: "ilegivel" });
  const boa = await novaConta(c.db);
  for (const conta of [sem, vencido, ilegivel, boa]) await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 1);
  const meta = metaFalsa();

  const { r: { resumo }, erros } = await capturandoLog(() => executar(c, meta));

  assertEquals(meta.chamadas.length, 1, "só a conta com token bom envia");
  assertEquals(meta.chamadas[0].token, boa.token);
  assertEquals(resumo.puladas, 3);
  const r = await c.db.query<{ n: number }>(
    `select count(*)::int as n from public.comentarios where conta_id <> $1 and (dm_erro is not null or dm_tentativas <> 0 or dm_em is not null)`,
    [boa.contaId],
  );
  assertEquals(r.rows[0].n, 0, "nada marcado nas contas puladas");
  assertEquals(await pausaDe(c.db, sem.contaId), null);
  assertEquals(erros.length, 1, "o token ilegível avisa no log, sem o token");
  assert(String(erros[0][0]).includes(ilegivel.contaId));
});

// ================================================================ automação apagada / desligada

teste("automação apagada: dm_erro 'automação apagada', sem chamar a Meta, e a fila segue", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const apagada = await novoComentario(c.db, conta, auto.id, { ha: 50 * MINUTO });
  const seguinte = await novoComentario(c.db, conta, auto.id, { ha: 40 * MINUTO });
  await c.db.query(`delete from public.automacoes where id = $1`, [auto.id]); // on delete set null
  const outra = await novaAutomacao(c.db, conta);
  const viva = await novoComentario(c.db, conta, outra.id, { ha: 30 * MINUTO });
  const meta = metaFalsa();

  const { resumo } = await executar(c, meta);

  for (const com of [apagada, seguinte]) {
    const l = await linha(c.db, com.commentId);
    assertEquals([l.dm_erro, l.dm_em], ["automação apagada", null]);
  }
  assertEquals(meta.chamadas.map((x) => x.commentId), [viva.commentId]);
  assertEquals(resumo.erros, 2);
});

teste("automação desligada: não envia, o comentário fica na fila e não ocupa vaga; religou dentro da janela, sai", async (c) => {
  await mudarRegra(c.db, "envio_max_por_rodada", 2);
  const conta = await novaConta(c.db);
  const desligada = await novaAutomacao(c.db, conta, { ativa: false });
  const ligada = await novaAutomacao(c.db, conta);
  const paradas = [
    await novoComentario(c.db, conta, desligada.id, { ha: 60 * MINUTO }),
    await novoComentario(c.db, conta, desligada.id, { ha: 59 * MINUTO }),
    await novoComentario(c.db, conta, desligada.id, { ha: 58 * MINUTO }),
  ];
  const viva = await novoComentario(c.db, conta, ligada.id, { ha: 10 * MINUTO });
  const meta = metaFalsa();

  await executar(c, meta);

  assertEquals(meta.chamadas.map((x) => x.commentId), [viva.commentId], "as 3 mais antigas são da automação desligada e não travam a fila");
  for (const com of paradas) {
    const l = await linha(c.db, com.commentId);
    assertEquals([l.dm_em, l.dm_erro, l.dm_tentativas], [null, null, 0]);
  }

  await c.db.query(`update public.automacoes set ativa = true where id = $1`, [desligada.id]);
  const depois = metaFalsa();
  await executar(c, depois);
  assertEquals(depois.chamadas.map((x) => x.commentId), [paradas[0].commentId, paradas[1].commentId], "religou: sai na ordem de chegada, até o máximo");
});

teste("a rodada não confia no banco para a automação desligada: item desligado que chegue à lógica é ignorado", async (c) => {
  const conta = await novaConta(c.db);
  const auto = await novaAutomacao(c.db, conta);
  const [com] = await fila(c.db, conta, auto.id, 1);
  const banco: Banco = {
    ...c.banco,
    fila: async (...a) => (await c.banco.fila(...a)).map((i) => ({ ...i, automacao: i.automacao && { ...i.automacao, ativa: false } })),
  };
  const meta = metaFalsa();
  await executar({ banco }, meta);
  assertEquals(meta.chamadas.length, 0);
  assertEquals((await linha(c.db, com.commentId)).dm_tentativas, 0);
});

// ================================================================ orçamento de tempo

teste("passou do orçamento de tempo: para de começar envios novos e o resto fica na fila", async (c) => {
  await mudarRegra(c.db, "envio_intervalo_segundos", 60);
  const conta = await novaConta(c.db);
  const [um, dois, tres, quatro] = await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 4);
  let agora = Date.now();
  const meta = metaFalsa();

  const { resumo } = await executar(c, meta, {
    orcamentoMs: 100_000,
    agora: () => agora,
    esperar: (ms) => {
      agora += ms; // a espera "passa" no relógio de mentira
      return Promise.resolve();
    },
  });

  // t=0 manda a 1ª; espera 60 s (t=60 s < 100 s) e manda a 2ª; espera mais 60 s (t=120 s) e para
  assertEquals(meta.chamadas.map((x) => x.commentId), [um.commentId, dois.commentId]);
  assertEquals(resumo.orcamento, true);
  for (const com of [tres, quatro]) {
    const l = await linha(c.db, com.commentId);
    assertEquals([l.dm_em, l.dm_erro, l.dm_tentativas], [null, null, 0], "intacto, sem reserva");
  }
});

teste("sem estourar o orçamento, a rodada diz que não estourou", async (c) => {
  const conta = await novaConta(c.db);
  await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 2);
  const { resumo } = await executar(c, metaFalsa());
  assertEquals(resumo.orcamento, false);
});

teste("contas em paralelo, poucas por vez", async (c) => {
  const contas = [];
  for (let i = 0; i < 7; i++) {
    const conta = await novaConta(c.db);
    await fila(c.db, conta, (await novaAutomacao(c.db, conta)).id, 1);
    contas.push(conta);
  }
  let emVoo = 0;
  let pico = 0;
  const meta = metaFalsa(async () => {
    pico = Math.max(pico, ++emVoo);
    await new Promise((r) => setTimeout(r, 10));
    emVoo--;
    return ok({ recipient_id: "1" });
  });

  const { resumo } = await executar(c, meta, { contasEmParalelo: 3 });

  assertEquals(resumo.enviadas, 7);
  assertEquals(pico, 3, "no máximo 3 contas ao mesmo tempo, e as 3 de fato juntas");
});

// ================================================================ a Meta (peças)

Deno.test("ehLimite: os códigos e textos do robô do @maxwel_dev", () => {
  for (const code of [4, 17, 32, 613, 80002]) assert(ehLimite({ code, message: "x" }), String(code));
  for (
    const message of [
      "We limit how often you can post content",
      "Rate limit hit",
      "Too many calls",
      "Application Request Limit Reached",
      "temporarily blocked",
    ]
  ) assert(ehLimite({ message }), message);
  assert(ehLimite({ message: "x", status: 429 }));
  assert(!ehLimite({ code: 100, message: "Invalid parameter" }));
  assert(!ehLimite({ code: 551, message: "Person unavailable" }));
  assert(!ehLimite(null));
});

Deno.test("foiRecusa: só 4xx que não é limite justifica reenviar como texto", () => {
  assert(foiRecusa({ code: 100, message: "x", status: 400 }));
  assert(foiRecusa({ code: 10, message: "x", status: 403 }));
  assert(!foiRecusa({ code: 4, message: "x", status: 400 }), "limite");
  assert(!foiRecusa({ message: "x", status: 500 }));
  assert(!foiRecusa({ message: "x", status: 502 }));
  assert(!foiRecusa({ message: "timeout", rede: true }));
});

Deno.test("textoDoErro: curto, em uma linha, com o código", () => {
  assertEquals(textoDoErro({ code: 100, message: "a\n b   c" }), "(100) a b c");
  assertEquals(textoDoErro({ message: "y".repeat(400) }).length, 250);
  assertEquals(textoDoErro({ message: "" }), "erro sem mensagem");
});
