import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { PGlite } from "@electric-sql/pglite";
import {
  bancoSobrePg,
  contarComentarios,
  criarAutomacao,
  criarConta,
  criarPostgres,
  criarUsuario,
  linhasDeComentarios,
} from "../_testes/pg.ts";
import { criarManipulador } from "./manipulador.ts";
import { assinaturaConfere, iguaisEmTempoConstante } from "./seguranca.ts";

// Segredos FALSOS, sorteados a cada execução. Nada aqui é credencial de verdade
// e nenhuma chamada sai pra rede: o script teste:funcoes roda sem --allow-net.
const SEGREDO_APP = `falso-${crypto.randomUUID()}`;
const TOKEN_VERIFICACAO = `falso-${crypto.randomUUID()}`;
const URL_FUNCAO = "http://localhost:54321/functions/v1/gatilho-webhook";

const IG_CONTA = "17841400000000001"; // entry.id = contas_instagram.ig_user_id
const MEDIA_A = "17887498072083520";
const MEDIA_B = "17887498072089999";

// ---------------------------------------------------------------- ajudantes

async function assinar(corpo: string, segredo = SEGREDO_APP): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)));
  return "sha256=" + Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** O corpo no formato oficial do webhook de comentários do Instagram (field = "comments"). */
function corpoDaMeta(o: {
  entryId?: string;
  commentId?: string;
  mediaId?: string;
  fromId?: string;
  texto?: string;
  parentId?: string;
  time?: number;
}): string {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: o.entryId ?? IG_CONTA,
        time: o.time ?? 1_760_000_000,
        changes: [
          {
            field: "comments",
            value: {
              from: { id: o.fromId ?? "17841499999999999", username: "maria.silva" },
              media: { id: o.mediaId ?? MEDIA_A, media_product_type: "FEED" },
              id: o.commentId ?? "17865799348089039",
              text: o.texto ?? "quero",
              ...(o.parentId ? { parent_id: o.parentId } : {}),
            },
          },
        ],
      },
    ],
  });
}

async function postar(
  manipular: (r: Request) => Promise<Response>,
  corpo: string,
  assinatura: string | null | "valida" = "valida",
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig = assinatura === "valida" ? await assinar(corpo) : assinatura;
  if (sig !== null) headers["X-Hub-Signature-256"] = sig;
  return await manipular(new Request(URL_FUNCAO, { method: "POST", headers, body: corpo }));
}

type Cenario = Awaited<ReturnType<typeof montar>>;

// Subir o Postgres (initdb + a migration inteira) leva uns 15 s: sobe UMA vez e,
// entre um teste e outro, apaga os usuários (as chaves estrangeiras levam junto
// contas, automações e comentários).
let postgres: Promise<PGlite> | null = null;

/** Banco limpo + uma conta conectada (a pessoa que comenta é outra; a conta é dona das automações). */
async function montar() {
  const db = await (postgres ??= criarPostgres());
  await db.exec("delete from auth.users");
  const userId = await criarUsuario(db);
  const contaId = await criarConta(db, { userId, igUserId: IG_CONTA });
  const { banco, consultas } = bancoSobrePg(db);
  let bancosPedidos = 0;
  const env: Record<string, string> = {
    INSTAGRAM_APP_SECRET: SEGREDO_APP,
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: TOKEN_VERIFICACAO,
  };
  const manipular = criarManipulador({
    env: (nome) => env[nome],
    banco: () => {
      bancosPedidos++;
      return banco;
    },
  });
  return { db, userId, contaId, consultas, manipular, env, bancosPedidos: () => bancosPedidos };
}

function teste(nome: string, corpo: (c: Cenario) => Promise<void>) {
  Deno.test(nome, async () => {
    await corpo(await montar());
  });
}

// ---------------------------------------------------------------- a, b: assinatura

teste("a. assinatura errada: 401, comentarios continua com 0 linhas e nenhuma consulta é feita", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, mediaId: MEDIA_A, palavras: ["quero"] });
  const corpo = corpoDaMeta({ texto: "quero" });

  const errada = await assinar(corpo, "outro-segredo-falso");
  const r1 = await postar(c.manipular, corpo, errada);
  assertEquals(r1.status, 401);

  // assinatura certa de OUTRO corpo (alguém mexeu no corpo no caminho)
  const r2 = await postar(c.manipular, corpo, await assinar(corpoDaMeta({ texto: "outra coisa" })));
  assertEquals(r2.status, 401);

  // lixo no cabeçalho
  assertEquals((await postar(c.manipular, corpo, "sha256=zzzz")).status, 401);
  assertEquals((await postar(c.manipular, corpo, "sha256=")).status, 401);
  assertEquals((await postar(c.manipular, corpo, (await assinar(corpo)).slice("sha256=".length))).status, 401);

  assertEquals(await contarComentarios(c.db), 0);
  assertEquals(c.consultas.n, 0, "nenhuma consulta ao banco antes de a assinatura conferir");
  assertEquals(c.bancosPedidos(), 0, "nem o cliente do banco é criado");
});

