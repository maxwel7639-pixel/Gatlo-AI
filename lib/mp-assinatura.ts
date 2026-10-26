/**
 * Validação da assinatura do webhook do Mercado Pago (header `x-signature`).
 *
 * Duas travas em fila: esta (a assinatura secreta, que rejeita o lixo antes de
 * gastar uma chamada de API) e a consulta à API do MP antes de creditar
 * (lib/mp-webhook.ts), que decide status, dono e valor. Uma não substitui a outra.
 *
 * Formato: o header vem como "ts=1699999999,v1=<hash>", e o hash é HMAC-SHA256
 * do manifesto abaixo, feito com a assinatura secreta. Usa WebCrypto (global)
 * em vez de node:crypto porque o mesmo arquivo roda no servidor da Vercel e
 * nos testes em Deno, que não tem @types/node no meio.
 */
export async function assinaturaValida(
  cabecalhoAssinatura: string | null,
  requestId: string | null,
  dataId: string | null,
): Promise<{ valida: boolean; motivo?: string }> {
  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  // Sem segredo configurado NADA passa: o webhook é público, e a regra da casa
  // é conferir a assinatura antes de qualquer efeito. Esquecer a variável vira
  // 401 (o MP reenvia depois), não uma porta aberta.
  if (!segredo) return { valida: false, motivo: "MERCADOPAGO_WEBHOOK_SECRET não configurado" };
  if (!cabecalhoAssinatura) return { valida: false, motivo: "sem x-signature" };

  const partes = Object.fromEntries(
    cabecalhoAssinatura.split(",").map((p) => {
      const [k, ...resto] = p.split("=");
      return [k.trim(), resto.join("=").trim()];
    }),
  );

  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return { valida: false, motivo: "x-signature malformado" };
  const assinatura = hexParaBytes(v1);
  if (!assinatura) return { valida: false, motivo: "v1 não é hex" };

  // O manifesto tem ordem e pontuação fixas — qualquer desvio muda o hash.
  const manifesto =
    `${dataId ? `id:${dataId};` : ""}` +
    `${requestId ? `request-id:${requestId};` : ""}` +
    `ts:${ts};`;

  const cod = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(cod.encode(segredo)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  // crypto.subtle.verify compara em tempo constante e não vaza o hash certo.
  const ok = assinatura.length === 32 &&
    await crypto.subtle.verify("HMAC", chave, new Uint8Array(assinatura), new Uint8Array(cod.encode(manifesto)));

  return ok ? { valida: true } : { valida: false, motivo: "hash divergente" };
}

/** Hex em bytes; devolve null se não for hex de verdade. */
function hexParaBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}
