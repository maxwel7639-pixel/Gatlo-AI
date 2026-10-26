import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { CASOS, CASO_IDS, type CasoId } from "@/lib/site-conteudo";
import { PaginaUso } from "@/components/marketing/pagina-uso";

type Props = { params: Promise<{ uso: string }> };
function casoValido(uso: string): uso is CasoId { return Object.hasOwn(CASOS, uso); }
export const dynamicParams = false;
export const viewport: Viewport = { themeColor: "#e7e9ee", colorScheme: "light" };
export function generateStaticParams() { return CASO_IDS.map(uso => ({ uso })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uso } = await params;
  if (!casoValido(uso)) notFound();
  return { title: CASOS[uso].nome, description: CASOS[uso].descricao, alternates: { canonical: `/solucoes/${uso}` } };
}
export default async function Solucao({ params }: Props) {
  const { uso } = await params;
  if (!casoValido(uso)) notFound();
  return <PaginaUso caso={uso} />;
}