teste("b. assinatura ausente: 401", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, mediaId: MEDIA_A, palavras: ["quero"] });
  const r = await postar(c.manipular, corpoDaMeta({}), null);
  assertEquals(r.status, 401);
  assertEquals(await contarComentarios(c.db), 0);
  assertEquals(c.consultas.n, 0);
});

teste("sem INSTAGRAM_APP_SECRET configurado a função recusa tudo (nunca aceita sem conferir)", async (c) => {
  delete c.env.INSTAGRAM_APP_SECRET;
  const corpo = corpoDaMeta({});
  const r = await postar(c.manipular, corpo, await assinar(corpo)); // até com a assinatura certa
  assertEquals(r.status, 503);
  assertEquals(c.consultas.n, 0);
});

Deno.test("HMAC confere com um vetor externo (segredo e corpo falsos, valor calculado fora daqui)", async () => {
  // node -e 'crypto.createHmac("sha256","segredo-falso").update("{\"a\":1}").digest("hex")'
  const esperado = "sha256=1edd08a557cb3d3c35938fcee071c8fd97310cc64829ce54a5f57f0042bda352";
  const calculada = await assinar('{"a":1}', "segredo-falso");
  assertEquals(calculada, esperado);
  assert(await assinaturaConfere("segredo-falso", new TextEncoder().encode('{"a":1}'), esperado));
  assert(await assinaturaConfere("segredo-falso", new TextEncoder().encode('{"a":1}'), esperado.toUpperCase().replace("SHA256=", "sha256=")));
  assert(!(await assinaturaConfere("segredo-falso", new TextEncoder().encode('{"a":2}'), esperado)));
});

Deno.test("iguaisEmTempoConstante", () => {
  assert(iguaisEmTempoConstante("abc", "abc"));
  assert(!iguaisEmTempoConstante("abc", "abd"));
  assert(!iguaisEmTempoConstante("abc", "abcd"));
  assert(!iguaisEmTempoConstante("", "a"));
  assert(iguaisEmTempoConstante("", ""));
});

// ---------------------------------------------------------------- c, d: o caminho feliz

teste("c. corpo da Meta: exatamente 1 linha em comentarios, com automacao_id e palavra certos", async (c) => {
  const automacaoId = await criarAutomacao(c.db, {
    userId: c.userId,
    contaId: c.contaId,
    mediaId: MEDIA_A,
    palavras: ["preço", "quero"],
  });
  const r = await postar(c.manipular, corpoDaMeta({ commentId: "C-1", texto: "Eu quero!" }));
  assertEquals(r.status, 200);

  const linhas = await linhasDeComentarios(c.db);
  assertEquals(linhas.length, 1);
  const l = linhas[0];
  assertEquals(l.automacao_id, automacaoId);
  assertEquals(l.palavra, "quero");
  assertEquals(l.comment_id, "C-1");
  assertEquals(l.user_id, c.userId);
  assertEquals(l.conta_id, c.contaId);
  assertEquals(l.media_id, MEDIA_A);
  assertEquals(l.autor_ig_id, "17841499999999999");
  assertEquals(l.autor_username, "maria.silva");
  assertEquals(l.texto, "Eu quero!");
  // a Meta não data o comentário: vale o entry.time (em segundos)
  assertEquals(l.comentado_em.toISOString(), new Date(1_760_000_000 * 1000).toISOString());
});

teste("d. o mesmo corpo de novo: continua 1 linha (a Meta reenvia e o comment_id é único)", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, mediaId: MEDIA_A, palavras: ["quero"] });
  const corpo = corpoDaMeta({ commentId: "C-2", texto: "quero" });
  assertEquals((await postar(c.manipular, corpo)).status, 200);
  assertEquals((await postar(c.manipular, corpo)).status, 200);
  assertEquals((await postar(c.manipular, corpo)).status, 200);
  assertEquals(await contarComentarios(c.db), 1);
});

teste("responde 200 na hora e só processa depois (EdgeRuntime.waitUntil)", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, mediaId: MEDIA_A, palavras: ["quero"] });
  let pendente: Promise<unknown> | null = null;
  const manipular = criarManipulador({
    env: (n) => c.env[n],
    banco: () => bancoSobrePg(c.db).banco,
    agendar: (tarefa) => {
      pendente = tarefa;
    },
  });
  const r = await postar(manipular, corpoDaMeta({ commentId: "C-3" }));
  assertEquals(r.status, 200);
  assertNotEquals(pendente, null, "o processamento foi entregue ao agendador");
  await pendente;
  assertEquals(await contarComentarios(c.db), 1);
});

