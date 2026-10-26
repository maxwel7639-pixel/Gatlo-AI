"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui";
import s from "./landing.module.css";

const ATALHOS = [
  { href: "#cap-titulo", texto: "Como funciona" },
  { href: "#antes-depois", texto: "Antes e depois" },
  { href: "#limites", texto: "Limites" },
  { href: "#preco", texto: "Preço" },
];

/**
 * Cabeçalho da landing (modelo: o do Manychat). Fixo por cima do hero e recuado das bordas; no topo
 * é transparente, e a partir de 50px de rolagem o fundo assenta em vidro claro, o texto fica escuro
 * e o nome recolhe deixando só o ícone. As outras páginas continuam com o CabecalhoPublico.
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
        <Logo tamanho="sm" classeNome={s.cabNome} />
        <nav aria-label="Seções da página" className={s.cabLinks}>
          {ATALHOS.map((a) => (
            <a key={a.href} href={a.href}>
              {a.texto}
            </a>
          ))}
        </nav>
        <div className={s.cabAcoes}>
          <Link href="/cadastro" className={s.cabBotao}>
            {/* um span só: dentro do flex do botão, o espaço entre pedaços soltos some */}
            <span>
              Teste <span className="max-sm:hidden">{testeDias} dias </span>grátis
            </span>
          </Link>
          <Link href="/entrar" className={s.cabEntrar}>
            Entrar
          </Link>
        </div>
      </div>
    </header>
  );
}
