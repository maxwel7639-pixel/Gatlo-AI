import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Cifra do token do Instagram.
 *
 * O token dá acesso ao Instagram do cliente (ler comentários, mandar DM). Ele
 * fica numa tabela que só a service role lê E cifrado com uma chave que só
 * existe na variável de ambiente GATILHO_CHAVE_TOKENS. Quem vazar o banco sem
 * a chave leva texto embaralhado.
 *
 * Formato: "v1.<iv>.<cifra+tag>" em base64url. AES-256-GCM com iv de 12 bytes
 * e a tag de 16 bytes NO FIM da cifra, que é o formato do WebCrypto: a Edge
 * Function da fase B (Deno) decifra com crypto.subtle.decrypt sem conversão.
 *
 * Gerar a chave: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

function chave(): Buffer {
  const bruta = process.env.GATILHO_CHAVE_TOKENS;
  if (!bruta) throw new Error("GATILHO_CHAVE_TOKENS não configurada.");
  const k = Buffer.from(bruta, "base64");
  if (k.length !== 32) {
    throw new Error("GATILHO_CHAVE_TOKENS precisa ter 32 bytes em base64.");
  }
  return k;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const corpo = Buffer.concat([c.update(texto, "utf8"), c.final(), c.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${corpo.toString("base64url")}`;
}

export function decifrar(cifrado: string): string {
  const [versao, ivB64, corpoB64] = cifrado.split(".");
  if (versao !== "v1" || !ivB64 || !corpoB64) throw new Error("Token cifrado em formato desconhecido.");
  const corpo = Buffer.from(corpoB64, "base64url");
  const tag = corpo.subarray(corpo.length - 16);
  const dados = corpo.subarray(0, corpo.length - 16);
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(ivB64, "base64url"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
}

/** Texto aleatório seguro, bom pra state do OAuth e códigos. */
export function aleatorio(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Compara dois textos sem vazar tempo. */
export function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmac(segredo: string, texto: string): string {
  return createHmac("sha256", segredo).update(texto).digest("base64url");
}

/**
 * Impressão do visitante do link curto: serve só pra contar clique único.
 * O IP nunca é gravado; só este resumo com sal, que não volta a ser IP.
 */
export function impressao(...partes: string[]): string {
  const sal = process.env.GATILHO_SAL_CLIQUES || "gatilho";
  return createHash("sha256").update([sal, ...partes].join("|")).digest("base64url").slice(0, 22);
}
