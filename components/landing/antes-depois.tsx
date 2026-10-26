"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { IconeCheck, IconeX } from "@/components/icones";
import { semMovimento } from "./movimento";
import s from "./landing.module.css";

const SEM = [
  "Responde comentário por comentário, à mão.",
  "Quem comentou de madrugada fica sem o link.",
  "Viralizou? Centenas de comentários e nenhuma mão a mais.",
  "Mandou muito de uma vez e o Instagram travou a conta.",
  "Não sabe quem recebeu nem quem abriu o link.",
];

const COM = [
  "O link chega na DM de quem comentou, sozinho.",
  "Funciona de madrugada e no fim de semana.",
  "A fila manda no ritmo do Instagram e pausa quando ele pede.",
  "Resposta no comentário, se tu quiser.",
  "Tu vê quem recebeu e quem clicou.",
];

/**
 * Antes e depois (modelo: "Your inbox: a before & after" do Manychat). No computador, o trilho
 * prende os dois cartões e a rolagem (--p, de 0 a 1) junta os dois: o "sem" encolhe e anda pra
 * direita, o "com" anda pra esquerda e fica por cima; no fim, um laço é desenhado em volta do
 * título do "com". No telefone os cartões ficam um embaixo do outro, já com o laço.
 * A frase do título vira marca d'água atrás deles; o h2 de verdade fica na página, só pra leitor de tela.
 */
export function AntesDepois({ testeDias }: { testeDias: number }) {
  const trilho = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = trilho.current;
    if (!el || semMovimento()) return;
    let quadro = 0;
    const mede = () => {
      quadro = 0;
      const topo = 64;
      const r = el.getBoundingClientRect();
      const percurso = Math.max(1, r.height - (innerHeight - topo));
      const p = Math.min(1, Math.max(0, (topo - r.top) / percurso));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const agenda = () => {
      if (!quadro) quadro = requestAnimationFrame(mede);
    };
    agenda();
    addEventListener("scroll", agenda, { passive: true });
    addEventListener("resize", agenda);
    return () => {
      cancelAnimationFrame(quadro);
      removeEventListener("scroll", agenda);
      removeEventListener("resize", agenda);
    };
  }, []);

  return (
    <div ref={trilho} className={s.adTrilho}>
      <div className={s.adPalco}>
        <p className={s.adMarca} aria-hidden="true">
          <span>Teu direct:</span>
          <span>antes e depois</span>
        </p>

        <div className={`${s.adCartao} ${s.adSem}`}>
          <p className={s.adRotulo}>Sem o Gatlo AI</p>
          <h3 className={s.adTitulo}>Tudo na mão</h3>
          <ul className={s.adLista}>
            {SEM.map((t) => (
              <li key={t}>
                <IconeX className="size-4 shrink-0 text-vermelho" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className={`${s.adCartao} ${s.adCom}`}>
          <p className={s.adRotulo}>Com o Gatlo AI</p>
          <h3 className={`${s.adTitulo} ${s.adTituloLaco}`}>
            O link vai sozinho
            {/* largo como o título: estica junto com ele (preserveAspectRatio none) */}
            <svg className={s.laco} viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M44 72 C 30 22, 300 4, 524 20 C 604 28, 598 94, 500 106 C 340 124, 74 118, 32 80 C 14 60, 86 30, 160 24"
                pathLength={1}
              />
            </svg>
          </h3>
          <ul className={s.adLista}>
            {COM.map((t) => (
              <li key={t}>
                <IconeCheck className="size-4 shrink-0" />
                {t}
              </li>
            ))}
          </ul>
          <Link href="/cadastro" className={s.adBotao}>
            Teste {testeDias} dias grátis
          </Link>
        </div>
      </div>
    </div>
  );
}
