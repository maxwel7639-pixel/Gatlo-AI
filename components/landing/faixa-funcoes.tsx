"use client";

import { useRef, useState } from "react";
import {
  IconeCadeado,
  IconeComentario,
  IconeEnvio,
  IconeFila,
  IconeGrade,
  IconeInstagram,
  IconeLink,
  IconePausa,
  IconePlay,
  IconeRelogio,
} from "@/components/icones";
import { useEsteira } from "./movimento";
import s from "./landing.module.css";

/**
 * Faixa de vidro inclinada com as funções passando sem fim (a mesma ideia da faixa de telas do
 * Clientaê). Freia com o mouse em cima, tem botão de pausa e a rolagem da página acelera.
 * A fita que anda é só visual (aria-hidden): o leitor de tela recebe a lista parada, uma vez.
 */
export function FaixaFuncoes({ porHora, testeDias }: { porHora: number; testeDias: number }) {
  const fita = useRef<HTMLDivElement>(null);
  const [pausada, setPausada] = useState(false);
  const [emCima, setEmCima] = useState(false);
  useEsteira(fita, "[data-trilho]");

  const funcoes = [
    { Icone: IconeInstagram, nome: "Login oficial", texto: "a gente nunca vê tua senha" },
    { Icone: IconeComentario, nome: "Palavra sem frescura", texto: "QUERO e quero contam igual" },
    { Icone: IconeGrade, nome: "Um post ou todos", texto: "tu escolhe onde vale" },
    { Icone: IconeEnvio, nome: "Uma DM por comentário", texto: "com botão pro teu link" },
    { Icone: IconeFila, nome: "Fila com ritmo", texto: `até uns ${porHora} por hora` },
    { Icone: IconePausa, nome: "Pausa sozinho", texto: "quando o Instagram pede" },
    { Icone: IconeLink, nome: "Cliques contados", texto: "tu vê quem abriu o link" },
    { Icone: IconeRelogio, nome: `${testeDias} dias grátis`, texto: "sem cartão no teste" },
    { Icone: IconeCadeado, nome: "Cartão ou Pix Automático", texto: "cancela quando quiser" },
  ];

  const itens = funcoes.map(({ Icone, nome, texto }) => (
    <li key={nome} className={s.item}>
      <span className={s.itemIcone}>
        <Icone className="size-[18px]" />
      </span>
      <span className={s.itemNome}>{nome}</span>
      <span className={s.itemTexto}>{texto}</span>
    </li>
  ));

  return (
    <section className={s.faixa} aria-labelledby="funcoes-titulo">
      <h2 id="funcoes-titulo" className="sr-only">
        O que vem no Gatlo AI
      </h2>
      <ul className="sr-only">
        {funcoes.map(({ nome, texto }) => (
          <li key={nome}>
            {nome}: {texto}
          </li>
        ))}
      </ul>
      <div className={s.faixaLuz} aria-hidden="true" />
      <div
        ref={fita}
        className={s.fita}
        data-parado={pausada || emCima ? "" : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && setEmCima(true)}
        onPointerLeave={() => setEmCima(false)}
      >
        <div className={s.janela} aria-hidden="true">
          <div className={s.trilhoFita} data-trilho>
            <ul className={s.grupo}>{itens}</ul>
            <ul className={s.grupo}>{itens}</ul>
          </div>
        </div>
        <button
          type="button"
          className={s.pausa}
          aria-pressed={pausada}
          aria-label={pausada ? "Continuar a faixa de funções" : "Pausar a faixa de funções"}
          onClick={() => setPausada((p) => !p)}
        >
          {pausada ? <IconePlay className="size-[18px]" /> : <IconePausa className="size-[18px]" />}
        </button>
      </div>
    </section>
  );
}
