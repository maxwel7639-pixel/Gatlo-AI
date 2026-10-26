import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { CabecalhoVidro } from "@/components/landing/cabecalho-vidro";
import { Exemplos } from "@/components/marketing/conversa-demo";
import { FotoInstagram, RecursosInstagram } from "@/components/marketing/instagram-vitrine";
import { CasosDeUso, ComoComecar, Convite, FaixaEtapas, Perguntas, RodapeSite } from "@/components/marketing/secoes";
import { IconeCheck, IconeComentario, IconeInstagram, IconeSeta } from "@/components/icones";
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
    <section className={s.igHero}><div className={s.igHeroDentro}><p className={s.sobreTitulo}>Gatlo para Instagram</p><h1>Teu Instagram<br />trabalha contigo.</h1><p className={s.igHeroDescricao}>Envia teu link, responde o comentário e acompanha os cliques. Com menos tarefa repetida, sobra espaço pra tu continuar a conversa.</p><div className={s.igHeroBase}><div className={s.heroAcoes}><Link href="/cadastro" className={s.botaoClaro}>Começar meu teste<IconeSeta className="size-5" /></Link><Link href="#como-funciona" className={s.linkTexto}>Ver como funciona</Link></div><ul className={s.igHeroSelos}><li><IconeInstagram /><span>Conta profissional<br /><b>do Instagram</b></span></li><li><IconeComentario /><span>A mensagem<br /><b>é do teu jeito</b></span></li><li><IconeCheck /><span>Envios<br /><b>organizados em fila</b></span></li></ul></div></div></section>
    <FotoInstagram /><FaixaEtapas />
    <section className={s.igIntroducao}><IconeInstagram className="size-14" /><h2>Menos tarefa no direct.<br />Mais tempo pra criar.</h2><p>Teu conteúdo já despertou o interesse. A Gatlo cuida de entregar o link pra quem pediu, e tu segue com a conversa.</p></section>
    <RecursosInstagram />
    <Exemplos variante="instagram" /><CasosDeUso /><ComoComecar /><Perguntas /><Convite />
  </main><RodapeSite /></div>;
}
