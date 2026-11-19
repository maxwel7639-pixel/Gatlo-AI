"use client";

import { CHAVE_TEMA as CHAVE } from "@/lib/tema";
import { IconeLua, IconeSol } from "../icones";

function escuroAgora() {
  const t = document.documentElement.dataset.tema;
  return t ? t === "escuro" : matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Troca claro/escuro. Qual ícone aparece é decidido no CSS (navegacao-apple.css),
 * então o botão não precisa de estado e não pisca na hidratação.
 */
export function AlternarTema({ className = "" }: { className?: string }) {

  function trocar() {
    const novo = escuroAgora() ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    try {
      localStorage.setItem(CHAVE, novo);
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={trocar}
      className={`gatlo-tema flex items-center gap-3 rounded-lg text-suave hover:bg-superficie-2 hover:text-texto ${className}`}
    >
      <span className="gatlo-tema-ir-escuro contents">
        <IconeLua className="size-5 shrink-0" />
        <span className="gatlo-lateral-texto text-sm font-semibold">Tema escuro</span>
      </span>
      <span className="gatlo-tema-ir-claro contents">
        <IconeSol className="size-5 shrink-0" />
        <span className="gatlo-lateral-texto text-sm font-semibold">Tema claro</span>
      </span>
    </button>
  );
}
