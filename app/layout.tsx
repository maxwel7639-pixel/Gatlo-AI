import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { PRODUTO, SITE_URL } from "@/lib/config";
import { SCRIPT_TEMA } from "@/lib/tema";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

const DESCRICAO =
  "Quem comentar a palavra no teu post recebe o link na DM, sozinho, numa fila que respeita o limite do Instagram. Teste 7 dias grátis.";

const TITULO = `${PRODUTO.nome}: automação de comentário para DM no Instagram`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITULO, template: `%s · ${PRODUTO.nome}` },
  description: DESCRICAO,
  applicationName: PRODUTO.nome,
  creator: PRODUTO.empresa,
  // "./" vira o endereço de cada página, não o da home
  alternates: { canonical: "./" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: PRODUTO.nome,
    title: TITULO,
    description: DESCRICAO,
  },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRICAO },
  // Código do Google Search Console (método "tag HTML"); sem a variável, não sai nada.
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: o painel põe data-tema no <html> antes do React hidratar
    <html lang="pt-BR" suppressHydrationWarning className={`${figtree.variable} h-full antialiased`}>
      <head>
        {/* no layout raiz porque ele não re-renderiza na navegação: script em página não roda no cliente */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
