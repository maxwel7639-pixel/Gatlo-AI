import Link from "next/link";
import type { Post } from "@/lib/instagram";
import { dataCurta, legendaCurta, numero } from "@/lib/formato";
import { Miniatura, classeBotao } from "../ui";
import {
  IconeCarrossel,
  IconeComentario,
  IconeCoracao,
  IconeEnvio,
  IconeOlho,
  IconePessoas,
  IconeRaio,
  IconeSalvo,
  IconeVideo,
} from "../icones";

function Metrica({ icone, valor, rotulo }: { icone: React.ReactNode; valor: number | null; rotulo: string }) {
  return (
    <span className="flex items-center gap-1.5" title={rotulo}>
      <span className="text-apagado">{icone}</span>
      <span className="numeros font-semibold text-texto/90">{numero(valor)}</span>
      <span className="sr-only">{rotulo}</span>
    </span>
  );
}

export function CartaoPost({ post, automacoes }: { post: Post; automacoes: number }) {
  const reel = post.produto === "REELS" || post.tipo === "VIDEO";
  const m = post.metricas;
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-borda bg-superficie">
      <div className="relative aspect-[4/5] overflow-hidden bg-superficie-3">
        <Miniatura src={post.miniatura} alt={legendaCurta(post.legenda, 60)} className="size-full transition-transform duration-300 group-hover:scale-[1.03]" />
        <div className="absolute top-2.5 right-2.5 flex gap-1.5">
          {reel ? (
            <span className="grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur" title="Reels">
              <IconeVideo className="size-4" />
            </span>
          ) : post.tipo === "CAROUSEL_ALBUM" ? (
            <span className="grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur" title="Carrossel">
              <IconeCarrossel className="size-4" />
            </span>
          ) : null}
        </div>
        {automacoes ? (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-azul px-2.5 py-1 text-xs font-semibold text-white shadow">
            <IconeRaio className="size-3.5" /> {automacoes === 1 ? "1 automação" : `${automacoes} automações`}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-4">
        <p className="text-xs font-medium text-suave">{dataCurta(post.publicadoEm)}</p>
        <p className="mt-1 line-clamp-2 min-h-[2.6em] text-sm leading-snug text-texto/90">{legendaCurta(post.legenda, 140)}</p>

        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px]">
          <Metrica icone={<IconeComentario className="size-4" />} valor={post.comentarios} rotulo="comentários" />
          <Metrica icone={<IconeCoracao className="size-4" />} valor={post.curtidas} rotulo="curtidas" />
        </div>
        {m ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-borda pt-3 text-[12.5px]">
            {[
              { r: "Alcance", v: m.alcance, i: <IconePessoas className="size-3.5" /> },
              { r: "Visualizações", v: m.visualizacoes, i: <IconeOlho className="size-3.5" /> },
              { r: "Salvamentos", v: m.salvamentos, i: <IconeSalvo className="size-3.5" /> },
              { r: "Compartilh.", v: m.compartilhamentos, i: <IconeEnvio className="size-3.5" /> },
            ].map((x) => (
              <div key={x.r} className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1 text-suave">
                  <span className="text-apagado">{x.i}</span>
                  {x.r}
                </dt>
                <dd className="numeros font-semibold">{numero(x.v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 border-t border-borda pt-3 text-[12.5px] text-apagado">
            Alcance e visualizações indisponíveis pra este post.
          </p>
        )}

        <div className="mt-auto pt-4">
          <Link href={`/painel/automacoes/nova?post=${encodeURIComponent(post.id)}`} className={`${classeBotao("secundario", "sm")} w-full`}>
            <IconeRaio className="size-4" /> Criar automação
          </Link>
        </div>
      </div>
    </article>
  );
}
