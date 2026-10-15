import type { Metadata } from "next";
import Link from "next/link";
import { basePainel } from "@/lib/painel";
import { repo } from "@/lib/dados";
import { postsDaConta } from "@/lib/instagram";
import { numero } from "@/lib/formato";
import { Aviso, BotaoLink, Cartao, Miniatura, Selo } from "@/components/ui";
import { CabecalhoPagina, ConectarInstagram, EstadoVazio } from "@/components/painel/blocos";
import { AlternarAutomacao } from "@/components/painel/acoes-automacao";
import { IconeMais, IconeRaio } from "@/components/icones";

export const metadata: Metadata = { title: "Automações" };

export default async function Automacoes({
  searchParams,
}: {
  searchParams: Promise<{ excluida?: string }>;
}) {
  const q = await searchParams;
  const { usuario, conta, demonstracao } = await basePainel();
  const r = repo();
  const automacoes = await r.listarAutomacoes(usuario.id);

  // números de cada uma (desde sempre) e a miniatura mais nova do post
  const [numeros, posts] = await Promise.all([
    r.numerosPorAutomacao(usuario.id),
    conta?.status === "conectada" ? postsDaConta(conta) : Promise.resolve(null),
  ]);
  const ZERO = { comentarios: 0, dms: 0, naFila: 0, erros: 0, cliques: 0 };
  const miniaturas = new Map(posts?.ok ? posts.posts.map((p) => [p.id, p.miniatura]) : []);
  const conectada = conta?.status === "conectada";

  return (
    <>
      <CabecalhoPagina
        titulo="Automações"
        descricao="Cada uma: um post (ou qualquer post), as palavras e a mensagem com o link."
        acoes={
          conectada ? (
            <BotaoLink href="/painel/automacoes/nova">
              <IconeMais className="size-5" /> Nova automação
            </BotaoLink>
          ) : null
        }
      />

      <div className="space-y-4">
        {q.excluida ? <Aviso tipo="ok">Automação apagada.</Aviso> : null}
        {!conectada ? (
          <ConectarInstagram demonstracao={demonstracao.instagram} expirada={conta?.status === "expirada"} />
        ) : null}

        {automacoes.length === 0 ? (
          conectada ? (
            <EstadoVazio
              icone={<IconeRaio className="size-7" />}
              titulo="Nenhuma automação ainda"
              texto="Cria a primeira: escolhe o post, a palavra e a mensagem com o link."
              acao={<BotaoLink href="/painel/automacoes/nova">Criar automação</BotaoLink>}
            />
          ) : null
        ) : (
          <div className="grid gap-3">
            {automacoes.map((a) => {
              const n = numeros[a.id] ?? ZERO;
              return (
                <Cartao key={a.id} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <Link href={`/painel/automacoes/${a.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                      {a.qualquerPost ? (
                        <div className="grid size-16 shrink-0 place-items-center rounded-xl bg-azul/15 text-azul-claro">
                          <IconeRaio className="size-6" />
                        </div>
                      ) : (
                        <Miniatura
                          src={(a.mediaId && miniaturas.get(a.mediaId)) || a.mediaMiniatura}
                          alt=""
                          className="size-16 shrink-0 rounded-xl"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-bold">{a.nome}</p>
                          {a.ativa ? <Selo cor="verde">Ligada</Selo> : <Selo>Pausada</Selo>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {a.palavras.map((p) => (
                            <span key={p} className="rounded-md bg-superficie-3 px-2 py-0.5 text-xs font-semibold text-azul-claro">
                              {p.toUpperCase()}
                            </span>
                          ))}
                          <span className="px-1 py-0.5 text-xs text-suave">
                            {a.qualquerPost ? "qualquer post" : "um post"}
                          </span>
                        </div>
                      </div>
                    </Link>
                    <div className="flex items-center justify-between gap-4 md:justify-end">
                      <dl className="numeros flex gap-5 text-center text-sm">
                        <div>
                          <dt className="text-xs text-suave">Comentaram</dt>
                          <dd className="font-bold">{numero(n.comentarios)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-suave">DMs</dt>
                          <dd className="font-bold">{numero(n.dms)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-suave">Cliques</dt>
                          <dd className="font-bold">{numero(n.cliques)}</dd>
                        </div>
                      </dl>
                      <AlternarAutomacao id={a.id} ativa={a.ativa} />
                    </div>
                  </div>
                </Cartao>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
