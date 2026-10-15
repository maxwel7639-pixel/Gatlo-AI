import { createClient } from "@supabase/supabase-js";
import type { AutomacaoAtiva, Banco, ContaAlvo, NovoComentario } from "./processar.ts";

/**
 * Acesso ao banco com a service role (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY,
 * que o Supabase já injeta nas Edge Functions). A service role passa por cima do
 * RLS: por isso cada consulta aqui filtra à mão e a função só roda depois de a
 * assinatura da Meta conferir.
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

  return {
    async acharContaConectada(igUserId): Promise<ContaAlvo | null> {
      const { data, error } = await sb
        .from("contas_instagram")
        .select("id, user_id")
        .eq("ig_user_id", igUserId)
        .eq("status", "conectada")
        .eq("demonstracao", false)
        .maybeSingle();
      if (error) throw new Error(`contas_instagram: ${error.message}`);
      return data;
    },

    async automacoesAtivas(contaId): Promise<AutomacaoAtiva[]> {
      const { data, error } = await sb
        .from("automacoes")
        .select("id, qualquer_post, media_id, palavras")
        .eq("conta_id", contaId)
        .eq("ativa", true)
        .order("criado_em", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new Error(`automacoes: ${error.message}`);
      return data ?? [];
    },

    async registrarComentario(c: NovoComentario): Promise<boolean> {
      // upsert + ignoreDuplicates = "insert ... on conflict (comment_id) do nothing";
      // o select devolve só as linhas que entraram (vazio = o comment_id já existia)
      const { data, error } = await sb
        .from("comentarios")
        .upsert(c, { onConflict: "comment_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`comentarios: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}
