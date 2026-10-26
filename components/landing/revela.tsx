"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { semMovimento } from "./movimento";
import s from "./landing.module.css";

/**
 * O título sobe e aparece quando entra na tela (uma vez só). Só esconde o que ainda está abaixo
 * da tela quando o JS já rodou: sem JS, ou com "reduzir movimento", o conteúdo fica sempre visível.
 */
export function Revela({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || semMovimento() || el.getBoundingClientRect().top < innerHeight * 0.9) return;
    el.setAttribute("data-oculto", "");
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.removeAttribute("data-oculto");
          obs.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${s.revela} ${className}`}>
      {children}
    </div>
  );
}
