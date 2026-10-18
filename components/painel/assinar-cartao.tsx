"use client";

import { useActionState } from "react";
import { assinarCartao, type EstadoAssinatura } from "@/lib/acoes";
import { Aviso, classeBotao } from "../ui";

const inicial: EstadoAssinatura = {};

/**
 * O botão de assinar no cartão. O clique manda pro SERVIDOR (a ação lê o preço
 * em `regras` e abre o checkout do Mercado Pago); aqui só mostramos o erro, se
 * houver. Assinatura já ativa: não fica pedindo de novo.
 */
export function AssinarCartao({ preco, ativa }: { preco: string; ativa: boolean }) {
  const [estado, acao, enviando] = useActionState(assinarCartao, inicial);

  if (ativa) return null;

  return (
    <form action={acao} className="mt-5 rounded-xl bg-superficie-2 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-suave">
          Assinatura de <strong>{preco}</strong> por mês, no cartão, pelo Mercado Pago. Cancela quando quiser.
        </p>
        <button type="submit" disabled={enviando} className={classeBotao("primario", "sm")}>
          {enviando ? "Abrindo o checkout…" : "Assinar com cartão"}
        </button>
      </div>
      {estado.erro ? <div className="mt-3"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
    </form>
  );
}
