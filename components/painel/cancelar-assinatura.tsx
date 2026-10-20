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
export function CancelarAssinatura() {
  const [estado, acao, enviando] = useActionState(cancelarAssinatura, inicial);

  return (
    <form action={acao} className="mt-5 flex flex-col gap-3 rounded-xl bg-superficie-2 px-4 py-4">
      <p className="text-sm text-suave">Cancelar para de cobrar. Teu acesso segue até o fim do período já pago.</p>
      <div>
        <button type="submit" disabled={enviando} className={classeBotao("perigo", "sm")}>
          {enviando ? "Cancelando…" : "Cancelar assinatura"}
        </button>
      </div>
      {estado.erro ? <Aviso tipo="erro">{estado.erro}</Aviso> : null}
      {estado.ok ? <Aviso tipo="info">{estado.ok}</Aviso> : null}
    </form>
  );
}
