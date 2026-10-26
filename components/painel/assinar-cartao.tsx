"use client";

import { useActionState } from "react";
import { assinarCartao, type EstadoAssinatura } from "@/lib/acoes";
import { Aviso, classeBotao } from "../ui";

const inicial: EstadoAssinatura = {};

/**
 * O botão de assinar no cartão. O clique manda pro SERVIDOR (a ação lê o preço
 * em `regras` e abre o checkout do Mercado Pago); aqui só mostramos o erro, se
 * houver. Quem decide quando mostrar (assinatura ainda não ativa, fora da
 * demonstração) é a página, que põe este bloco ao lado do Pix.
 */
export function AssinarCartao({ preco, deNovo = false }: { preco: string; deNovo?: boolean }) {
  const [estado, acao, enviando] = useActionState(assinarCartao, inicial);

  return (
    <form action={acao} className="flex flex-col justify-between gap-4 rounded-xl bg-superficie-2 px-4 py-4">
      <p className="text-sm text-suave">
        <strong className="text-texto">{preco}</strong> por mês, no cartão, pelo Mercado Pago. Cancela aqui mesmo, quando quiser.
      </p>
      <div>
        <button type="submit" disabled={enviando} className={classeBotao("primario", "sm")}>
          {enviando ? "Abrindo o checkout…" : deNovo ? "Assinar de novo no cartão" : "Assinar com cartão"}
        </button>
        {estado.erro ? <div className="mt-3"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
      </div>
    </form>
  );
}
