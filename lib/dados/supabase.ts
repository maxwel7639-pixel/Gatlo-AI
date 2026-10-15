import "server-only";
import { createClient } from "../supabase/server";
import { createAdminClient } from "../supabase/admin";
import { regras } from "../regras";
import { gerarComentarios } from "./simulacao";
import type { NovaConexao, Repositorio } from "./repositorio";
import type { Automacao, Comentario, ContaInstagram, DadosAutomacao, Numeros, Situacao } from "./tipos";

/**
 * O banco de verdade. Regra de bolso:
 * - leitura e escrita do PRÓPRIO usuário vão com a sessão dele (`createClient`):
 *   o RLS e as permissões por coluna do banco valem, mesmo que o código erre;
 * - service role (`createAdminClient`) só pro que o usuário não pode fazer
 *   sozinho: gravar a conexão e o token, a situação da assinatura, o link curto.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas cruas do PostgREST */
const COLUNAS_CONTA =
  "id, ig_user_id, username, nome, foto_url, tipo_conta, seguidores, demonstracao, status, conectada_em";
const COLUNAS_AUTOMACAO =
  "id, conta_id, nome, qualquer_post, media_id, media_permalink, media_miniatura, media_legenda, palavras, mensagem_dm, link_url, link_titulo, resposta_publica, ativa, codigo, criado_em, atualizado_em";

function conta(l: any): ContaInstagram {
  return {
    id: l.id,
    igUserId: l.ig_user_id,
    username: l.username,
    nome: l.nome,
    fotoUrl: l.foto_url,
    tipoConta: l.tipo_conta,
    seguidores: l.seguidores,
    demonstracao: l.demonstracao,
    status: l.status,
    conectadaEm: l.conectada_em,
  };
}

function automacao(l: any): Automacao {
  return {
    id: l.id,
    contaId: l.conta_id,
    nome: l.nome,
    qualquerPost: l.qualquer_post,
    mediaId: l.media_id,
    mediaPermalink: l.media_permalink,
    mediaMiniatura: l.media_miniatura,
    mediaLegenda: l.media_legenda,
    palavras: l.palavras ?? [],
    mensagemDm: l.mensagem_dm,
    linkUrl: l.link_url,
    linkTitulo: l.link_titulo,
    respostaPublica: l.resposta_publica,
    ativa: l.ativa,
    codigo: l.codigo,
    criadaEm: l.criado_em,
    atualizadaEm: l.atualizado_em,
  };
}

function comentario(l: any): Comentario {
  return {
    id: l.id,
    commentId: l.comment_id,
    automacaoId: l.automacao_id,
    mediaId: l.media_id,
    autorUsername: l.autor_username,
    texto: l.texto,
    palavra: l.palavra,
    recebidoEm: l.recebido_em,
    dmEm: l.dm_em,
    dmErro: l.dm_erro,
    respostaEm: l.resposta_em,
  };
}

function paraBanco(d: Partial<DadosAutomacao>) {
  const linha: Record<string, unknown> = {};
  if (d.nome !== undefined) linha.nome = d.nome;
  if (d.qualquerPost !== undefined) linha.qualquer_post = d.qualquerPost;
  if (d.mediaId !== undefined) linha.media_id = d.mediaId;
  if (d.mediaPermalink !== undefined) linha.media_permalink = d.mediaPermalink;
  if (d.mediaMiniatura !== undefined) linha.media_miniatura = d.mediaMiniatura;
  if (d.mediaLegenda !== undefined) linha.media_legenda = d.mediaLegenda;
  if (d.palavras !== undefined) linha.palavras = d.palavras;
  if (d.mensagemDm !== undefined) linha.mensagem_dm = d.mensagemDm;
  if (d.linkUrl !== undefined) linha.link_url = d.linkUrl;
  if (d.linkTitulo !== undefined) linha.link_titulo = d.linkTitulo;
  if (d.respostaPublica !== undefined) linha.resposta_publica = d.respostaPublica;
  if (d.ativa !== undefined) linha.ativa = d.ativa;
  return linha;
}

/** Filtro `or` do PostgREST montado só com id numérico (nada de vírgula ou parêntese). */
function filtroIds(ids: string[]): string | null {
  const limpos = ids.filter((i) => /^[0-9]{1,30}$/.test(i));
  return limpos.length
    ? limpos.map((i) => `ig_app_id.eq.${i},ig_user_id.eq.${i}`).join(",")
    : null;
}

function falhou(onde: string, error: { message: string } | null) {
  if (error) throw new Error(`${onde}: ${error.message}`);
}

