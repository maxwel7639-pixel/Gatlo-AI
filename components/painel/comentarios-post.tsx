"use client";

import { useActionState, useState } from "react";
import { moderarComentario, type EstadoModeracao } from "@/lib/acoes";
import type { Comentario } from "@/lib/instagram";
import { haQuanto } from "@/lib/formato";
import { Aviso, Selo, classeBotao, classeEntrada } from "../ui";

/**
 * A tela "Comentários do post": cada botão é UMA chamada à Meta, feita na hora, com o
 * retorno logo abaixo. É o que a revisão da Meta precisa ver saindo do app.
 */

type Props = { mediaId: string; contaIgUserId: string; username: string; comentarios: Comentario[] };

function Retorno({ estado }: { estado: EstadoModeracao }) {
  if (estado.erro) return <Aviso tipo="erro">{estado.erro}</Aviso>;
  if (estado.ok) return <Aviso tipo="ok">{estado.ok}</Aviso>;
  return null;
}

/** Formulário com texto: comentário novo, resposta pública ou DM. */
function FormTexto({
  mediaId,
  commentId,
  acao,
  rotulo,
  botao,
  dica,
  aoFechar,
}: {
  mediaId: string;
  commentId?: string;
  acao: "comentar" | "responder" | "dm";
  rotulo: string;
  botao: string;
  dica?: string;
  aoFechar?: () => void;
}) {
  const [estado, enviar, enviando] = useActionState(moderarComentario, {});
  return (
    <form action={enviar} className="mt-3 space-y-2" key={estado.ok ? estado.vez : undefined}>
      <input type="hidden" name="acao" value={acao} />
      <input type="hidden" name="mediaId" value={mediaId} />
      {commentId ? <input type="hidden" name="commentId" value={commentId} /> : null}
      <label className="block text-sm font-semibold">
        {rotulo}
        <textarea name="texto" required maxLength={1000} rows={2} className={`${classeEntrada} mt-1.5 font-normal`} />
      </label>
      {dica ? <p className="text-xs text-suave">{dica}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={enviando} className={classeBotao("primario", "sm")}>
          {enviando ? "Enviando…" : botao}
        </button>
        {aoFechar ? (
          <button type="button" onClick={aoFechar} className={classeBotao("fantasma", "sm")}>
            Cancelar
          </button>
        ) : null}
      </div>
      <Retorno estado={estado} />
    </form>
  );
}

/** Botão de um clique: ocultar, mostrar ou apagar. */
function BotaoAcao({
  mediaId,
  commentId,
  acao,
  rotulo,
  confirmar,
}: {
  mediaId: string;
  commentId: string;
  acao: "ocultar" | "mostrar" | "apagar";
  rotulo: string;
  confirmar?: string;
}) {
  const [estado, enviar, enviando] = useActionState(moderarComentario, {});
  return (
    <form
      action={enviar}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
    >
      <input type="hidden" name="acao" value={acao} />
      <input type="hidden" name="mediaId" value={mediaId} />
      <input type="hidden" name="commentId" value={commentId} />
      <button
        type="submit"
        disabled={enviando}
        className={classeBotao(acao === "apagar" ? "perigo" : "secundario", "sm")}
      >
        {enviando ? "…" : rotulo}
      </button>
      {estado.erro ? <p className="mt-1 text-xs text-vermelho" role="alert">{estado.erro}</p> : null}
    </form>
  );
}

function ItemComentario({
  c,
  mediaId,
  contaIgUserId,
  resposta = false,
}: {
  c: Comentario;
  mediaId: string;
  contaIgUserId: string;
  resposta?: boolean;
}) {
  const [aberto, setAberto] = useState<"responder" | "dm" | null>(null);
  const proprio = c.autorId === contaIgUserId;
  return (
    <li className={resposta ? "border-l-2 border-borda pl-4" : ""}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">@{c.username ?? "alguém"}</span>
        {proprio ? <Selo cor="azul">Tua conta</Selo> : null}
        {c.oculto ? <Selo cor="amarelo">Oculto</Selo> : null}
        <span className="text-xs text-apagado">{haQuanto(c.publicadoEm)}</span>
      </div>
      <p className={`mt-1 text-[15px] ${c.oculto ? "text-apagado" : ""}`}>{c.texto}</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {!resposta ? (
          <button type="button" onClick={() => setAberto("responder")} className={classeBotao("secundario", "sm")}>
            Responder
          </button>
        ) : null}
        {!resposta && !proprio ? (
          <button type="button" onClick={() => setAberto("dm")} className={classeBotao("secundario", "sm")}>
            Enviar DM
          </button>
        ) : null}
        <BotaoAcao
          mediaId={mediaId}
          commentId={c.id}
          acao={c.oculto ? "mostrar" : "ocultar"}
          rotulo={c.oculto ? "Mostrar" : "Ocultar"}
        />
        {proprio ? (
          <BotaoAcao
            mediaId={mediaId}
            commentId={c.id}
            acao="apagar"
            rotulo="Apagar"
            confirmar="Apagar este comentário do Instagram? Não dá pra desfazer."
          />
        ) : null}
      </div>

      {aberto === "responder" ? (
        <FormTexto
          mediaId={mediaId}
          commentId={c.id}
          acao="responder"
          rotulo={`Resposta pública para @${c.username ?? "alguém"}`}
          botao="Publicar resposta"
          aoFechar={() => setAberto(null)}
        />
      ) : null}
      {aberto === "dm" ? (
        <FormTexto
          mediaId={mediaId}
          commentId={c.id}
          acao="dm"
          rotulo={`DM para @${c.username ?? "alguém"}`}
          botao="Enviar DM"
          dica="Vai uma mensagem privada, como resposta a este comentário. O Instagram aceita uma por comentário, até 7 dias depois dele."
          aoFechar={() => setAberto(null)}
        />
      ) : null}

      {c.respostas.length ? (
        <ul className="mt-4 space-y-4">
          {c.respostas.map((r) => (
            <ItemComentario key={r.id} c={r} mediaId={mediaId} contaIgUserId={contaIgUserId} resposta />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ComentariosPost({ mediaId, contaIgUserId, username, comentarios }: Props) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-borda bg-superficie p-4 sm:p-5">
        <h2 className="text-base font-bold">Comentar como @{username}</h2>
        <FormTexto mediaId={mediaId} acao="comentar" rotulo="Comentário" botao="Publicar comentário" />
      </section>

      <section className="rounded-2xl border border-borda bg-superficie p-4 sm:p-5">
        <h2 className="text-base font-bold">Comentários</h2>
        {comentarios.length ? (
          <ul className="mt-4 space-y-5 divide-y divide-borda [&>li]:pt-5 [&>li:first-child]:pt-0">
            {comentarios.map((c) => (
              <ItemComentario key={c.id} c={c} mediaId={mediaId} contaIgUserId={contaIgUserId} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-suave">Ninguém comentou ainda. O que entrar aparece aqui.</p>
        )}
      </section>
    </div>
  );
}
