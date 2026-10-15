import "server-only";
import { SITE_URL } from "../config";
import type { Metricas, PerfilInstagram, Post } from "./tipos";

/**
 * API do Instagram com login do Instagram ("Instagram API with Instagram
 * Login", graph.instagram.com). Conferido na documentação da Meta em 14/10/2026:
 *
 * - autorizar:   https://www.instagram.com/oauth/authorize (code vale 1 h, uso único;
 *                pode voltar com "#_" no fim, que não faz parte do código)
 * - trocar code: POST https://api.instagram.com/oauth/access_token
 *                -> { data: [{ access_token, user_id, permissions }] } (token curto)
 * - token longo: GET graph.instagram.com/access_token?grant_type=ig_exchange_token
 *                -> { access_token, token_type, expires_in } (~60 dias)
 * - renovar:     GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *                (token com 24 h ou mais e ainda válido; dá mais 60 dias)
 * - métricas do post: /{media-id}/insights?metric=reach,views,saved,shares
 *                ("impressions" e "plays" saíram; exigem o escopo
 *                instagram_business_manage_insights; álbum filho não tem;
 *                dado indisponível volta vazio, não 0)
 *
 * O app secret só aparece aqui, no servidor.
 */

const VERSAO = process.env.INSTAGRAM_GRAPH_VERSAO || "v23.0";
export const GRAPH = `https://graph.instagram.com/${VERSAO}`;

/**
 * Os escopos pedidos no login. Os três do produto + o de métricas (sem ele a
 * Meta não devolve alcance, visualizações, salvamentos nem compartilhamentos).
 * INSTAGRAM_SEM_METRICAS=1 tira o de métricas (uma permissão a menos na
 * revisão do app; a grade mostra só comentários e curtidas).
 */
export function escopos(): string[] {
  const base = [
    "instagram_business_basic",
    "instagram_business_manage_comments",
    "instagram_business_manage_messages",
  ];
  if (process.env.INSTAGRAM_SEM_METRICAS !== "1") base.push("instagram_business_manage_insights");
  return base;
}

export const redirectUri = () => `${SITE_URL}/api/instagram/callback`;

function credenciais() {
  const id = process.env.INSTAGRAM_APP_ID;
  const segredo = process.env.INSTAGRAM_APP_SECRET;
  if (!id || !segredo) throw new Error("Faltam INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET.");
  return { id, segredo };
}

export class ErroMeta extends Error {
  constructor(
    mensagem: string,
    public codigo: number | null = null,
    public tokenInvalido = false,
  ) {
    super(mensagem);
  }
}

type RespostaMeta = Record<string, unknown> & {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
  error_message?: string;
  code?: number;
};

async function chamar(url: string, init?: RequestInit): Promise<RespostaMeta> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new ErroMeta(`Sem resposta da Meta (${(e as Error).message}).`);
  }
  const j = (await r.json().catch(() => ({}))) as RespostaMeta;
  if (!r.ok || j.error || j.error_message) {
    const codigo = Number(j.error?.code ?? j.code ?? r.status) || null;
    const msg = j.error?.message || j.error_message || `HTTP ${r.status}`;
    // 190 = token inválido/expirado (a pessoa trocou a senha, removeu o app...)
    throw new ErroMeta(msg, codigo, codigo === 190);
  }
  return j;
}

/** Token no cabeçalho (e não na URL, que costuma ir parar em log). */
const comToken = (token: string): RequestInit => ({
  headers: { Authorization: `Bearer ${token}` },
});

export function urlDeAutorizacao(state: string): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", credenciais().id);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", escopos().join(","));
  u.searchParams.set("state", state);
  // só o login do Instagram (conta profissional), sem a opção do Facebook
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("force_reauth", "true");
  return u.toString();
}

/** code -> token curto (1 h). */
export async function trocarCodigo(codigo: string) {
  const { id, segredo } = credenciais();
  const corpo = new URLSearchParams({
    client_id: id,
    client_secret: segredo,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code: codigo.replace(/#_$/, ""),
  });
  const j = await chamar("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: corpo,
  });
  // A documentação mostra { data: [ {...} ] }; respostas antigas vinham soltas.
  const d = (Array.isArray(j.data) ? j.data[0] : j) as Record<string, unknown>;
  const token = String(d.access_token ?? "");
  if (!token) throw new ErroMeta("A Meta não devolveu o token.");
  const permissoes = Array.isArray(d.permissions)
    ? (d.permissions as string[])
    : String(d.permissions ?? "").split(",").filter(Boolean);
  return { tokenCurto: token, permissoes };
}

