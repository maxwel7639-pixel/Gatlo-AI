import { limparPalavras } from "./palavras";

/**
 * Lê e confere o formulário de automação. Os limites são os mesmos das
 * checagens da tabela `automacoes` (0001_esquema.sql): o banco recusaria de
 * qualquer jeito, mas aqui a pessoa recebe a mensagem certa em português.
 */
export const LIMITES = {
  nome: 80,
  palavras: 10,
  palavra: 40,
  mensagem: 640, // texto do modelo de botão da Meta
  link: 2000,
  titulo: 20, // título do botão
  resposta: 300,
} as const;

export type FormAutomacao = {
  nome: string;
  qualquerPost: boolean;
  mediaId: string | null;
  palavras: string[];
  mensagemDm: string;
  linkUrl: string;
  linkTitulo: string;
  respostaPublica: string | null;
  ativa: boolean;
};

export type Erros = Partial<Record<keyof FormAutomacao | "geral", string>>;

function linkValido(bruto: string): string | null {
  let texto = bruto.trim();
  if (!texto) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(texto)) texto = `https://${texto}`;
  try {
    const u = new URL(texto);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    if (/\s/.test(texto) || texto.length > LIMITES.link) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function lerFormulario(form: FormData): { dados: FormAutomacao; erros: Erros } {
  const texto = (k: string) => String(form.get(k) ?? "").trim();
  const erros: Erros = {};

  const qualquerPost = form.get("alvo") === "qualquer";
  const mediaId = qualquerPost ? null : texto("mediaId") || null;
  if (!qualquerPost && !mediaId) erros.mediaId = "Escolhe um post ou marca \"qualquer post\".";

  const palavras = limparPalavras(form.getAll("palavras").map(String));
  if (!palavras.length) erros.palavras = "Coloca pelo menos uma palavra.";
  else if (palavras.length > LIMITES.palavras) erros.palavras = `No máximo ${LIMITES.palavras} palavras.`;

  const mensagemDm = texto("mensagemDm");
  if (!mensagemDm) erros.mensagemDm = "Escreve a mensagem da DM.";
  else if (mensagemDm.length > LIMITES.mensagem) erros.mensagemDm = `No máximo ${LIMITES.mensagem} caracteres.`;

  const linkBruto = texto("linkUrl");
  const linkUrl = linkValido(linkBruto);
  if (!linkUrl) erros.linkUrl = "Esse link não parece certo. Exemplo: https://teusite.com.br/oferta";

  const linkTitulo = texto("linkTitulo");
  if (!linkTitulo) erros.linkTitulo = "Escreve o texto do botão.";
  else if (linkTitulo.length > LIMITES.titulo) erros.linkTitulo = `No máximo ${LIMITES.titulo} caracteres.`;

  const responder = form.get("responder") === "on";
  const respostaPublica = responder ? texto("respostaPublica") || null : null;
  if (responder && !respostaPublica) erros.respostaPublica = "Escreve a resposta ou desliga essa opção.";
  else if (respostaPublica && respostaPublica.length > LIMITES.resposta) {
    erros.respostaPublica = `No máximo ${LIMITES.resposta} caracteres.`;
  }

  const nome = (texto("nome") || (palavras[0] ? `Palavra ${palavras[0].toUpperCase()}` : "Automação")).slice(
    0,
    LIMITES.nome,
  );

  return {
    dados: {
      nome,
      qualquerPost,
      mediaId,
      palavras,
      mensagemDm,
      linkUrl: linkUrl ?? linkBruto,
      linkTitulo,
      respostaPublica,
      ativa: form.get("ativa") === "on",
    },
    erros,
  };
}
