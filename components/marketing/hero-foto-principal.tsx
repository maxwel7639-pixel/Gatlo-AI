import Image from "next/image";
import { HeroBolhas } from "@/components/landing/hero-bolhas";
import s from "./marketing.module.css";

export function HeroFotoPrincipal() {
  return <div className={s.fotoPrincipal}><div className={s.fotoPrincipalMoldura}><Image src="/landing/principal-criador.webp" alt="Empreendedor acompanhando seu celular em um estúdio criativo. Imagem ilustrativa gerada por IA." fill sizes="(max-width: 1023px) 100vw, 50vw" loading="eager" /></div><HeroBolhas /><span className={s.fotoPrincipalLegenda}>Conversa de demonstração</span></div>;
}