// ---------------------------------------------------------------- e: o que nunca dispara

teste("e. comentário da própria conta: 0. Resposta a comentário (parent_id): 0", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"] });

  // a conta comentou no próprio post (from.id == entry.id)
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "P-1", fromId: IG_CONTA }))).status, 200);
  assertEquals(await contarComentarios(c.db), 0);

  // resposta a outro comentário
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "R-1", parentId: "C-pai" }))).status, 200);
  assertEquals(await contarComentarios(c.db), 0);

  // controle: o mesmo comentário, sem as duas condições, entra
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "N-1" }))).status, 200);
  assertEquals(await contarComentarios(c.db), 1);
});

teste("campo que não é comments, conta desconhecida e comentário sem palavra: 0", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"] });

  const outroCampo = JSON.parse(corpoDaMeta({ commentId: "X-1" }));
  outroCampo.entry[0].changes[0].field = "mentions";
  assertEquals((await postar(c.manipular, JSON.stringify(outroCampo))).status, 200);

  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "X-2", entryId: "999" }))).status, 200);
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "X-3", texto: "lindo demais!" }))).status, 200);
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "X-4", texto: "linkedin" }))).status, 200);
  assertEquals(await contarComentarios(c.db), 0);
});

// ---------------------------------------------------------------- f: a palavra

teste("f. \"QUÉRO o link\" bate com a palavra \"quero\"", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, mediaId: MEDIA_A, palavras: ["quero"] });
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "F-1", texto: "QUÉRO o link" }))).status, 200);
  const linhas = await linhasDeComentarios(c.db);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].palavra, "quero");
  assertEquals(linhas[0].texto, "QUÉRO o link"); // guarda o que a pessoa escreveu
});

// ---------------------------------------------------------------- g: o GET da Meta

teste("g. GET com verify_token certo devolve o challenge; errado, 403", async (c) => {
  const url = (p: Record<string, string>) => `${URL_FUNCAO}?${new URLSearchParams(p)}`;
  const certo = { "hub.mode": "subscribe", "hub.verify_token": TOKEN_VERIFICACAO, "hub.challenge": "1158201444" };

  const ok = await c.manipular(new Request(url(certo)));
  assertEquals(ok.status, 200);
  assertEquals(await ok.text(), "1158201444");

  const errado = await c.manipular(new Request(url({ ...certo, "hub.verify_token": "token-errado" })));
  assertEquals(errado.status, 403);
  await errado.body?.cancel();
  const semToken = await c.manipular(new Request(url({ "hub.mode": "subscribe", "hub.challenge": "1" })));
  assertEquals(semToken.status, 403);
  await semToken.body?.cancel();
  const modo = await c.manipular(new Request(url({ ...certo, "hub.mode": "unsubscribe" })));
  assertEquals(modo.status, 403);
  await modo.body?.cancel();

  delete c.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN; // sem a variável não vale token vazio
  const semVariavel = await c.manipular(new Request(url({ ...certo, "hub.verify_token": "" })));
  assertEquals(semVariavel.status, 503);
  await semVariavel.body?.cancel();
  assertEquals(c.consultas.n, 0);
});

teste("outros métodos: 405", async (c) => {
  const r = await c.manipular(new Request(URL_FUNCAO, { method: "DELETE" }));
  assertEquals(r.status, 405);
  await r.body?.cancel();
});

// ---------------------------------------------------------------- h: quem entra e quem vence

teste("h. conta de demonstração ou desconectada: 0", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"] });

  await c.db.query(`update public.contas_instagram set demonstracao = true where id = $1`, [c.contaId]);
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "H-1" }))).status, 200);
  assertEquals(await contarComentarios(c.db), 0);

  for (const status of ["desconectada", "expirada"]) {
    await c.db.query(`update public.contas_instagram set demonstracao = false, status = $2 where id = $1`, [c.contaId, status]);
    assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: `H-${status}` }))).status, 200);
    assertEquals(await contarComentarios(c.db), 0, `status ${status}`);
  }

  // controle: voltando a conectada, o mesmo comentário entra
  await c.db.query(`update public.contas_instagram set status = 'conectada' where id = $1`, [c.contaId]);
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "H-ok" }))).status, 200);
  assertEquals(await contarComentarios(c.db), 1);
});

teste("h. automação desligada: 0", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, mediaId: MEDIA_A, palavras: ["quero"], ativa: false });
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"], ativa: false });
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "H-2" }))).status, 200);
  assertEquals(await contarComentarios(c.db), 0);
});

