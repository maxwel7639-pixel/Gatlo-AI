"use client";

import { useFormStatus } from "react-dom";
import { alternarAutomacao, excluirAutomacao, simularComentarios } from "@/lib/acoes";
import { classeBotao } from "../ui";
import { IconeLixeira, IconePausa, IconePlay, IconeComentario } from "../icones";

function Enviar({
  children,
  variante,
  tamanho = "sm",
  titulo,
}: {
  children: React.ReactNode;
  variante: "primario" | "secundario" | "perigo" | "fantasma";
  tamanho?: "sm" | "md";
  titulo?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title={titulo} className={`${classeBotao(variante, tamanho)} disabled:opacity-60`}>
      {children}
    </button>
  );
}

export function AlternarAutomacao({ id, ativa, tamanho = "sm" }: { id: string; ativa: boolean; tamanho?: "sm" | "md" }) {
  return (
    <form action={alternarAutomacao.bind(null, id, !ativa)}>
      <Enviar variante="secundario" tamanho={tamanho}>
        {ativa ? (
          <>
            <IconePausa className="size-4" /> Pausar
          </>
        ) : (
          <>
            <IconePlay className="size-4" /> Ligar
          </>
        )}
      </Enviar>
    </form>
  );
}

export function ExcluirAutomacao({ id, nome }: { id: string; nome: string }) {
  return (
    <form
      action={excluirAutomacao.bind(null, id)}
      onSubmit={(e) => {
        if (!window.confirm(`Apagar a automação "${nome}"? Os números dela somem junto e o link curto para de funcionar.`)) {
          e.preventDefault();
        }
      }}
    >
      <Enviar variante="perigo" titulo="Apagar">
        <IconeLixeira className="size-4" /> Apagar
      </Enviar>
    </form>
  );
}

export function SimularComentarios({ id }: { id: string }) {
  return (
    <form action={simularComentarios.bind(null, id)}>
      <Enviar variante="secundario">
        <IconeComentario className="size-4" /> Simular comentários
      </Enviar>
    </form>
  );
}
