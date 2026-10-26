import type { PGlite } from "@electric-sql/pglite";
import { inserirComentarioPg } from "./pg.ts";
import type {
  AutomacaoEnvio,
  Banco,
  ContaEnvio,
  ItemFila,
  Pausa,
  Regras,
  TokenGuardado,
} from "../gatilho-envia/rodada.ts";

/**
 * A interface Banco do envio respondida por um Postgres de verdade (PGlite com a
 * migration 0001 inteira). Cada chamada roda como `service_role`, o papel da chave de
 * serviço: se a função precisasse de uma permissão que a service role não tem, o teste
 * quebraria aqui. `consultas.n` conta as chamadas, para provar "nenhuma consulta feita".
 */

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : d;

export function bancoEnviaSobrePg(db: PGlite): { banco: Banco; consultas: { n: number } } {
  const consultas = { n: 0 };

  async function comoServico<T>(f: (q: PGlite) => Promise<T>): Promise<T> {
    consultas.n++;
    return await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return await f(tx as unknown as PGlite);
    });
  }

  const banco: Banco = {
    regras: () =>
      comoServico(async (q) => {
        const r = await q.query<{ chave: string; valor: string }>(`select chave, valor from public.regras`);
        const porChave = new Map(r.rows.map((l) => [l.chave, Number(l.valor)]));
        const pegar = (chave: string) => {
          const v = porChave.get(chave);
          if (v === undefined) throw new Error(`regra ${chave} não existe na tabela regras`);
          return v;
        };
        return {
          envioMaxPorRodada: pegar("envio_max_por_rodada"),
          envioIntervaloSegundos: pegar("envio_intervalo_segundos"),
          envioPausaDirectMin: pegar("envio_pausa_direct_min"),
          envioPausaRespostaMin: pegar("envio_pausa_resposta_min"),
          respostasPublicasMax24h: pegar("respostas_publicas_max_24h"),
          filaJanelaDias: pegar("fila_janela_dias"),
          consultaPostsRecentesDias: pegar("consulta_posts_recentes_dias"),
          consultaPostsPorRodada: pegar("consulta_posts_por_rodada"),
        } satisfies Regras;
      }),

    contasConectadas: () =>
      comoServico(async (q) => {
        const r = await q.query<ContaEnvio>(
          `select id, user_id, ig_user_id from public.contas_instagram
           where status = 'conectada' and demonstracao = false order by id`,
        );
        return r.rows;
      }),

    assinaturaLiberada: (userId) =>
      comoServico(async (q) => {
        const r = await q.query<{ liberada: boolean }>(`select liberada from public.assinatura_situacao($1)`, [userId]);
        return r.rows[0]?.liberada === true;
      }),

    pausa: (contaId) =>
      comoServico(async (q) => {
        const r = await q.query<{ direct_ate: Date | null; resposta_ate: Date | null }>(
          `select direct_ate, resposta_ate from public.envio_pausa where conta_id = $1`,
          [contaId],
        );
        const l = r.rows[0];
        return { direct_ate: iso(l?.direct_ate), resposta_ate: iso(l?.resposta_ate) } satisfies Pausa;
      }),

    automacoesAtivas: (contaId) =>
      comoServico(async (q) => {
        const r = await q.query<
          { id: string; qualquer_post: boolean; media_id: string | null; palavras: string[]; criado_em: Date }
        >(
          `select id, qualquer_post, media_id, palavras, criado_em from public.automacoes
           where conta_id = $1 and ativa order by criado_em, id`,
          [contaId],
        );
        return r.rows.map((l) => ({ ...l, criado_em: l.criado_em.toISOString() }));
      }),

    registrarComentarios: (lista) =>
      comoServico(async (q) => {
        let n = 0;
        for (const c of lista) if (await inserirComentarioPg(q, c)) n++;
        return n;
      }),

    token: (contaId) =>
      comoServico(async (q) => {
        const r = await q.query<{ token_cifrado: string; expira_em: Date | null }>(
          `select token_cifrado, expira_em from public.tokens_instagram where conta_id = $1`,
          [contaId],
        );
        const l = r.rows[0];
        return l ? ({ token_cifrado: l.token_cifrado, expira_em: iso(l.expira_em) } satisfies TokenGuardado) : null;
      }),

    fila: (contaId, desde, limite, presaAntes) =>
      comoServico(async (q) => {
        const r = await q.query<
          {
            id: string;
            comment_id: string;
            dm_tentativas: number;
            a_id: string | null;
            codigo: string | null;
            mensagem_dm: string | null;
            link_titulo: string | null;
            resposta_publica: string | null;
            ativa: boolean | null;
          }
        >(
          `select c.id, c.comment_id, c.dm_tentativas,
                  a.id as a_id, a.codigo, a.mensagem_dm, a.link_titulo, a.resposta_publica, a.ativa
           from public.comentarios c
           left join public.automacoes a on a.id = c.automacao_id
           where c.conta_id = $1
             and c.dm_em is null and c.dm_erro is null
             and (c.dm_reservado_em is null or c.dm_reservado_em < $4::timestamptz)
             and c.recebido_em > $2::timestamptz
             and (c.automacao_id is null or a.ativa)
           order by c.recebido_em, c.id
           limit $3`,
          [contaId, desde.toISOString(), limite, presaAntes.toISOString()],
        );
        return r.rows.map((l): ItemFila => ({
          id: l.id,
          comment_id: l.comment_id,
          dm_tentativas: l.dm_tentativas,
          automacao: l.a_id
            ? ({
              id: l.a_id,
              codigo: l.codigo!,
              mensagem_dm: l.mensagem_dm!,
              link_titulo: l.link_titulo!,
              resposta_publica: l.resposta_publica,
              ativa: l.ativa!,
            } satisfies AutomacaoEnvio)
            : null,
        }));
      }),

    reservar: (id, lido, quando) =>
      comoServico(async (q) => {
        const r = await q.query(
          `update public.comentarios set dm_tentativas = $2 + 1, dm_reservado_em = $3
           where id = $1 and dm_tentativas = $2 and dm_em is null and dm_erro is null
           returning id`,
          [id, lido, quando.toISOString()],
        );
        return r.rows.length > 0;
      }),

    liberarReserva: (id, reservado) =>
      comoServico(async (q) => {
        await q.query(
          `update public.comentarios set dm_tentativas = $2 - 1, dm_reservado_em = null
           where id = $1 and dm_tentativas = $2 and dm_em is null and dm_erro is null`,
          [id, reservado],
        );
      }),

    marcarDmOk: (id, igsid, quando) =>
      comoServico(async (q) => {
        await q.query(`update public.comentarios set dm_em = $2, igsid = $3 where id = $1 and dm_em is null`, [
          id,
          quando.toISOString(),
          igsid,
        ]);
      }),

    marcarDmErro: (id, erro) =>
      comoServico(async (q) => {
        await q.query(`update public.comentarios set dm_erro = $2 where id = $1 and dm_em is null`, [id, erro]);
      }),

    marcarRespostaOk: (id, quando) =>
      comoServico(async (q) => {
        await q.query(`update public.comentarios set resposta_em = $2 where id = $1`, [id, quando.toISOString()]);
      }),

    marcarRespostaErro: (id, erro) =>
      comoServico(async (q) => {
        await q.query(`update public.comentarios set resposta_erro = $2 where id = $1`, [id, erro]);
      }),

    respostasPublicasDesde: (contaId, desde) =>
      comoServico(async (q) => {
        const r = await q.query<{ n: number }>(
          `select count(*)::int as n from public.comentarios where conta_id = $1 and resposta_em > $2::timestamptz`,
          [contaId, desde.toISOString()],
        );
        return r.rows[0].n;
      }),

    pausarDirect: (contaId, ate, motivo) =>
      comoServico(async (q) => {
        await q.query(
          `insert into public.envio_pausa (conta_id, direct_ate, motivo, avisado_em)
           values ($1, $2, $3, null)
           on conflict (conta_id) do update
             set direct_ate = excluded.direct_ate, motivo = excluded.motivo, avisado_em = null`,
          [contaId, ate.toISOString(), motivo.slice(0, 300)],
        );
      }),

    pausarResposta: (contaId, ate, motivo) =>
      comoServico(async (q) => {
        await q.query(
          `insert into public.envio_pausa (conta_id, resposta_ate, motivo)
           values ($1, $2, $3)
           on conflict (conta_id) do update set resposta_ate = excluded.resposta_ate, motivo = excluded.motivo`,
          [contaId, ate.toISOString(), motivo.slice(0, 300)],
        );
      }),
  };
  return { banco, consultas };
}