export const repositorioSupabase: Repositorio = {
  async contaInstagram(userId) {
    const db = await createClient();
    const { data, error } = await db
      .from("contas_instagram")
      .select(COLUNAS_CONTA)
      .eq("user_id", userId)
      .maybeSingle();
    falhou("conta do Instagram", error);
    return data ? conta(data) : null;
  },

  async salvarConexao(userId, c: NovaConexao) {
    const admin = createAdminClient();

    // A mesma conta do Instagram já está em outro cadastro? Não rouba.
    const { data: dono } = await admin
      .from("contas_instagram")
      .select("user_id")
      .eq("ig_user_id", c.igUserId)
      .maybeSingle();
    if (dono && dono.user_id !== userId) {
      return {
        ok: false,
        erro: "Esse Instagram já está conectado em outro cadastro do Gatilho. Fala com o suporte se for teu.",
      };
    }

    const { data: anterior } = await admin
      .from("contas_instagram")
      .select("id, ig_user_id")
      .eq("user_id", userId)
      .maybeSingle();

    const { data, error } = await admin
      .from("contas_instagram")
      .upsert(
        {
          user_id: userId,
          ig_user_id: c.igUserId,
          ig_app_id: c.igAppId,
          username: c.username,
          nome: c.nome,
          foto_url: c.fotoUrl,
          tipo_conta: c.tipoConta,
          seguidores: c.seguidores,
          demonstracao: c.demonstracao,
          status: "conectada",
          conectada_em: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select(COLUNAS_CONTA)
      .single();
    falhou("salvar conexão", error);

    if (!data) throw new Error("salvar conexão: o banco não devolveu a conta");

    // Trocou de Instagram: as automações eram dos posts da conta antiga.
    if (anterior && anterior.ig_user_id !== c.igUserId) {
      await admin.from("automacoes").update({ ativa: false }).eq("user_id", userId);
    }

    if (c.tokenCifrado) {
      const { error: et } = await admin.from("tokens_instagram").upsert({
        conta_id: data.id,
        token_cifrado: c.tokenCifrado,
        expira_em: c.tokenExpiraEm,
        renovado_em: new Date().toISOString(),
        escopos: c.escopos,
      });
      falhou("salvar token", et);
    } else {
      await admin.from("tokens_instagram").delete().eq("conta_id", data.id);
    }

    return { ok: true, conta: conta(data) };
  },

  async desconectar(userId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("contas_instagram")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return;
    // O token some na hora; a conta fica (com o histórico) marcada desconectada.
    await admin.from("tokens_instagram").delete().eq("conta_id", data.id);
    await admin.from("contas_instagram").update({ status: "desconectada" }).eq("id", data.id);
    await admin.from("automacoes").update({ ativa: false }).eq("user_id", userId);
  },

  async listarAutomacoes(userId) {
    const db = await createClient();
    const { data, error } = await db
      .from("automacoes")
      .select(COLUNAS_AUTOMACAO)
      .eq("user_id", userId)
      .order("criado_em", { ascending: false });
    falhou("automações", error);
    return (data ?? []).map(automacao);
  },

  async automacao(userId, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const db = await createClient();
    const { data, error } = await db
      .from("automacoes")
      .select(COLUNAS_AUTOMACAO)
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    falhou("automação", error);
    return data ? automacao(data) : null;
  },

  async criarAutomacao(_userId, contaId, dados) {
    const db = await createClient();
    const { data, error } = await db
      .from("automacoes")
      .insert({ conta_id: contaId, ...paraBanco(dados) })
      .select(COLUNAS_AUTOMACAO)
      .single();
    falhou("criar automação", error);
    return automacao(data);
  },

  async atualizarAutomacao(userId, id, dados) {
    const db = await createClient();
    const { error } = await db
      .from("automacoes")
      .update(paraBanco(dados))
      .eq("user_id", userId)
      .eq("id", id);
    falhou("atualizar automação", error);
  },

  async excluirAutomacao(userId, id) {
    const db = await createClient();
    const { error } = await db.from("automacoes").delete().eq("user_id", userId).eq("id", id);
    falhou("excluir automação", error);
  },

  async numeros(userId, filtro) {
    const db = await createClient();
    const { filaJanelaDias } = await regras();
    const limiteFila = new Date(Date.now() - filaJanelaDias * 86400_000).toISOString();

    const base = () => {
      let q = db
        .from("comentarios")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (filtro.automacaoId) q = q.eq("automacao_id", filtro.automacaoId);
      if (filtro.desde) q = q.gte("recebido_em", filtro.desde);
      return q;
    };
    let cliques = db
      .from("cliques")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (filtro.automacaoId) cliques = cliques.eq("automacao_id", filtro.automacaoId);
    if (filtro.desde) cliques = cliques.gte("clicado_em", filtro.desde);

    const [c, d, f, e, k] = await Promise.all([
      base(),
      base().not("dm_em", "is", null),
      base().is("dm_em", null).is("dm_erro", null).gte("recebido_em", limiteFila),
      base().not("dm_erro", "is", null),
      cliques,
    ]);
    for (const r of [c, d, f, e, k]) falhou("números", r.error);
    return {
      comentarios: c.count ?? 0,
      dms: d.count ?? 0,
      naFila: f.count ?? 0,
      erros: e.count ?? 0,
      cliques: k.count ?? 0,
    };
  },

  async numerosPorAutomacao() {
    const db = await createClient();
    const { filaJanelaDias } = await regras();
    const { data, error } = await db.rpc("numeros_automacoes", {
      p_fila_desde: new Date(Date.now() - filaJanelaDias * 86400_000).toISOString(),
    });
    falhou("números por automação", error);
    const saida: Record<string, Numeros> = {};
    for (const l of (data ?? []) as any[]) {
      saida[l.automacao_id] = {
        comentarios: Number(l.comentarios),
        dms: Number(l.dms),
        naFila: Number(l.na_fila),
        erros: Number(l.erros),
        cliques: Number(l.cliques),
      };
    }
    return saida;
  },

  async comentariosRecentes(userId, automacaoId, limite) {
    const db = await createClient();
    const { data, error } = await db
      .from("comentarios")
      .select("id, comment_id, automacao_id, media_id, autor_username, texto, palavra, recebido_em, dm_em, dm_erro, resposta_em")
      .eq("user_id", userId)
      .eq("automacao_id", automacaoId)
      .order("recebido_em", { ascending: false })
      .limit(limite);
    falhou("comentários", error);
    return (data ?? []).map(comentario);
  },

  async situacao(userId) {
    const { data, error } = await createAdminClient()
      .rpc("assinatura_situacao", { p_user_id: userId })
      .maybeSingle();
    falhou("situação da assinatura", error);
    if (!data) return null;
    const l = data as any;
    return {
      status: l.status,
      liberada: l.liberada,
      trialAte: l.trial_ate,
      periodoAte: l.periodo_ate,
      diasRestantes: l.dias_restantes,
    } satisfies Situacao;
  },

  async pausa(_userId, contaId) {
    const db = await createClient();
    const { data } = await db
      .from("envio_pausa")
      .select("direct_ate, resposta_ate, motivo")
      .eq("conta_id", contaId)
      .maybeSingle();
    return data
      ? { directAte: data.direct_ate, respostaAte: data.resposta_ate, motivo: data.motivo }
      : null;
  },

  async destinoDoLink(codigo) {
    if (!/^[0-9a-z]{6,16}$/i.test(codigo)) return null;
    const { data } = await createAdminClient()
      .from("automacoes")
      .select("id, user_id, link_url")
      .eq("codigo", codigo)
      .maybeSingle();
    return data ? { automacaoId: data.id, userId: data.user_id, linkUrl: data.link_url } : null;
  },

  async comentarioEhDaAutomacao(comentarioId, automacaoId) {
    if (!/^[0-9a-f-]{36}$/i.test(comentarioId)) return false;
    const { data } = await createAdminClient()
      .from("comentarios")
      .select("id")
      .eq("id", comentarioId)
      .eq("automacao_id", automacaoId)
      .maybeSingle();
    return Boolean(data);
  },

  async registrarClique(c) {
    await createAdminClient().from("cliques").insert({
      automacao_id: c.automacaoId,
      user_id: c.userId,
      comentario_id: c.comentarioId,
      visitante: c.visitante,
    });
  },

  async desconectarPorInstagram(ids) {
    const filtro = filtroIds(ids);
    if (!filtro) return 0;
    const admin = createAdminClient();
    const { data } = await admin.from("contas_instagram").select("id, user_id").or(filtro);
    for (const c of data ?? []) {
      await admin.from("tokens_instagram").delete().eq("conta_id", c.id);
      await admin.from("contas_instagram").update({ status: "desconectada" }).eq("id", c.id);
      await admin.from("automacoes").update({ ativa: false }).eq("user_id", c.user_id);
    }
    return data?.length ?? 0;
  },

  async apagarPorInstagram(ids) {
    const filtro = filtroIds(ids);
    if (!filtro) return 0;
    // apagar a conta leva junto (cascade) token, automações, comentários e cliques
    const { data, error } = await createAdminClient()
      .from("contas_instagram")
      .delete()
      .or(filtro)
      .select("id");
    falhou("apagar dados", error);
    return data?.length ?? 0;
  },

  async simularComentarios(userId, automacaoId) {
    const a = await repositorioSupabase.automacao(userId, automacaoId);
    const c = await repositorioSupabase.contaInstagram(userId);
    // só conta fictícia: nunca inventa comentário numa conta de verdade
    if (!a || !c || !c.demonstracao) return 0;
    const lote = gerarComentarios(a);
    const admin = createAdminClient();
    const { error } = await admin.from("comentarios").insert(
      lote.map((s) => ({
        id: s.id,
        comment_id: s.commentId,
        user_id: userId,
        conta_id: c.id,
        automacao_id: a.id,
        media_id: s.mediaId,
        autor_ig_id: s.autorIgId,
        autor_username: s.autorUsername,
        texto: s.texto,
        palavra: s.palavra,
        recebido_em: s.recebidoEm,
        dm_em: s.dmEm,
        dm_erro: s.dmErro,
        resposta_em: s.respostaEm,
      })),
    );
    falhou("simular comentários", error);
    const cliques = lote.filter((s) => s.clicou);
    if (cliques.length) {
      await admin.from("cliques").insert(
        cliques.map((s) => ({
          automacao_id: a.id,
          user_id: userId,
          comentario_id: s.id,
          visitante: `demo-${s.autorIgId}`,
        })),
      );
    }
    return lote.length;
  },
};
