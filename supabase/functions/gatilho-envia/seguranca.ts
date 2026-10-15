const codificar = new TextEncoder();

/**
 * Compara dois textos sem vazar, pelo tempo, onde eles começam a diferir.
 * Tamanhos diferentes também entram na conta (não há retorno antecipado).
 * (Mesmo código de gatilho-webhook/seguranca.ts: cada função se publica sozinha.)
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = codificar.encode(a);
  const y = codificar.encode(b);
  let dif = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}
