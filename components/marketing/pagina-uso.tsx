import Link from "next/link";
import { CASOS, type CasoId } from "@/lib/site-conteudo";
import { CabecalhoVidro } from "@/components/landing/cabecalho-vidro";
import { HeroConversa, Exemplos } from "./conversa-demo";
import { Beneficio, CasosDeUso, ComoComecar, Convite, FaixaEtapas, Perguntas, RodapeSite } from "./secoes";
import { IconeSeta } from "@/components/icones";
import l from "@/components/landing/landing.module.css";
import s from "./marketing.module.css";

export function PaginaUso({ caso }: { caso: CasoId }) {
  const c = CASOS[caso];
  return <div className={`${l.pagina} ${s.pagina}`}><CabecalhoVidro /><main><section className={s.hero}><div className={`${s.container} ${s.heroGrade}`}><div className={s.heroTexto}><p className={s.sobreTitulo}>Instagram / {c.nome}</p><h1>{c.titulo}</h1><p>{c.descricao}</p><div className={s.heroAcoes}><Link href="/cadastro" className={s.botao}>Começar meu teste<IconeSeta className="size-5" /></Link><Link href="#exemplos" className={s.linkTexto}>Ver o exemplo</Link></div><small className={s.heroNota}>Tu escolhe a mensagem. A Gatlo entrega o link.</small></div><HeroConversa caso={caso} /></div></section><FaixaEtapas /><Beneficio caso={caso} /><Exemplos inicial={caso} /><ComoComecar caso={caso} /><CasosDeUso atual={caso} /><Perguntas caso={caso} /><Convite /></main><RodapeSite /></div>;
}
