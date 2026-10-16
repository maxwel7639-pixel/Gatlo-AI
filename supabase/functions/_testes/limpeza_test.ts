import { assertEquals } from "@std/assert";
import { criarAutomacao, criarConta, criarPostgres, criarUsuario } from "./pg.ts";

// A limpeza do B3 (migration 0004): apaga SÓ o que passou do prazo.
// O Postgres é de verdade (PGlite, em memória) e aplica todas as migrations, então
// isto roda a mesma função que o pg_cron chama no Supabase, sem tocar em projeto
// nenhum e sem rede.

type Preparo = {
  db: Awaited<ReturnType<typeof criarPostgres>>;
  userId: string;
  contaId: string;
  automacaoId: string;
};

async function preparar(): Promise<Preparo> {
  const db = await criarPostgres();
  const userId = await criarUsuario(db);
  const contaId = await criarConta(db, { userId, igUserId: `ig-${crypto.randomUUID()}` });
  const automacaoId = await criarAutomacao(db, { userId, contaId, qualquerPost: true, palavras: ["eu quero"] });
  return { db, userId, contaId, automacaoId };
}

/** Comentário com `recebido_em` escolhido a dedo (é a data que a limpeza olha). */
async function comentarioEm(p: Preparo, commentId: string, diasAtras: number): Promise<void> {
  await p.db.query(
    `insert into public.comentarios
       (comment_id, user_id, conta_id, automacao_id, media_id, texto, recebido_em)
     values ($1, $2, $3, $4, 'm1', 'quero', now() - make_interval(days => $5::int))`,
    [commentId, p.userId, p.contaId, p.automacaoId, diasAtras],
  );
}

/** Clique com `clicado_em` a dedo e comentário opcional, também a dedo. */
async function cliqueEm(p: Preparo, diasAtras: number, comentarioId: string | null = null): Promise<void> {
  await p.db.query(
    `insert into public.cliques (automacao_id, user_id, comentario_id, visitante, clicado_em)
     values ($1, $2, $3, 'sal', now() - make_interval(days => $4::int))`,
    [p.automacaoId, p.userId, comentarioId, diasAtras],
  );
}

/** Janela da trava de taxa com `janela_inicio` a dedo. */
async function janelaDeTaxa(p: Preparo, chave: string, horasAtras: number): Promise<void> {
  await p.db.query(
    `insert into public.limite_taxa (chave, contador, janela_inicio)
     values ($1, 1, now() - make_interval(hours => $2::int))`,
    [chave, horasAtras],
  );
}

/** Roda a limpeza e devolve o que ela diz ter apagado. */
async function limpar(p: Preparo): Promise<{ comentarios: number; cliques: number; taxas: number }> {
  const r = await p.db.query<{ comentarios_apagados: number; cliques_apagados: number; taxas_apagadas: number }>(
    `select * from public.limpar_dados_antigos()`,
  );
  return {
    comentarios: r.rows[0].comentarios_apagados,
    cliques: r.rows[0].cliques_apagados,
    taxas: r.rows[0].taxas_apagadas,
  };
}

async function contar(p: Preparo, sql: string): Promise<number> {
  const r = await p.db.query<{ n: number }>(`select count(*)::int as n ${sql}`);
  return r.rows[0].n;
}

Deno.test("limpeza: apaga o que tem mais de 90 dias e guarda o resto", async () => {
  const p = await preparar();
  await comentarioEm(p, "velho", 91);
  await comentarioEm(p, "recente", 89);
  await cliqueEm(p, 91);
  await cliqueEm(p, 89);
  await janelaDeTaxa(p, "velha", 48);
  await janelaDeTaxa(p, "recente", 1);

  assertEquals(await limpar(p), { comentarios: 1, cliques: 1, taxas: 1 });

  assertEquals(await contar(p, "from public.comentarios"), 1);
  assertEquals(await contar(p, `from public.comentarios where comment_id = 'recente'`), 1);
  assertEquals(await contar(p, "from public.cliques"), 1);
  assertEquals(await contar(p, "from public.limite_taxa"), 1);
  assertEquals(await contar(p, `from public.limite_taxa where chave = 'recente'`), 1);
});

Deno.test("limpeza: rodar de novo sem nada velho não apaga nada", async () => {
  const p = await preparar();
  await comentarioEm(p, "recente", 10);
  await cliqueEm(p, 10);

  assertEquals(await limpar(p), { comentarios: 0, cliques: 0, taxas: 0 });
  assertEquals(await contar(p, "from public.comentarios"), 1);
  assertEquals(await contar(p, "from public.cliques"), 1);
});

Deno.test("limpeza: o prazo vem da tabela regras (60 dias aqui) e não do código", async () => {
  const p = await preparar();
  await p.db.query(`update public.regras set valor = 60 where chave = 'limpeza_dias'`);
  await comentarioEm(p, "velho", 61);
  await comentarioEm(p, "recente", 59);
  await cliqueEm(p, 61);
  await cliqueEm(p, 59);

  assertEquals(await limpar(p), { comentarios: 1, cliques: 1, taxas: 0 });
  assertEquals(await contar(p, `from public.comentarios where comment_id = 'recente'`), 1);
  assertEquals(await contar(p, "from public.cliques"), 1);
});

Deno.test("limpeza: o clique cai pela própria data, não por arrasto do comentário", async () => {
  // Comentário velho (o vínculo cai, cliques.comentario_id é "on delete set null"),
  // mas o clique é recente: ele tem que SOBREVIVER.
  const p = await preparar();
  await comentarioEm(p, "velho", 91);
  const r = await p.db.query<{ id: string }>(`select id from public.comentarios where comment_id = 'velho'`);
  await cliqueEm(p, 10, r.rows[0].id);

  assertEquals(await limpar(p), { comentarios: 1, cliques: 0, taxas: 0 });
  assertEquals(await contar(p, "from public.cliques"), 1);
  assertEquals(
    await contar(p, "from public.cliques where comentario_id is null"),
    1,
    "o clique perdeu o vínculo, mas não foi apagado",
  );
});

Deno.test("limpeza: a janela da trava de taxa segue a regra de 24 h", async () => {
  const p = await preparar();
  await janelaDeTaxa(p, "velha", 25);
  await janelaDeTaxa(p, "recente", 23);

  assertEquals(await limpar(p), { comentarios: 0, cliques: 0, taxas: 1 });
  assertEquals(await contar(p, `from public.limite_taxa where chave = 'recente'`), 1);
});

Deno.test("limpeza: ninguém apaga pela API (anon, authenticated e service_role não executam)", async () => {
  const p = await preparar();
  const r = await p.db.query<{ anon: boolean; logado: boolean; servidor: boolean }>(
    `select has_function_privilege('anon', 'public.limpar_dados_antigos()', 'execute')          as anon,
            has_function_privilege('authenticated', 'public.limpar_dados_antigos()', 'execute')  as logado,
            has_function_privilege('service_role', 'public.limpar_dados_antigos()', 'execute')   as servidor`,
  );
  assertEquals(r.rows[0], { anon: false, logado: false, servidor: false });
});
