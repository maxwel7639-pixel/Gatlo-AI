/**
 * CPF ou CNPJ válido (dígitos verificadores), devolvido só com números; null se
 * não for. O Asaas exige o documento para criar o cliente do Pix Automático. Ele
 * vai direto pro Asaas e não é guardado no nosso banco.
 */
export function limparCpfCnpj(bruto: string): string | null {
  const d = bruto.replace(/[.\-/\s]/g, "");
  if (!/^\d+$/.test(d) || /^(\d)\1+$/.test(d)) return null;
  if (d.length === 11) return digito(d, 9, 10) && digito(d, 10, 11) ? d : null;
  if (d.length === 14) return digitoCnpj(d, 12) && digitoCnpj(d, 13) ? d : null;
  return null;
}

/** CPF: o dígito na posição `pos` confere com a soma ponderada dos `pos` anteriores. */
function digito(d: string, pos: number, pesoInicial: number): boolean {
  let soma = 0;
  for (let i = 0; i < pos; i++) soma += Number(d[i]) * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return (resto === 10 ? 0 : resto) === Number(d[pos]);
}

function digitoCnpj(d: string, pos: number): boolean {
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < pos; i++) soma += Number(d[i]) * pesos[pesos.length - pos + i];
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === Number(d[pos]);
}
