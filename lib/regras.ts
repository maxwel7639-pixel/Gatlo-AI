import "server-only";
import { usaSupabase } from "./env";
import { createAdminClient } from "./supabase/admin";

/**
 * AS REGRAS QUE DECIDEM DINHEIRO E LIMITE MORAM NO BANCO, NUMA LISTA SÓ:
 * a tabela `regras` (supabase/migrations/0001_esquema.sql). Preço, dias de
 * teste, carência e os freios de envio da fila saem de lá, e o banco usa os
 * mesmos valores no cadastro (trial_ate) e em assinatura_situacao().
 *
 * Aqui o servidor só LÊ (com cache de 5 min). O navegador nunca manda preço
 * nem prazo: quem decide é o servidor, lendo o banco.
 *
 * REGRAS_DEMONSTRACAO só vale no banco local de demonstração (sem Supabase).
 * Mudou o preço? Muda na tabela `regras` do Supabase. Esta cópia é só pra
 * demonstração não ficar sem números.
 */
export type Regras = {
  precoMensalCentavos: number;
  testeDias: number;
  carenciaDias: number;
  envioMaxPorRodada: number;
  envioIntervaloSegundos: number;
  envioPausaDirectMin: number;
  envioPausaRespostaMin: number;
  respostasPublicasMax24h: number;
  janelaRespostaPrivadaDias: number;
  filaJanelaDias: number;
};

const CHAVES: Record<string, keyof Regras> = {
  preco_mensal_centavos: "precoMensalCentavos",
  teste_dias: "testeDias",
  carencia_dias: "carenciaDias",
  envio_max_por_rodada: "envioMaxPorRodada",
  envio_intervalo_segundos: "envioIntervaloSegundos",
  envio_pausa_direct_min: "envioPausaDirectMin",
  envio_pausa_resposta_min: "envioPausaRespostaMin",
  respostas_publicas_max_24h: "respostasPublicasMax24h",
  janela_resposta_privada_dias: "janelaRespostaPrivadaDias",
  fila_janela_dias: "filaJanelaDias",
};

export const REGRAS_DEMONSTRACAO: Regras = {
  precoMensalCentavos: 9790,
  testeDias: 7,
  carenciaDias: 3,
  envioMaxPorRodada: 6,
  envioIntervaloSegundos: 5,
  envioPausaDirectMin: 180,
  envioPausaRespostaMin: 45,
  respostasPublicasMax24h: 200,
  janelaRespostaPrivadaDias: 7,
  filaJanelaDias: 6,
};

let cache: { valor: Regras; ate: number } | null = null;

export async function regras(): Promise<Regras> {
  if (!usaSupabase) return REGRAS_DEMONSTRACAO;
  if (cache && cache.ate > Date.now()) return cache.valor;

  const { data, error } = await createAdminClient()
    .from("regras")
    .select("chave, valor");
  if (error || !data?.length) {
    // Sem a tabela não dá pra cobrar nem pra mostrar preço certo. Falha alto.
    throw new Error(
      `Não consegui ler a tabela regras (${error?.message ?? "vazia"}). A migration 0001 foi aplicada?`,
    );
  }

  const lidas: Partial<Regras> = {};
  for (const linha of data) {
    const chave = CHAVES[linha.chave as string];
    if (chave) lidas[chave] = Number(linha.valor);
  }
  const faltando = Object.values(CHAVES).filter((c) => lidas[c] === undefined);
  if (faltando.length) {
    throw new Error(`Faltam regras no banco: ${faltando.join(", ")}`);
  }

  cache = { valor: lidas as Regras, ate: Date.now() + 5 * 60_000 };
  return cache.valor;
}

/** "R$ 97,90" */
export function emReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
