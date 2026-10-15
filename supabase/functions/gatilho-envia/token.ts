/**
 * Decifra o token do Instagram guardado em tokens_instagram.token_cifrado.
 * Formato "v1.<iv>.<cifra+tag>" (lib/cripto.ts): AES-256-GCM, iv e cifra em base64url,
 * a tag de 16 bytes no fim da cifra (é o formato do WebCrypto, sem conversão).
 * A chave (GATILHO_CHAVE_TOKENS) é base64 padrão, 32 bytes.
 */

function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const padrao = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padrao), (c) => c.charCodeAt(0));
}

export async function importarChave(chaveBase64: string): Promise<CryptoKey> {
  const bruta = bytes(chaveBase64);
  if (bruta.length !== 32) throw new Error("GATILHO_CHAVE_TOKENS precisa ter 32 bytes em base64");
  return await crypto.subtle.importKey("raw", bruta, "AES-GCM", false, ["decrypt"]);
}

export async function decifrarToken(cifrado: string, chave: CryptoKey): Promise<string> {
  const [versao, iv, corpo] = cifrado.split(".");
  if (versao !== "v1" || !iv || !corpo) throw new Error("token cifrado em formato desconhecido");
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv) }, chave, bytes(corpo));
  return new TextDecoder().decode(claro);
}