/** token curto -> token longo (~60 dias). */
export async function tokenLongo(tokenCurto: string) {
  const u = new URL("https://graph.instagram.com/access_token");
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", credenciais().segredo);
  u.searchParams.set("access_token", tokenCurto);
  const j = await chamar(u.toString());
  return paraToken(j);
}

/** Renova o token longo por mais 60 dias. */
export async function renovarToken(token: string) {
  const u = new URL("https://graph.instagram.com/refresh_access_token");
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", token);
  const j = await chamar(u.toString());
  return paraToken(j);
}

function paraToken(j: RespostaMeta) {
  const token = String(j.access_token ?? "");
  if (!token) throw new ErroMeta("A Meta não devolveu o token longo.");
  const segundos = Number(j.expires_in ?? 0) || 60 * 86400;
  return { token, expiraEm: new Date(Date.now() + segundos * 1000).toISOString() };
}

export async function lerPerfil(token: string): Promise<PerfilInstagram> {
  const u = new URL(`${GRAPH}/me`);
  u.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url,account_type,followers_count",
  );
  const j = await chamar(u.toString(), comToken(token));
  const igUserId = String(j.user_id ?? j.id ?? "");
  if (!igUserId || !j.username) throw new ErroMeta("A Meta não devolveu o perfil.");
  return {
    igUserId,
    igAppId: j.id ? String(j.id) : null,
    username: String(j.username),
    nome: j.name ? String(j.name) : null,
    fotoUrl: j.profile_picture_url ? String(j.profile_picture_url) : null,
    tipoConta: j.account_type ? String(j.account_type) : null,
    seguidores: typeof j.followers_count === "number" ? j.followers_count : null,
  };
}

type MidiaMeta = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number;
  like_count?: number;
};

/** Os últimos posts, com as métricas dos mais novos. */
export async function listarPosts(token: string, limite = 18): Promise<Post[]> {
  const u = new URL(`${GRAPH}/me/media`);
  u.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count",
  );
  u.searchParams.set("limit", String(limite));
  const j = await chamar(u.toString(), comToken(token));
  const lista = (Array.isArray(j.data) ? j.data : []) as MidiaMeta[];

  const posts: Post[] = lista.map((m) => ({
    id: String(m.id),
    legenda: m.caption ?? "",
    tipo: m.media_type ?? "IMAGE",
    produto: m.media_product_type ?? null,
    // vídeo/reel: a miniatura é thumbnail_url; foto e álbum: media_url
    miniatura: (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url) ?? m.thumbnail_url ?? null,
    permalink: m.permalink ?? null,
    publicadoEm: m.timestamp ?? new Date(0).toISOString(),
    comentarios: typeof m.comments_count === "number" ? m.comments_count : null,
    curtidas: typeof m.like_count === "number" ? m.like_count : null,
    metricas: null,
  }));

  // Métricas: 1 chamada por post, de 4 em 4, só nos 12 mais novos (o limite
  // de chamadas da Meta é por conta; a grade não pode gastar tudo).
  const comMetricas = posts.slice(0, 12);
  for (let i = 0; i < comMetricas.length; i += 4) {
    await Promise.all(
      comMetricas.slice(i, i + 4).map(async (p) => {
        p.metricas = await metricasDoPost(token, p.id);
      }),
    );
  }
  return posts;
}

const NOMES: Record<string, keyof Metricas> = {
  reach: "alcance",
  views: "visualizacoes",
  saved: "salvamentos",
  shares: "compartilhamentos",
};

/**
 * Métricas de um post. Nunca quebra: métrica que a Meta não deu vira null.
 * Tenta as quatro juntas; se a Meta recusar o pacote (acontece com "views" em
 * alguns tipos), tenta sem ela; se recusar de novo, devolve null.
 */
export async function metricasDoPost(token: string, mediaId: string): Promise<Metricas | null> {
  for (const lista of [["reach", "views", "saved", "shares"], ["reach", "saved", "shares"]]) {
    try {
      const u = new URL(`${GRAPH}/${encodeURIComponent(mediaId)}/insights`);
      u.searchParams.set("metric", lista.join(","));
      const j = await chamar(u.toString(), comToken(token));
      const m: Metricas = { alcance: null, visualizacoes: null, salvamentos: null, compartilhamentos: null };
      for (const item of (Array.isArray(j.data) ? j.data : []) as {
        name?: string;
        values?: { value?: unknown }[];
        total_value?: { value?: unknown };
      }[]) {
        const chave = NOMES[item.name ?? ""];
        const v = item.total_value?.value ?? item.values?.[0]?.value;
        if (chave && typeof v === "number") m[chave] = v;
      }
      return m;
    } catch (e) {
      if (e instanceof ErroMeta && e.tokenInvalido) throw e;
    }
  }
  return null;
}
