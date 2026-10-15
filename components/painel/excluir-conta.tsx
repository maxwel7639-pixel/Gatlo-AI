"use client";

import { useActionState, useState } from "react";
import { excluirConta, type EstadoExclusao } from "@/lib/acoes";
import { Aviso, classeBotao, classeEntrada } from "../ui";

const inicial: EstadoExclusao = {};

export function ExcluirConta() {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState(excluirConta, inicial);

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={classeBotao("perigo", "sm")}>
        Excluir minha conta
      </button>
    );
  }
  return (
    <form action={acao} className="space-y-3 rounded-xl border border-vermelho/30 bg-vermelho/5 p-4">
      <p className="text-sm leading-relaxed">
        Isso apaga <strong>agora</strong> o cadastro, a conexão com o Instagram, as automações, os comentários e os
        cliques. Não dá pra desfazer. Digita <strong>EXCLUIR</strong> pra confirmar.
      </p>
      <input name="confirmacao" autoComplete="off" className={classeEntrada} aria-label="Confirmação" />
      {estado.erro ? <Aviso tipo="erro">{estado.erro}</Aviso> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={enviando} className={classeBotao("perigo", "sm")}>
          {enviando ? "Excluindo…" : "Excluir de vez"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={classeBotao("fantasma", "sm")}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
