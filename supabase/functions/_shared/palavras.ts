/**
 * Palavra-chave: maiúscula e acento NÃO fazem diferença.
 * "QUERO", "quero" e "Quéro" contam igual. A mesma função roda na prévia do
 * painel e (fase B) no robô que lê os comentários, pra prévia nunca mentir.
 */

/** minúscula, sem acento, sem espaço sobrando. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Quebra em pedaços de letra/número ("Link, por favor!" -> link, por, favor). */
function pedacos(texto: string): string[] {
  return normalizar(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Qual palavra o comentário acertou (a primeira da lista), ou null.
 *
 * Bate a palavra INTEIRA: "link" acerta "Link pfv" e "LINK!!!", mas não
 * "linkedin". Palavra de mais de um pedaço ("quero o link") precisa aparecer
 * na mesma ordem. Palavra só de emoji ("🔥") procura o emoji em qualquer lugar.
 */
export function palavraQueBateu(comentario: string, palavras: string[]): string | null {
  const doComentario = pedacos(comentario);
  const normalizado = normalizar(comentario);

  for (const palavra of palavras) {
    const alvo = pedacos(palavra);
    if (!alvo.length) {
      const bruto = normalizar(palavra);
      if (bruto && normalizado.includes(bruto)) return palavra;
      continue;
    }
    for (let i = 0; i + alvo.length <= doComentario.length; i++) {
      if (alvo.every((p, j) => doComentario[i + j] === p)) return palavra;
    }
  }
  return null;
}

/**
 * Limpa a lista que a pessoa digitou: tira vazio, espaço sobrando e repetida
 * (repetida no sentido do robô: "Quero" e "QUERO" são a mesma).
 */
export function limparPalavras(lista: string[]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const bruta of lista) {
    const palavra = bruta.replace(/\s+/g, " ").trim().slice(0, 40);
    const chave = normalizar(palavra);
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(palavra);
  }
  return saida;
}
