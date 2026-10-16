import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { criarPostgres } from "./pg.ts";

// O agendador (B3) NÃO é uma migration: ele só existe no projeto de verdade, com
// pg_cron, pg_net e o Vault ligados. Então aqui ele é provado de duas formas:
//   1. lendo o arquivo do repositório: a chave e o endereço NÃO estão escritos;
//   2. rodando o arquivo de verdade, com pg_cron, pg_net e Vault FALSOS (só o
//      suficiente para ele executar): agenda sem erro, roda de novo sem duplicar
//      e grita quando falta extensão ou segredo.
//
// O arquivo é lido do repositório (--allow-read); nenhuma rede, nenhum projeto.

const caminho = new URL("../../agendador.sql", import.meta.url);
const sql = await Deno.readTextFile(caminho);

/** Todos os literais entre aspas simples do arquivo. */
function literais(texto: string): string[] {
  return [...texto.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

// ------------------------------------------------------------------ falsos do Supabase
// O mínimo de cron/net/vault para o arquivo rodar num Postgres de verdade (PGlite).
// Não executa os trabalhos (o pg_cron é que faria isso): guarda o comando agendado.
const FALSOS = `
  create schema cron;
  create table cron.job (
    jobid bigint primary key, jobname text, schedule text, command text, active boolean default true
  );
  create sequence cron.job_seq;
  create function cron.schedule(p_jobname text, p_schedule text, p_command text)
  returns bigint language plpgsql as $$
  declare v_id bigint;
  begin
    v_id := nextval('cron.job_seq');
    insert into cron.job (jobid, jobname, schedule, command) values (v_id, p_jobname, p_schedule, p_command);
    return v_id;
  end $$;
  create function cron.unschedule(p_jobid bigint) returns boolean language plpgsql as $$
  begin
    delete from cron.job where jobid = p_jobid;
    return found;
  end $$;

  create schema net;
  create function net.http_post(
    url text, body jsonb default '{}', params jsonb default '{}',
    headers jsonb default '{}', timeout_milliseconds int default 5000
  ) returns bigint language sql as $$ select 1::bigint $$;

  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
`;

type Db = Awaited<ReturnType<typeof criarPostgres>>;

/** Um Postgres só, com os falsos, reaproveitado entre os testes. */
let bancoPromessa: Promise<Db> | null = null;
function banco_(): Promise<Db> {
  bancoPromessa ??= (async () => {
    const db = await criarPostgres();
    await db.exec(FALSOS);
    return db;
  })();
  return bancoPromessa;
}

/** Zera o estado e recria os dois segredos do Vault (valores falsos). */
async function zerar(db: Db, comSegredos = true): Promise<void> {
  await db.exec(`delete from cron.job; delete from vault.decrypted_secrets;`);
  if (comSegredos) {
    await db.exec(
      `insert into vault.decrypted_secrets (name, decrypted_secret) values
         ('gatilho_envia_url', 'endereco-falso'),
         ('gatilho_cron_chave', 'chave-falsa');`,
    );
  }
}

type Trabalho = { jobname: string; schedule: string; command: string };
async function trabalhos(db: Db): Promise<Trabalho[]> {
  const r = await db.query<Trabalho>(`select jobname, schedule, command from cron.job order by jobname`);
  return r.rows;
}


Deno.test("agendador: cria os dois trabalhos, o do envio (3 min) e o da limpeza (diário)", () => {
  // dois cron.schedule: um para o envio, um para a limpeza
  assert(sql.includes("cron.schedule"), "falta o cron.schedule");
  assert(sql.includes("'gatilho-envia-3min'"), "falta o trabalho do envio");
  assert(sql.includes("'gatilho-limpeza-diaria'"), "falta o trabalho da limpeza");
  assert(sql.includes("'*/3 * * * *'"), "o envio tem que rodar de 3 em 3 minutos");
  assert(sql.includes("'0 4 * * *'"), "a limpeza tem que rodar uma vez por dia");

  // o envio é um POST em net.http_post; a limpeza chama a função do 0004
  assert(sql.includes("net.http_post"), "falta o net.http_post");
  assert(sql.includes("public.limpar_dados_antigos()"), "falta a chamada da limpeza");

  // duas checagens que gritam: se faltar extensão e se faltar segredo no Vault
  // (sem os segredos, o trabalho mandaria chave nula e tomaria 401 calado para sempre)
  assertEquals((sql.match(/raise exception/g) ?? []).length, 2, "faltam as checagens de extensão/segredo");
});

Deno.test("agendador: o endereço e a chave vêm do Vault, nunca escritos no arquivo", () => {
  // os dois nomes de segredo do Vault são lidos na hora
  assert(sql.includes("vault.decrypted_secrets"), "os segredos têm que sair do Vault");
  assert(sql.includes("'gatilho_envia_url'"), "falta o nome do segredo do endereço");
  assert(sql.includes("'gatilho_cron_chave'"), "falta o nome do segredo da chave");

  // o valor do cabeçalho x-cron-chave é um select no Vault, nunca um literal
  assert(
    /'x-cron-chave'\s*,\s*\(\s*select/.test(sql),
    "o x-cron-chave tem que ser lido do Vault",
  );
  assertFalse(
    /'x-cron-chave'\s*,\s*'/.test(sql),
    "a chave do cron foi escrita no arquivo (tem que vir do Vault)",
  );

  // o endereço também é um select no Vault, nunca um literal
  assert(/url\s*:=\s*\(\s*select/.test(sql), "o endereço tem que ser lido do Vault");
  assertFalse(/url\s*:=\s*'/.test(sql), "o endereço da função foi escrito no arquivo");

  // nada de endereço cravado no arquivo
  assertFalse(sql.includes("http://"), "endereço http:// escrito no agendador");
  assertFalse(sql.includes("https://"), "endereço https:// escrito no agendador");
});

Deno.test("agendador: nenhum literal comprido e sem espaço (cara de chave ou de endereço)", () => {
  // uma chave (base64/base64url de 32 bytes) tem 43+ caracteres e não tem espaço;
  // um endereço também. Os unicos literais longos do arquivo podem ser frases
  // (com espaço) — nunca um valor colado.
  const suspeitos = literais(sql).filter((l) => /^\S{32,}$/.test(l));
  assert(
    suspeitos.length === 0,
    `literais com cara de segredo no agendador: ${suspeitos.join(" | ")}`,
  );
});

Deno.test("agendador: o arquivo roda (pg_cron, pg_net e Vault falsos) e agenda os dois trabalhos", async () => {
  const db = await banco_();
  await zerar(db);

  await db.exec(sql); // o arquivo do repositório, inteiro

  const jobs = await trabalhos(db);
  assertEquals(jobs.map((j) => j.jobname), ["gatilho-envia-3min", "gatilho-limpeza-diaria"]);
  assertEquals(jobs.find((j) => j.jobname === "gatilho-envia-3min")?.schedule, "*/3 * * * *");
  assertEquals(jobs.find((j) => j.jobname === "gatilho-limpeza-diaria")?.schedule, "0 4 * * *");

  // o comando do envio guarda o NOME do segredo e o do Vault, nunca o valor
  const envia = jobs.find((j) => j.jobname === "gatilho-envia-3min")!.command;
  assert(envia.includes("net.http_post"), "o envio tem que ser um net.http_post");
  assert(envia.includes("decrypted_secret"), "o envio tem que ler o Vault");
  assert(envia.includes("gatilho_cron_chave"), "o envio tem que ler a chave do Vault");
  assertFalse(envia.includes("chave-falsa"), "a chave ficou gravada no trabalho agendado");
  assertFalse(envia.includes("endereco-falso"), "o endereço ficou gravado no trabalho agendado");

  // o comando da limpeza chama a função do 0004
  assert(jobs.find((j) => j.jobname === "gatilho-limpeza-diaria")!.command.includes("limpar_dados_antigos"));
});

Deno.test("agendador: rodar o arquivo de novo não duplica trabalho", async () => {
  const db = await banco_();
  await zerar(db);

  await db.exec(sql);
  await db.exec(sql); // segunda vez: o unschedule por nome derruba o antigo

  assertEquals((await trabalhos(db)).length, 2);
});

Deno.test("agendador: sem pg_cron, pg_net ou Vault, o arquivo falha com aviso claro", async () => {
  const db = await criarPostgres(); // sem os falsos: nenhuma extensão ligada
  await assertRejects(() => db.exec(sql), Error, "Habilite pg_cron, pg_net e o Vault");
});

Deno.test("agendador: com as extensões mas sem os segredos, o arquivo diz qual falta", async () => {
  const db = await banco_();
  await zerar(db, false); // extensões sim, segredos não

  await assertRejects(() => db.exec(sql), Error, "gatilho_envia_url");
  assertEquals((await trabalhos(db)).length, 0, "nada foi agendado");
});

