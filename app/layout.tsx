import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { PRODUTO, SITE_URL } from "@/lib/config";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

const DESCRICAO =
  "Quem comentar a palavra no teu post recebe o link na DM, sozinho, numa fila que respeita o limite do Instagram. Teste 7 dias grátis.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${PRODUTO.nome}: comentou a palavra, recebeu o link na DM`,
    template: `%s · ${PRODUTO.nome}`,
  },
  description: DESCRICAO,
  applicationName: PRODUTO.nome,
  creator: PRODUTO.empresa,
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: PRODUTO.nome,
    title: `${PRODUTO.nome}: comentou a palavra, recebeu o link na DM`,
    description: DESCRICAO,
  },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${figtree.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