teste("h. automação do post vence a de qualquer post (mesmo a de qualquer post sendo mais antiga)", async (c) => {
  // criada ANTES: se a ordem de criação mandasse, ela venceria
  const qualquer = await criarAutomacao(c.db, {
    userId: c.userId, contaId: c.contaId, nome: "qualquer", qualquerPost: true, palavras: ["quero"],
  });
  const doPost = await criarAutomacao(c.db, {
    userId: c.userId, contaId: c.contaId, nome: "do post", mediaId: MEDIA_A, palavras: ["quero"],
  });

  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "V-1", mediaId: MEDIA_A }))).status, 200);
  // em outro post, só a de qualquer post vale
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "V-2", mediaId: MEDIA_B }))).status, 200);

  const linhas = await linhasDeComentarios(c.db);
  const porId = Object.fromEntries(linhas.map((l) => [l.comment_id, l.automacao_id]));
  assertEquals(porId["V-1"], doPost);
  assertEquals(porId["V-2"], qualquer);
  assertEquals(linhas.length, 2);
});

teste("h. se a palavra não bate na automação do post, a de qualquer post ainda pode pegar", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, mediaId: MEDIA_A, palavras: ["preço"] });
  const qualquer = await criarAutomacao(c.db, {
    userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"],
  });
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "V-3", texto: "quero" }))).status, 200);
  const linhas = await linhasDeComentarios(c.db);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].automacao_id, qualquer);
});

teste("automação de OUTRA conta nunca pega o comentário", async (c) => {
  const outroUsuario = await criarUsuario(c.db);
  const outraConta = await criarConta(c.db, { userId: outroUsuario, igUserId: "17841400000000002" });
  await criarAutomacao(c.db, { userId: outroUsuario, contaId: outraConta, qualquerPost: true, palavras: ["quero"] });
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "O-1" }))).status, 200);
  assertEquals(await contarComentarios(c.db), 0);

  // e o comentário na conta certa vai pra automação da conta certa
  const minha = await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"] });
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "O-2" }))).status, 200);
  const linhas = await linhasDeComentarios(c.db);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].automacao_id, minha);
  assertEquals(linhas[0].user_id, c.userId);
});

// ---------------------------------------------------------------- robustez

teste("JSON inválido com assinatura certa: 400, sem tocar no banco", async (c) => {
  const r = await postar(c.manipular, "{não é json");
  assertEquals(r.status, 400);
  assertEquals(c.consultas.n, 0);
});

teste("uma entrega com vários comentários: um com defeito não derruba os outros", async (c) => {
  const auto = await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"] });
  const um = (id: string, extra: object = {}) => ({
    field: "comments",
    value: { from: { id: "1", username: "ana" }, media: { id: MEDIA_A }, id, text: "quero", ...extra },
  });
  const corpo = JSON.stringify({
    object: "instagram",
    entry: [
      { id: IG_CONTA, time: 1_760_000_000, changes: [um("M-1"), { field: "comments", value: null }, um("M-sem-midia", { media: null }), um("M-2")] },
      { id: IG_CONTA, time: 1_760_000_001, changes: [um("M-3")] },
    ],
  });
  assertEquals((await postar(c.manipular, corpo)).status, 200);
  const linhas = await linhasDeComentarios(c.db);
  assertEquals(linhas.map((l) => l.comment_id).sort(), ["M-1", "M-2", "M-3"]);
  assert(linhas.every((l) => l.automacao_id === auto));
  assertEquals(c.consultas.n, 1 + 1 + 3, "conta e automações consultadas uma vez só + 3 gravações");
});

teste("falha do banco num comentário: registra e segue, a resposta continua 200", async (c) => {
  const falho = { ...bancoSobrePg(c.db).banco };
  falho.acharContaConectada = () => Promise.reject(new Error("banco fora do ar"));
  const manipular = criarManipulador({ env: (n) => c.env[n], banco: () => falho });
  const erros: unknown[][] = [];
  const original = console.error;
  console.error = (...a) => void erros.push(a);
  try {
    const r = await postar(manipular, corpoDaMeta({ commentId: "E-1" }));
    assertEquals(r.status, 200);
  } finally {
    console.error = original;
  }
  assertEquals(erros.length, 1);
  assert(String(erros[0][0]).includes("E-1") && !JSON.stringify(erros).includes("quero"), "loga o id, não o texto");
});

teste("texto acima de 2200 caracteres é cortado (limite da coluna) em vez de perder o comentário", async (c) => {
  await criarAutomacao(c.db, { userId: c.userId, contaId: c.contaId, qualquerPost: true, palavras: ["quero"] });
  const longo = "quero " + "😀".repeat(3000);
  assertEquals((await postar(c.manipular, corpoDaMeta({ commentId: "L-1", texto: longo }))).status, 200);
  const linhas = await linhasDeComentarios(c.db);
  assertEquals(linhas.length, 1);
  assertEquals([...linhas[0].texto].length, 2200);
});

// o último a rodar (os testes de um arquivo rodam na ordem em que foram escritos)
Deno.test("fecha o Postgres de teste", async () => {
  await (await postgres)?.close();
});
