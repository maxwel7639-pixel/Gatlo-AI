"use client";

import { useEffect } from "react";

/**
 * A luz azul que segue o mouse (a mesma do site do Clientaê). Um ouvinte só pra página inteira:
 * todo elemento com data-luz que está sob o mouse recebe --lx/--ly em px, relativos a ele, e o
 * atributo data-luz-ativa. Quem acende é o CSS: a borda dos cartões e a palavra do rodapé.
 * No celular não existe mouse: um toque leva a luz até o dedo.
 */
export function LuzDoCursor() {
  useEffect(() => {
    const fino = matchMedia("(hover: hover) and (pointer: fine)").matches;
    let x = -1;
    let y = -1;
    let quadro = 0;
    let acesos = new Set<HTMLElement>();

    const aplica = () => {
      quadro = 0;
      const agora = new Set<HTMLElement>();
      for (let el = document.elementFromPoint(x, y) as HTMLElement | null; el; el = el.parentElement) {
        if (!el.hasAttribute("data-luz")) continue;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--lx", `${(x - r.left).toFixed(1)}px`);
        el.style.setProperty("--ly", `${(y - r.top).toFixed(1)}px`);
        agora.add(el);
      }
      for (const el of acesos) if (!agora.has(el)) el.removeAttribute("data-luz-ativa");
      for (const el of agora) if (!acesos.has(el)) el.setAttribute("data-luz-ativa", "");
      acesos = agora;
    };
    const agenda = () => {
      if (x >= 0 && !quadro) quadro = requestAnimationFrame(aplica);
    };
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      agenda();
    };
    // o mouse saiu da janela: tudo apaga
    const sai = (e: MouseEvent) => {
      if (e.relatedTarget) return;
      x = y = -1;
      for (const el of acesos) el.removeAttribute("data-luz-ativa");
      acesos = new Set();
    };

    if (fino) {
      addEventListener("pointermove", move, { passive: true });
      // a página rola por baixo do mouse parado: o que está sob ele muda
      addEventListener("scroll", agenda, { passive: true });
      document.addEventListener("mouseout", sai);
    } else {
      addEventListener("pointerdown", move, { passive: true });
    }
    return () => {
      cancelAnimationFrame(quadro);
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", move);
      removeEventListener("scroll", agenda);
      document.removeEventListener("mouseout", sai);
    };
  }, []);

  return null;
}
