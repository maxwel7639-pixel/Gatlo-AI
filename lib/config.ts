/**
 * O NOME DO PRODUTO MORA AQUI, E SÓ AQUI.
 *
 * "Gatilho" é provisório. Pra trocar, muda `nome` (e, se quiser, `slogan`)
 * neste arquivo: telas, títulos, e-mails de texto e páginas legais leem daqui.
 * O que NÃO sai daqui: o nome do repositório, do pacote (package.json) e das
 * tabelas do banco, que não aparecem pra ninguém.
 */
export const PRODUTO = {
  nome: "Gatilho",
  slogan: "Comentou a palavra, recebeu o link na DM.",
  empresa: "MX Digital",
  // Aparece nas páginas de termos, privacidade e exclusão de dados.
  emailSuporte: process.env.NEXT_PUBLIC_EMAIL_SUPORTE || "contato@mxdigital.ia.br",
  cidade: "Lajeado/RS",
} as const;

/**
 * Endereço público do site, sem barra no fim. Precisa ser ABSOLUTO: vai no
 * redirect do login do Instagram, no link curto que sai na DM e nos metadados.
 *
 * Ordem: o que o Maxwel configurar > o domínio de produção que a Vercel injeta
 * sozinha > localhost (desenvolvimento).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000")
).replace(/\/+$/, "");
