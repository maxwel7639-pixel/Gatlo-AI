import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { CabecalhoVidro } from "@/components/landing/cabecalho-vidro";
import { AntesDepois } from "@/components/landing/antes-depois";
import { HeroConversa, HistoriaProduto, Exemplos } from "@/components/marketing/conversa-demo";
import { CasosDeUso, ComoComecar, Convite, FaixaEtapas, Perguntas, RodapeSite } from "@/components/marketing/secoes";
import { IconeInstagram, IconeSeta } from "@/components/icones";
import l from "@/components/landing/landing.module.css";
import s from "@/components/marketing/marketing.module.css";

export const metadata: Metadata = {
  title: "Automação para Instagram",
  description: "Transforma um comentário no próximo passo: a Gatlo entrega teu link na DM, organiza os envios e mostra os cliques.",
  alternates: { canonical: "/produto/instagram" },
};
export const viewport: Viewport = { themeColor: "#1e50f0", colorScheme: "light" };

export default function Instagram() {
  return <div className={`${l.pagina} ${s.pagina}`}><CabecalhoVidro claroNoTopo /><main>
    <section className={`${s.hero} ${s.heroAzul}`}><div className={`${s.container} ${s.heroGrade}`}><div className={s.heroTexto}><p className={`${s.sobreTitulo} flex items-center gap-2`}><IconeInstagram className="size-5" /> Gatlo para Instagram</p><h1>Teu conteúdo abre a conversa.</h1><p>Quem comenta a palavra recebe teu link no direct. A Gatlo cuida da entrega e tu segue com o que mais importa: a conversa.</p><div className={s.heroAcoes}><Link href="/cadastro" className={s.botaoClaro}>Começar meu teste<IconeSeta className="size-5" /></Link><Link href="#como-funciona" className={s.linkTexto}>Ver como funciona</Link></div><small className={s.heroNota}>Para contas profissionais do Instagram.</small></div><HeroConversa /></div></section>
    <FaixaEtapas /><HistoriaProduto />
    <section id="antes-depois" aria-labelledby="titulo-antes-depois"><h2 id="titulo-antes-depois" className="sr-only">Teu direct, antes e depois</h2><AntesDepois /></section>
    <Exemplos /><CasosDeUso /><ComoComecar /><Perguntas /><Convite />
  </main><RodapeSite /></div>;
}
