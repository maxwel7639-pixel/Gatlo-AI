import "server-only";
import { createAdminClient } from "../supabase/admin";
import { cifrar, decifrar } from "../cripto";
import type { ContaInstagram } from "../dados/tipos";
import { ErroMeta, listarPosts, renovarToken } from "./meta";
import { postsDemo } from "./demo";
import { type ContaParaInscrever, reinscrever } from "./reinscrever";
import type { Post } from "./tipos";

export type { Post, Metricas, PerfilInstagram } from "./tipos";

/**
 * Cache curto dos posts por conta (2 min): a grade, o formulário de automação
 * e a visão geral pedem os mesmos posts, e cada pedido gasta chamada da Meta.
 */
const CACHE_MS = 2 * 60_000;
const global = globalThis as unknown as {
  __gatilhoPosts?: Map<string, { ate: number; posts: Post[] }>;
};
const cache = (global.__gatilhoPosts ??= new Map());

export type ResultadoPosts =
  | { ok: true; posts: Post[] }
  | { ok: false; erro: string; reconectar: boolean };

export async function postsDaConta(conta: ContaInstagram): Promise<ResultadoPosts> {
  if (conta.demonstracao) return { ok: true, posts: postsDemo() };
  if (conta.status !== "conectada") {
    return { ok: false, erro: "O Instagram está desconectado.", reconectar: true };
  }

  const guardado = cache.get(conta.id);
  if (guardado && guardado.ate > Date.now()) return { ok: true, posts: guardado.posts };

  const token = await lerToken(conta.id);
  if (!token) {
    return { ok: false, erro: "Não achei a autorização do Instagram. Conecta de novo.", reconectar: true };
  }
  try {
    const posts = await listarPosts(token);
    cache.set(conta.id, { ate: Date.now() + CACHE_MS, posts });
    return { ok: true, posts };
  } catch (e) {
    if (e instanceof ErroMeta && e.tokenInvalido) {
      await marcarExpirada(conta.id);
      return {
        ok: false,
        erro: "A autorização do Instagram venceu ou foi removida. Conecta de novo.",
        reconectar: true,
      };
    }
    console.error("[posts]", (e as Error).message);
    return { ok: false, erro: "O Instagram não respondeu agora. Tenta de novo em instantes.", reconectar: false };
  }
}

/* ------------------------------------------------ token (só servidor) */

async function lerToken(contaId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("tokens_instagram")
    .select("token_cifrado")
    .eq("conta_id", contaId)
    .maybeSingle();
  if (!data?.token_cifrado) return null;
  try {
    return decifrar(data.token_cifrado);
  } catch (e) {
    console.error("[token] não decifrou (GATILHO_CHAVE_TOKENS mudou?):", (e as Error).message);
    return null;
  }
}

async function marcarExpirada(contaId: string) {
  cache.delete(contaId);
  await createAdminClient().from("contas_instagram").update({ status: "expirada" }).eq("id", contaId);
}

/**
 * Renova os tokens que vencem nos próximos 15 dias (e têm mais de 24 h, regra
 * da Meta). Roda pelo cron diário (/api/cron/renovar-tokens). Token que a Meta
 * recusa marca a conta como "expirada": o painel pede pra conectar de novo.
 */
export async function renovarTokensVencendo(): Promise<{ renovados: number; expirados: number; falhas: number }> {
  const admin = createAdminClient();
  const limite = new Date(Date.now() + 15 * 86400_000).toISOString();
  const umDiaAtras = new Date(Date.now() - 86400_000).toISOString();
  const { data, error } = await admin
    .from("tokens_instagram")
    .select("conta_id, token_cifrado")
    .lt("expira_em", limite)
    .lt("renovado_em", umDiaAtras)
    .limit(200);
  if (error) throw new Error(`tokens: ${error.message}`);

  let renovados = 0;
  let expirados = 0;
  let falhas = 0;
  for (const linha of data ?? []) {
    try {
      const novo = await renovarToken(decifrar(linha.token_cifrado));
      await admin
        .from("tokens_instagram")
        .update({
          token_cifrado: cifrar(novo.token),
          expira_em: novo.expiraEm,
          renovado_em: new Date().toISOString(),
        })
        .eq("conta_id", linha.conta_id);
      renovados++;
    } catch (e) {
      if (e instanceof ErroMeta && e.tokenInvalido) {
        await marcarExpirada(linha.conta_id);
        expirados++;
      } else {
        console.error("[renovar]", linha.conta_id, (e as Error).message);
        falhas++;
      }
    }
  }
  return { renovados, expirados, falhas };
}

/**
 * Inscreve de novo, nos avisos de comentário (webhook), TODAS as contas conectadas que não
 * são demonstração. Roda no cron diário, depois de renovar os tokens: conserta a conta cuja
 * inscrição falhou na hora de conectar (POST subscribed_apps é idempotente). Uma conta com
 * problema vai para o log e não para as outras.
 */
export async function reinscreverContasConectadas(): Promise<{ inscritas: number; falhas: number }> {
  const admin = createAdminClient();
  const contas: ContaParaInscrever[] = [];
  let semToken = 0;
  const PAGINA = 1000; // o PostgREST devolve no máximo 1000 linhas por pedido
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("contas_instagram")
      .select("id, tokens_instagram(token_cifrado, expira_em)")
      .eq("status", "conectada")
      .eq("demonstracao", false)
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`contas: ${error.message}`);
    for (const linha of data ?? []) {
      // embed "para um" (conta_id é a chave de tokens_instagram): objeto, ou lista de um
      const t = Array.isArray(linha.tokens_instagram) ? linha.tokens_instagram[0] : linha.tokens_instagram;
      try {
        if (!t) throw new Error("sem token guardado");
        contas.push({ id: linha.id, token: decifrar(t.token_cifrado) });
      } catch (e) {
        semToken++;
        console.error("[reinscrever]", linha.id, (e as Error).message);
      }
    }
    if ((data?.length ?? 0) < PAGINA) break;
  }
  const r = await reinscrever(contas);
  return { inscritas: r.inscritas, falhas: r.falhas + semToken };
}
