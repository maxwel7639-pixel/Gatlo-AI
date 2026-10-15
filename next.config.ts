import type { NextConfig } from "next";

const emDesenvolvimento = process.env.NODE_ENV !== "production";

/**
 * Política de conteúdo (CSP).
 *
 * Não é a CSP perfeita (essa exige nonce por requisição), mas fecha o que mais
 * importa num painel com login:
 * - script só do próprio site (o 'unsafe-inline' é pela hidratação do Next);
 * - o navegador só conversa com o próprio site (connect-src): um script
 *   injetado não consegue mandar dado pra fora;
 * - imagem só do próprio site e das CDNs do Instagram (as miniaturas dos posts);
 * - ninguém embute o painel num iframe (frame-ancestors).
 *
 * Em desenvolvimento o Next precisa de eval e de websocket pro recarregamento.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${emDesenvolvimento ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.cdninstagram.com https://*.fbcdn.net",
  "font-src 'self'",
  `connect-src 'self'${emDesenvolvimento ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Cabeçalhos de segurança (mesmo padrão do Fisga, mais a CSP acima).
 * Nenhum muda o que o app faz: todos fecham comportamento padrão do navegador.
 */
const CABECALHOS = [
  { key: "Content-Security-Policy", value: CSP },
  // Versão antiga do frame-ancestors, pra navegador velho.
  { key: "X-Frame-Options", value: "DENY" },
  // Não deixa o navegador "adivinhar" tipo de arquivo.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Link que sai do painel leva só o domínio, não o caminho inteiro.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // O Gatilho não usa câmera, microfone, localização nem pagamento do navegador.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Só HTTPS, por 2 anos, incluindo subdomínios.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Sem o otimizador de imagem do Next: as miniaturas vêm prontas da CDN do
  // Instagram (ou são SVG gerado aqui no modo demonstração), e o otimizador já
  // teve falhas graves publicadas (ver a análise de segurança do Fisga).
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:caminho*", headers: CABECALHOS }];
  },
};

export default nextConfig;
