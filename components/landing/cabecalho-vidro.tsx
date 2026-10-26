"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BotaoLink, Logo } from "@/components/ui";
import s from "./landing.module.css";

/**
 * Cabeçalho da landing (modelo: o do Manychat). No topo é transparente e ocupa a largura; a partir
 * de 50px de rolagem vira uma barra de vidro arredondada, que flutua e encolhe, e o nome recolhe
 * deixando só o ícone. As outras páginas continuam com o CabecalhoPublico.
 */
export function CabecalhoVidro({ testeDias }: { testeDias: number }) {
  const [rolou, setRolou] = useState(false);

  useEffect(() => {
    let quadro = 0;
    const mede = () => {
      quadro = 0;
      setRolou(scrollY >= 50);
    };
    const agenda = () => {
      if (!quadro) quadro = requestAnimationFrame(mede);
    };
    agenda();
    addEventListener("scroll", agenda, { passive: true });
    return () => {
      cancelAnimationFrame(quadro);
      removeEventListener("scroll", agenda);
    };
  }, []);

  return (
    <header className={s.cab} data-rolou={rolou ? "" : undefined}>
      <div className={s.cabBarra}>
        <Logo classeNome={s.cabNome} />
        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link href="/entrar" className="rounded-lg px-3 py-2 text-sm font-semibold text-suave hover:text-texto">
            Entrar
          </Link>
          <BotaoLink href="/cadastro" tamanho="sm">
            Teste {testeDias} dias grátis
          </BotaoLink>
        </nav>
      </div>
    </header>
  );
}
