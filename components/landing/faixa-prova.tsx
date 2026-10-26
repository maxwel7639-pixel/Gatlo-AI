"use client";

import { useRef, useState } from "react";
import { IconeComentario, IconeOlho, IconePausa, IconePlay } from "@/components/icones";
import { useEsteira } from "./movimento";
import s from "./landing.module.css";

// Números reais dos Reels de palavra-chave do @maxwel_dev (métricas do Instagram reunidas em
// 23/10/2026, cérebro: arquivos/plano-de-acao-23-10-2026.md; os ~700 de um dia são de 13/10).
// Ainda não há cliente do Gatlo AI pra citar:
// a prova é a automação que virou o produto, no perfil de quem fez.
const PROVAS = [
  { palavra: "REPO", views: "89 mil views", pediram: "798 comentaram a palavra" },
  { palavra: "AÇÃO", views: "48 mil views", pediram: "599 comentaram a palavra" },
  { palavra: "REA", views: "29 mil views", pediram: "93 comentaram a palavra" },
  { palavra: "Num dia", views: "~700 comentários", pediram: "daí nasceu a fila com pausa" },
];

/**
 * Faixa de prova logo depois do hero (modelo: a faixa de depoimentos do Manychat): um rótulo
 * parado à esquerda e os números passando por baixo dele. Freia com o mouse em cima e tem pausa.
 * O leitor de tela recebe a lista parada, uma vez.
 */
export function FaixaProva() {
  const fita = useRef<HTMLDivElement>(null);
  const [pausada, setPausada] = useState(false);
  const [emCima, setEmCima] = useState(false);
  useEsteira(fita, "[data-trilho]", { voltaMs: 38000, reage: 0.4 });

  const itens = PROVAS.map((p) => (
    <li key={p.palavra} className={s.provaItem}>
      <span className={s.provaPalavra}>{p.palavra}</span>
      <span className={s.provaDado}>
        <IconeOlho className="size-4" /> {p.views}
      </span>
      <span className={s.provaDado}>
        <IconeComentario className="size-4" /> {p.pediram}
      </span>
    </li>
  ));

  return (
    <section className={s.prova} aria-labelledby="prova-titulo">
      <div className={s.provaRotulo}>
        <h2 id="prova-titulo">Testado no @maxwel_dev</h2>
        <p>Reels de palavra-chave, com a automação que virou o Gatlo AI.</p>
      </div>
      <ul className="sr-only">
        {PROVAS.map((p) => (
          <li key={p.palavra}>
            {p.palavra}: {p.views}, {p.pediram}.
          </li>
        ))}
      </ul>
      <div
        ref={fita}
        className={s.provaFita}
        data-parado={pausada || emCima ? "" : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && setEmCima(true)}
        onPointerLeave={() => setEmCima(false)}
      >
        <div className={s.provaJanela} aria-hidden="true">
          <div className={s.trilhoFita} data-trilho>
            <ul className={s.grupo}>{itens}</ul>
            <ul className={s.grupo}>{itens}</ul>
          </div>
        </div>
        <button
          type="button"
          className={s.provaPausa}
          aria-pressed={pausada}
          aria-label={pausada ? "Continuar a faixa de resultados" : "Pausar a faixa de resultados"}
          onClick={() => setPausada((v) => !v)}
        >
          {pausada ? <IconePlay className="size-4" /> : <IconePausa className="size-4" />}
        </button>
      </div>
    </section>
  );
}
