"use client";

import { useActionState, useState } from "react";
import { assinarPix, type EstadoPix } from "@/lib/acoes";
import { Aviso, Campo, classeBotao, classeEntrada } from "../ui";

const inicial: EstadoPix = {};

/**
 * O botão de assinar no Pix Automático. O clique manda o CPF/CNPJ pro SERVIDOR
 * (a ação lê o preço em `regras` e abre a autorização no Asaas); a resposta é o
 * QR Code do 1º pagamento, que também autoriza o débito dos meses seguintes. Este
 * bloco não libera nada: o robô só liga quando o Asaas confirma o pagamento.
 */
export function AssinarPix({ preco, deNovo = false }: { preco: string; deNovo?: boolean }) {
  const [estado, acao, enviando] = useActionState(assinarPix, inicial);
  const [copiado, setCopiado] = useState(false);

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      setCopiado(false); // sem permissão de área de transferência: o campo ao lado deixa copiar na mão
    }
  }

  if (estado.pix) {
    return (
      <div className="rounded-xl bg-superficie-2 px-4 py-4 sm:col-span-2">
        <p className="text-sm font-semibold">Paga este Pix e autoriza o débito automático no app do teu banco</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR Code em base64 devolvido pelo Asaas */}
          <img
            src={`data:image/png;base64,${estado.pix.imagem}`}
            alt="QR Code do Pix da assinatura"
            className="size-44 shrink-0 rounded-lg bg-white p-2"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor="pix-copia-e-cola" className="text-sm font-semibold">
              Pix copia e cola
            </label>
            <textarea
              id="pix-copia-e-cola"
              readOnly
              rows={4}
              value={estado.pix.payload}
              className={`${classeEntrada} resize-none break-all font-mono text-xs`}
            />
            <button type="button" onClick={() => copiar(estado.pix!.payload)} className={classeBotao("secundario", "sm")}>
              {copiado ? "Copiado" : "Copiar código"}
            </button>
            <p className="text-xs leading-relaxed text-suave">
              Quando o pagamento cair, a assinatura ativa sozinha em alguns minutos: recarrega esta página pra conferir.
              Pra cancelar, é no app do teu banco, em Pix Automático.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={acao} className="flex flex-col justify-between gap-4 rounded-xl bg-superficie-2 px-4 py-4">
      <div className="space-y-3">
        <p className="text-sm text-suave">
          <strong className="text-texto">{preco}</strong> por mês, no Pix Automático, pelo Asaas. O débito segue todo mês até tu cancelar no teu banco.
        </p>
        <Campo rotulo="CPF ou CNPJ" htmlFor="cpf-cnpj" dica="O Asaas pede pra emitir a cobrança. Não guardamos esse número.">
          <input
            id="cpf-cnpj"
            name="cpfCnpj"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={18}
            className={classeEntrada}
          />
        </Campo>
      </div>
      <div>
        <button type="submit" disabled={enviando} className={classeBotao("primario", "sm")}>
          {enviando ? "Gerando o Pix…" : deNovo ? "Assinar de novo no Pix" : "Assinar no Pix Automático"}
        </button>
        {estado.erro ? <div className="mt-3"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
      </div>
    </form>
  );
}
