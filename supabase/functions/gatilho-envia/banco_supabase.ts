import { createClient } from "@supabase/supabase-js";
import type { AutomacaoEnvio, Banco, ContaEnvio, ItemFila, Pausa, Regras, TokenGuardado } from "./rodada.ts";

const PAGINA = 1000; // o PostgREST devolve no máximo 1000 linhas por pedido

const CHAVES_DAS_REGRAS = {
  envioMaxPorRodada: "envio_max_por_rodada",
  envioIntervaloSegundos: "envio_intervalo_segundos",
  envioPausaDirectMin: "envio_pausa_direct_min",
  envioPausaRespostaMin: "envio_pausa_resposta_min",
  respostasPublicasMax24h: "respostas_publicas_max_24h",
  filaJanelaDias: "fila_janela_dias",
} as const satisfies Record<keyof Regras, string>;

/**
 * Acesso ao banco com a service role (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY, que o
 * Supabase já injeta nas Edge Functions). A service role passa por cima do RLS: por isso
 * cada consulta aqui filtra à mão e a função só roda depois de a chave do cron conferir.
 */
export function bancoSupabase(
  url: string,
  chaveServico: string,
  /** só os testes trocam o fetch (por um PostgREST de mentira) */
  opcoes: { fetch?: typeof fetch } = {},
): Banco {
  const sb = createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opcoes.fetch ? { global: { fetch: opcoes.fetch } } : {}),
  });

  const falhou = (tabela: string, erro: { message: string }) => new Error(`${tabela}: ${erro.message}`);

  return {
    async regras(): Promise<Regras> {
      const { data, error } = await sb.from("regras").select("chave, valor");
      if (error) throw falhou("regras", error);
      const porChave = new Map((data ?? []).map((l) => [String(l.chave), Number(l.valor)]));
      const lida = {} as Regras;
      for (const [campo, chave] of Object.entries(CHAVES_DAS_REGRAS) as [keyof Regras, string][]) {
        const valor = porChave.get(chave);
        // sem a regra, ERRO: o envio nunca roda com um número inventado
        if (valor === undefined || !Number.isFinite(valor)) throw new Error(`regra ${chave} não existe na tabela regras`);
        lida[campo] = valor;
      }
      return lida;
    },

    async contasConectadas(): Promise<ContaEnvio[]> {
      const contas: ContaEnvio[] = [];
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await sb
          .from("contas_instagram")
          .select("id, user_id, ig_user_id")
          .eq("status", "conectada")
          .eq("demonstracao", false)
          .order("id", { ascending: true })
          .range(de, de + PAGINA - 1);
        if (error) throw falhou("contas_instagram", error);
        contas.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGINA) return contas;
      }
    },

    async assinaturaLiberada(userId): Promise<boolean> {
      const { data, error } = await sb.rpc("assinatura_situacao", { p_user_id: userId });
      if (error) throw falhou("assinatura_situacao", error);
      return (data as { liberada: boolean }[] | null)?.[0]?.liberada === true;
    },

    async pausa(contaId): Promise<Pausa> {
      const { data, error } = await sb
        .from("envio_pausa")
        .select("direct_ate, resposta_ate")
        .eq("conta_id", contaId)
        .maybeSingle();
      if (error) throw falhou("envio_pausa", error);
      return { direct_ate: data?.direct_ate ?? null, resposta_ate: data?.resposta_ate ?? null };
    },

    async token(contaId): Promise<TokenGuardado | null> {
      const { data, error } = await sb
        .from("tokens_instagram")
        .select("token_cifrado, expira_em")
        .eq("conta_id", contaId)
        .maybeSingle();
      if (error) throw falhou("tokens_instagram", error);
      return data;
    },

    async fila(contaId, desde, limite): Promise<ItemFila[]> {
      // automação desligada: o comentário fica guardado e não ocupa vaga na rodada
      const { data: desligadas, error: ed } = await sb
        .from("automacoes")
        .select("id")
        .eq("conta_id", contaId)
        .eq("ativa", false);
      if (ed) throw falhou("automacoes", ed);

      let consulta = sb
        .from("comentarios")
        .select("id, comment_id, dm_tentativas, automacoes(id, codigo, mensagem_dm, link_titulo, resposta_publica, ativa)")
        .eq("conta_id", contaId)
        .is("dm_em", null)
        .is("dm_erro", null)
        .eq("dm_tentativas", 0)
        .gt("recebido_em", desde.toISOString());
      if (desligadas?.length) {
        // "not in" sozinho descartaria também a automação apagada (null não é "not in" de nada)
        consulta = consulta.or(`automacao_id.is.null,automacao_id.not.in.(${desligadas.map((a) => a.id).join(",")})`);
      }
      const { data, error } = await consulta
        .order("recebido_em", { ascending: true })
        .order("id", { ascending: true })
        .limit(limite);
      if (error) throw falhou("comentarios", error);
      return (data ?? []).map((l) => {
        // a automação vem de um embed "para um" (FK em comentarios.automacao_id): objeto ou null
        const embutida: unknown = Array.isArray(l.automacoes) ? l.automacoes[0] : l.automacoes;
        return {
          id: l.id as string,
          comment_id: l.comment_id as string,
          dm_tentativas: l.dm_tentativas as number,
          automacao: (embutida ?? null) as AutomacaoEnvio | null,
        };
      });
    },

    async reservar(comentarioId, lido): Promise<boolean> {
      // um UPDATE só, com a condição dentro: duas rodadas ao mesmo tempo, uma ganha a linha
      const { data, error } = await sb
        .from("comentarios")
        .update({ dm_tentativas: lido + 1 })
        .eq("id", comentarioId)
        .eq("dm_tentativas", lido)
        .is("dm_em", null)
        .is("dm_erro", null)
        .select("id");
      if (error) throw falhou("comentarios", error);
      return (data?.length ?? 0) > 0;
    },

    async liberarReserva(comentarioId, reservado): Promise<void> {
      const { error } = await sb
        .from("comentarios")
        .update({ dm_tentativas: reservado - 1 })
        .eq("id", comentarioId)
        .eq("dm_tentativas", reservado)
        .is("dm_em", null)
        .is("dm_erro", null);
      if (error) throw falhou("comentarios", error);
    },

    async marcarDmOk(comentarioId, igsid, quando): Promise<void> {
      const { error } = await sb
        .from("comentarios")
        .update({ dm_em: quando.toISOString(), igsid })
        .eq("id", comentarioId)
        .is("dm_em", null);
      if (error) throw falhou("comentarios", error);
    },

    async marcarDmErro(comentarioId, erro): Promise<void> {
      const { error } = await sb.from("comentarios").update({ dm_erro: erro }).eq("id", comentarioId).is("dm_em", null);
      if (error) throw falhou("comentarios", error);
    },

    async marcarRespostaOk(comentarioId, quando): Promise<void> {
      const { error } = await sb.from("comentarios").update({ resposta_em: quando.toISOString() }).eq("id", comentarioId);
      if (error) throw falhou("comentarios", error);
    },

    async marcarRespostaErro(comentarioId, erro): Promise<void> {
      const { error } = await sb.from("comentarios").update({ resposta_erro: erro }).eq("id", comentarioId);
      if (error) throw falhou("comentarios", error);
    },

    async respostasPublicasDesde(contaId, desde): Promise<number> {
      const { count, error } = await sb
        .from("comentarios")
        .select("id", { count: "exact", head: true })
        .eq("conta_id", contaId)
        .gt("resposta_em", desde.toISOString());
      if (error) throw falhou("comentarios", error);
      return count ?? 0;
    },

    async pausarDirect(contaId, ate, motivo): Promise<void> {
      // o upsert só atualiza as colunas enviadas: resposta_ate fica como estava
      const { error } = await sb
        .from("envio_pausa")
        .upsert(
          { conta_id: contaId, direct_ate: ate.toISOString(), motivo: motivo.slice(0, 300), avisado_em: null },
          { onConflict: "conta_id" },
        );
      if (error) throw falhou("envio_pausa", error);
    },

    async pausarResposta(contaId, ate, motivo): Promise<void> {
      const { error } = await sb
        .from("envio_pausa")
        .upsert({ conta_id: contaId, resposta_ate: ate.toISOString(), motivo: motivo.slice(0, 300) }, { onConflict: "conta_id" });
      if (error) throw falhou("envio_pausa", error);
    },
  };
}
