import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// Só páginas públicas que valem aparecer no Google. Entrar, recuperar senha e painel ficam de fora.
const PAGINAS: { caminho: string; prioridade: number }[] = [
  { caminho: "", prioridade: 1 },
  { caminho: "/produto/instagram", prioridade: 0.9 },
  { caminho: "/solucoes/materiais-gratuitos", prioridade: 0.8 },
  { caminho: "/solucoes/catalogo", prioridade: 0.8 },
  { caminho: "/solucoes/agendamentos", prioridade: 0.8 },
  { caminho: "/cadastro", prioridade: 0.6 },
  { caminho: "/termos", prioridade: 0.3 },
  { caminho: "/privacidade", prioridade: 0.3 },
  { caminho: "/exclusao-de-dados", prioridade: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const agora = new Date();
  return PAGINAS.map(({ caminho, prioridade }) => ({
    url: `${SITE_URL}${caminho}`,
    lastModified: agora,
    priority: prioridade,
  }));
}
