import { PGlite } from "@electric-sql/pglite";
import type { AutomacaoAtiva, Banco, ContaAlvo, NovoComentario } from "../gatilho-webhook/processar.ts";

/**
 * Postgres de verdade (PGlite, em memória) para os testes das Edge Functions.
 * Cria antes o mínimo que o Supabase já tem (schema auth, papéis, privilégios) e
 * aplica supabase/migrations/0001_esquema.sql INTEIRA. Nada de rede, nada de
 * projeto Supabase: some junto com o processo.
 */

const MINIMO_DO_SUPABASE = `
  create schema auth;
  create table auth.users (
    id                uuid primary key default gen_random_uuid(),
    email             text,
    raw_user_meta_data jsonb,
    created_at        timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  -- como no Supabase: a service role recebe tudo que o postgres criar no public
  alter default privileges for role postgres in schema public grant all on tables to service_role;
  alter default privileges for role postgres in schema public grant all on sequences to service_role;
`;

export async function criarPostgres(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(MINIMO_DO_SUPABASE);
  const migration = await Deno.readTextFile(new URL("../../migrations/0001_esquema.sql", import.meta.url));
  await db.exec(migration);
  return db;
}

// ---------------------------------------------------------------- dados de teste

export async function criarUsuario(db: PGlite): Promise<string> {
  // o gatilho do banco cria perfil + assinatura de teste junto
  const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [
    `teste-${crypto.randomUUID()}@exemplo.invalid`,
  ]);
  return r.rows[0].id;
}

export async function criarConta(
  db: PGlite,
  o: { userId: string; igUserId: string; status?: string; demonstracao?: boolean },
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.contas_instagram (user_id, ig_user_id, username, status, demonstracao)
     values ($1, $2, $3, $4, $5) returning id`,
    [o.userId, o.igUserId, `conta_${o.igUserId}`, o.status ?? "conectada", o.demonstracao ?? false],
  );
  return r.rows[0].id;
}

export async function criarAutomacao(
  db: PGlite,
  o: {
    userId: string;
    contaId: string;
    nome?: string;
    mediaId?: string | null;
    qualquerPost?: boolean;
    palavras: string[];
    ativa?: boolean;
  },
): Promise<string> {
  const qualquer = o.qualquerPost ?? false;
  const r = await db.query<{ id: string }>(
    `insert into public.automacoes
       (user_id, conta_id, nome, qualquer_post, media_id, palavras, mensagem_dm, link_url, link_titulo, ativa)
     values ($1, $2, $3, $4, $5, $6, 'Aqui está o link!', 'https://exemplo.invalid/oferta', 'Abrir', $7)
     returning id`,
    [o.userId, o.contaId, o.nome ?? "teste", qualquer, qualquer ? null : (o.mediaId ?? null), o.palavras, o.ativa ?? true],
  );
  return r.rows[0].id;
}

export async function linhasDeComentarios(db: PGlite) {
  const r = await db.query<{
    comment_id: string;
    user_id: string;
    conta_id: string;
    automacao_id: string;
    media_id: string;
    autor_ig_id: string | null;
    autor_username: string | null;
    texto: string;
    palavra: string;
    comentado_em: Date;
  }>(`select * from public.comentarios order by recebido_em, comment_id`);
  return r.rows;
}

export async function contarComentarios(db: PGlite): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from public.comentarios`);
  return r.rows[0].n;
}

// ---------------------------------------------------------------- o Banco, sobre o Postgres

/**
 * A interface Banco do webhook respondida pelo PGlite. Cada chamada roda como
 * `service_role` (o papel da chave de serviço): se a função precisasse de uma
 * permissão que a service role não tem, o teste quebraria aqui.
 * `consultas.n` conta as chamadas, para provar "nenhuma consulta feita".
 */
export function bancoSobrePg(db: PGlite): { banco: Banco; consultas: { n: number } } {
  const consultas = { n: 0 };

  async function comoServico<T>(f: (q: PGlite) => Promise<T>): Promise<T> {
    consultas.n++;
    return await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return await f(tx as unknown as PGlite);
    });
  }

  const banco: Banco = {
    acharContaConectada: (igUserId) =>
      comoServico(async (q) => {
        const r = await q.query<ContaAlvo>(
          `select id, user_id from public.contas_instagram
           where ig_user_id = $1 and status = 'conectada' and demonstracao = false`,
          [igUserId],
        );
        return r.rows[0] ?? null;
      }),

    automacoesAtivas: (contaId) =>
      comoServico(async (q) => {
        const r = await q.query<AutomacaoAtiva>(
          `select id, qualquer_post, media_id, palavras from public.automacoes
           where conta_id = $1 and ativa order by criado_em, id`,
          [contaId],
        );
        return r.rows;
      }),

    registrarComentario: (c: NovoComentario) =>
      comoServico(async (q) => {
        const r = await q.query(
          `insert into public.comentarios
             (comment_id, user_id, conta_id, automacao_id, media_id, autor_ig_id, autor_username, texto, palavra, comentado_em)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (comment_id) do nothing
           returning id`,
          [c.comment_id, c.user_id, c.conta_id, c.automacao_id, c.media_id, c.autor_ig_id, c.autor_username, c.texto, c.palavra, c.comentado_em],
        );
        return r.rows.length > 0;
      }),
  };
  return { banco, consultas };
}
