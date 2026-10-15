const codificar = new TextEncoder();

/**
 * Compara dois textos sem vazar, pelo tempo, onde eles começam a diferir.
 * Tamanhos diferentes também entram na conta (não há retorno antecipado).
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = codificar.encode(a);
  const y = codificar.encode(b);
  let dif = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

/**
 * Confere o X-Hub-Signature-256 da Meta: "sha256=" + HMAC-SHA256 do corpo CRU
 * (os bytes que chegaram, antes de qualquer JSON.parse) com o segredo do app.
 */
export async function assinaturaConfere(
  segredo: string,
  corpoCru: Uint8Array<ArrayBuffer>,
  cabecalho: string | null,
): Promise<boolean> {
  if (!segredo || !cabecalho?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey(
    "raw",
    codificar.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const esperada = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", chave, corpoCru)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return iguaisEmTempoConstante(cabecalho.slice("sha256=".length).toLowerCase(), esperada);
}
