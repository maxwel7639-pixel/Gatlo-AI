import "server-only";
import { headers } from "next/headers";
import { usaSupabase } from "./env";
import { createAdminClient } from "./supabase/admin";
import { mudar } from "./local/banco";

/**
 * Trava de taxa (mesmo desenho do Fisga). Devolve true quando a ação pode seguir.
 *
 * O contador mora no banco, não na memória: na Vercel cada requisição pode cair
 * num servidor diferente, e contador em memória não limitaria ninguém.
 *
 * FALHA FECHADA: se a trava não respondeu, a ação NÃO acontece. Liberar no
 * erro faria de qualquer soluço do banco a porta que a trava existe pra fechar.
 */
export async function dentroDaTaxa(
  chave: string,
  limite: number,
  janelaSegundos: number,
): Promise<boolean> {
  if (!usaSupabase) {
    return mudar((banco) => {
      const agora = Date.now();
      const atual = banco.taxa[chave];
      if (!atual || agora - atual.inicio > janelaSegundos * 1000) {
        banco.taxa[chave] = { contador: 1, inicio: agora };
        return true;
      }
      if (atual.contador >= limite) return false;
      atual.contador += 1;
      return true;
    });
  }

  const { data, error } = await createAdminClient().rpc("consumir_taxa", {
    p_chave: chave,
    p_limite: limite,
    p_janela_segundos: janelaSegundos,
  });
  if (error) {
    console.error(`[taxa] ${chave}: ${error.message}`);
    return false;
  }
  return data === true;
}

/**
 * IP de quem chamou, pra limitar quem ainda não tem login (cadastro, senha).
 * IP não é identidade (operadora de celular junta muita gente no mesmo), então
 * os limites por IP são folgados.
 */
export async function ipDaRequisicao(): Promise<string> {
  const h = await headers();
  const encadeado = h.get("x-forwarded-for");
  if (encadeado) return encadeado.split(",")[0].trim();
  return h.get("x-real-ip") ?? "desconhecido";
}
