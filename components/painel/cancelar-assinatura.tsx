"use client";

import { useActionState } from "react";
import { cancelarAssinatura, type EstadoCancelamento } from "@/lib/acoes";
import { Aviso, classeBotao } from "../ui";

const inicial: EstadoCancelamento = {};

/**
 * O botão de cancelar. O clique só pede o cancelamento ao gateway; o status
 * "cancelada" aparece quando o gateway avisar (webhook). Até o fim do período
 * pago o robô segue liberado.
 */
export function CancelarAssinatura({
  texto = "Cancelar para de cobrar. Teu acesso segue até o fim do período já pago.",
  rotulo = "Cancelar assinatura",
  semFundo = false,
}: {
  texto?: string;
  rotulo?: string;
  /** Dentro de um bloco que já tem fundo (o "abrir" da página). */
  semFundo?: boolean;
}) {
  const [estado, acao, enviando] = useActionState(cancelarAssinatura, inicial);

  return (
    <form action={acao} className={`flex flex-col gap-3 ${semFundo ? "mt-3" : "mt-5 rounded-xl bg-superficie-2 px-4 py-4"}`}>
      <p className="text-sm text-suave">{texto}</p>
      <div>
        <button type="submit" disabled={enviando} className={classeBotao("perigo", "sm")}>
          {enviando ? "Cancelando…" : rotulo}
        </button>
      </div>
      {estado.erro ? <Aviso tipo="erro">{estado.erro}</Aviso> : null}
      {estado.ok ? <Aviso tipo="info">{estado.ok}</Aviso> : null}
    </form>
  );
}
