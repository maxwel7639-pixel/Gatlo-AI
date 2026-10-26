"use client";

import { useEffect, type RefObject } from "react";

/**
 * Movimento da landing, no mesmo jeito do site do Clientaê (lib/rolagem.ts e lib/esteira.ts de lá):
 * nada de biblioteca, um quadro por vez (requestAnimationFrame) e nada roda fora da tela.
 * Com "reduzir movimento" ligado no aparelho, nada anda: a página nasce no estado final.
 */
export const semMovimento = () =>
  typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Esteira sem fim. O trilho (o que casa com `seletor` dentro de `raiz`) leva dois grupos iguais
 * lado a lado e anda a largura de um grupo antes de voltar pro zero, então a volta não tem corte.
 * Rolar a página acelera a esteira; com o mouse em cima (ou o botão de pausa) a raiz ganha
 * data-parado e a esteira freia até parar, sem tranco.
 */
export function useEsteira(
  raiz: RefObject<HTMLElement | null>,
  seletor: string,
  { voltaMs = 45000, reage = 0.6 }: { voltaMs?: number; reage?: number } = {},
) {
  useEffect(() => {
    const el = raiz.current;
    if (!el || semMovimento()) return;
    const trilho = el.querySelector<HTMLElement>(seletor);
    const grupo = trilho?.firstElementChild as HTMLElement | null;
    if (!trilho || !grupo) return;

    let largura = grupo.offsetWidth;
    const mede = new ResizeObserver(() => {
      largura = grupo.offsetWidth;
    });
    mede.observe(grupo);

    let x = 0;
    let quadro = 0;
    let antes = 0;
    let ultimoY = scrollY;
    let rolagem = 0; // velocidade da rolagem, suavizada (px por ms)
    let marcha = 1; // 1 andando, 0 parada; muda aos poucos

    const passo = (agora: number) => {
      const dt = Math.min(64, agora - (antes || agora));
      antes = agora;
      const bruta = dt > 0 ? (scrollY - ultimoY) / dt : 0;
      ultimoY = scrollY;
      rolagem += (bruta - rolagem) * 0.12;
      marcha += ((el.hasAttribute("data-parado") ? 0 : 1) - marcha) * 0.08;

      const acelera = 1 + Math.min(Math.abs(rolagem) * reage * 4, 6);
      x += (largura / voltaMs) * acelera * marcha * dt;
      if (largura > 0) x %= largura;
      trilho.style.transform = `translate3d(${(-x).toFixed(2)}px,0,0)`;
      quadro = requestAnimationFrame(passo);
    };

    const obs = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(quadro);
      if (e.isIntersecting) {
        antes = 0;
        ultimoY = scrollY;
        quadro = requestAnimationFrame(passo);
      }
    });
    obs.observe(el);

    return () => {
      cancelAnimationFrame(quadro);
      obs.disconnect();
      mede.disconnect();
    };
  }, [raiz, seletor, voltaMs, reage]);
}

/**
 * Escreve a rolagem da página em --rolagem (px, sem unidade) no elemento, enquanto ele está na
 * tela. As palavras gigantes do topo andam com isso pelo CSS: elas só se mexem quando a pessoa
 * rola, nunca sozinhas.
 */
export function useRolagemNoCss(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || semMovimento()) return;
    let quadro = 0;
    const aplica = () => {
      quadro = 0;
      el.style.setProperty("--rolagem", scrollY.toFixed(1));
    };
    const agenda = () => {
      if (!quadro) quadro = requestAnimationFrame(aplica);
    };
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        addEventListener("scroll", agenda, { passive: true });
        agenda();
      } else removeEventListener("scroll", agenda);
    });
    obs.observe(el);
    return () => {
      cancelAnimationFrame(quadro);
      obs.disconnect();
      removeEventListener("scroll", agenda);
    };
  }, [ref]);
}
