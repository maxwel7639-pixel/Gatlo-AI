import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Lê o `signed_request` que a Meta manda nos avisos de "desautorizou o app" e
 * "pediu exclusão de dados". Formato: <assinatura>.<dados>, os dois em
 * base64url; a assinatura é HMAC-SHA256 dos dados com o app secret.
 *
 * Sem assinatura certa, o aviso é ignorado: qualquer um na internet consegue
 * mandar POST pra essa URL, e sem a conferência dava pra apagar a conta dos
 * outros.
 */
export function lerSignedRequest(signed: string): { user_id?: string } | null {
  const segredo = process.env.INSTAGRAM_APP_SECRET;
  if (!segredo || !signed.includes(".")) return null;
  const [assinatura, dados] = signed.split(".", 2);
  try {
    const esperado = createHmac("sha256", segredo).update(dados).digest();
    const veio = Buffer.from(assinatura, "base64url");
    if (veio.length !== esperado.length || !timingSafeEqual(veio, esperado)) return null;
    const corpo = JSON.parse(Buffer.from(dados, "base64url").toString("utf8"));
    if (String(corpo.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
    return corpo;
  } catch {
    return null;
  }
}

/** O signed_request vem como formulário (x-www-form-urlencoded). */
export async function signedRequestDoCorpo(req: Request): Promise<{ user_id?: string } | null> {
  try {
    const form = await req.formData();
    return lerSignedRequest(String(form.get("signed_request") ?? ""));
  } catch {
    return null;
  }
}
