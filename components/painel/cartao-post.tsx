import Link from "next/link";
import type { Post } from "@/lib/instagram";
import { dataCurta, legendaCurta, numero } from "@/lib/formato";
import { Miniatura, classeBotao } from "../ui";
import { IconeCarrossel, IconeComentario, IconeCoracao, IconeRaio, IconeVideo } from "../icones";

/**
 * Um post na grade. No celular vira uma linha (miniatura à esquerda, números
 * à direita); do tablet pra cima, cartão em pé.
 */
export function CartaoPost({ post, automacoes }: { post: Post; automacoes: number }) {
  const reel = post.produto === "REELS" || post.tipo === "VIDEO";
  const m = post.metricas;
  return (
    <article className="group flex overflow-hidden rounded-2xl border border-borda bg-superficie sm:flex-col">
      <div className="relative w-28 shrink-0 overflow-hidden bg-superficie-3 sm:aspect-[4/5] sm:w-auto">
        <Miniatura
          src={post.miniatura}
          alt={legendaCurta(post.legenda, 60)}
          className="size-full transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {reel || post.tipo === "CAROUSEL_ALBUM" ? (
          <span
            className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur"
            title={reel ? "Reels" : "Carrossel"}
          >
            {reel ? <IconeVideo className="size-4" /> : <IconeCarrossel className="size-4" />}
          </span>
        ) : null}
        {automacoes ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-azul px-2 py-0.5 text-[11px] font-semibold text-white shadow">
            <IconeRaio className="size-3" /> {automacoes}
            <span className="hidden sm:inline">{automacoes === 1 ? " automação" : " automações"}</span>
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 text-xs text-suave">
          <span className="font-medium">{dataCurta(post.publicadoEm)}</span>
          <span className="flex items-center gap-3 text-[13px]">
            <span className="flex items-center gap-1" title="comentários">
              <IconeComentario className="size-3.5 text-apagado" />
              <span className="numeros font-semibold text-texto/90">{numero(post.comentarios)}</span>
              <span className="sr-only">comentários</span>
            </span>
            <span className="flex items-center gap-1" title="curtidas">
              <IconeCoracao className="size-3.5 text-apagado" />
              <span className="numeros font-semibold text-texto/90">{numero(post.curtidas)}</span>
              <span className="sr-only">curtidas</span>
            </span>
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-texto/90">{legendaCurta(post.legenda, 140)}</p>

        {m ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-borda pt-2.5 text-xs">
            {[
              ["Alcance", m.alcance],
              ["Visualiz.", m.visualizacoes],
              ["Salvos", m.salvamentos],
              ["Compart.", m.compartilhamentos],
            ].map(([rotulo, valor]) => (
              <div key={rotulo as string} className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-suave">{rotulo}</dt>
                <dd className="numeros whitespace-nowrap font-semibold">{numero(valor as number | null)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 border-t border-borda pt-2.5 text-xs text-apagado">Sem alcance e visualizações pra este post.</p>
        )}

        <div className="mt-auto pt-3">
          <Link
            href={`/painel/automacoes/nova?post=${encodeURIComponent(post.id)}`}
            className={`${classeBotao("secundario", "sm")} w-full`}
          >
            <IconeRaio className="size-4" /> Criar automação
          </Link>
        </div>
      </div>
    </article>
  );
}
