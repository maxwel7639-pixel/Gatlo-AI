"use client";

import { useRef } from "react";
import { useRolagemNoCss } from "./movimento";
import s from "./landing.module.css";

// As palavras que as pessoas comentam pra pedir o link. Apagadas, viram textura atrás do hero.
const PALAVRAS = ["QUERO", "RECEITA", "LINK", "EU QUERO", "AULA", "PDF", "CUPOM", "ROTEIRO", "MANDA"];

// Cada fileira começa num ponto e anda num sentido, numa velocidade (px de faixa por px rolado).
const FILEIRAS = [
  { inicio: "-8vw", vel: -0.35, contorno: false, desloca: 0 },
  { inicio: "-46vw", vel: 0.28, contorno: true, desloca: 3 },
  { inicio: "-22vw", vel: -0.22, contorno: false, desloca: 6 },
];

// Cada fileira repete as palavras até passar da tela mais larga, mesmo depois de andar.
const REPETE = 3;

export function PalavrasFundo() {
  const raiz = useRef<HTMLDivElement>(null);
  useRolagemNoCss(raiz);

  return (
    <div ref={raiz} className={s.palavras} aria-hidden="true">
      {FILEIRAS.map((f, i) => {
        const ordem = [...PALAVRAS.slice(f.desloca), ...PALAVRAS.slice(0, f.desloca)];
        return (
          <p
            key={i}
            className={`${s.palavrasLinha} ${f.contorno ? s.palavrasContorno : ""}`}
            style={{ "--inicio": f.inicio, "--vel": f.vel } as React.CSSProperties}
          >
            {Array.from({ length: REPETE }, () => ordem)
              .flat()
              .map((p, n) => (
                <span key={n}>{p}</span>
              ))}
          </p>
        );
      })}
    </div>
  );
}
