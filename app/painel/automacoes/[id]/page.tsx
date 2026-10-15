import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { basePainel } from "@/lib/painel";
import { repo } from "@/lib/dados";
import { regras } from "@/lib/regras";
import { postsDaConta } from "@/lib/instagram";
import { linkCurtoExibido } from "@/lib/form-dados";
import { dataCurta, haQuanto, hora, noFuturo, numero } from "@/lib/formato";
import type { Comentario } from "@/lib/dados/tipos";
import { Aviso, BotaoLink, Cartao, Miniatura, Selo } from "@/components/ui";
import { CabecalhoPagina, Numero } from "@/components/painel/blocos";
import { AlternarAutomacao, ExcluirAutomacao, SimularComentarios } from "@/components/painel/acoes-automacao";
import {
  IconeAlerta,
  IconeComentario,
  IconeEnvio,
  IconeFila,
  IconeLapis,
  IconeLink,
  IconeRaio,
} from "@/components/icones";

export const metadata: Metadata = { title: "Automação" };

type Estado = { rotulo: string; cor: "verde" | "azul" | "vermelho" | "cinza"; detalhe?: string };

function estadoDoComentario(c: Comentario, limiteFila: number): Estado {
  if (c.dmEm) return { rotulo: `DM às ${hora(c.dmEm)}`, cor: "verde" };
  if (c.dmErro) return { rotulo: "Não entregue", cor: "vermelho", detalhe: c.dmErro };
  if (Date.parse(c.recebidoEm) < limiteFila) {
    return { rotulo: "Passou do prazo", cor: "cinza", detalhe: "A Meta só aceita a DM até 7 dias depois do comentário." };
  }
  return { rotulo: "Na fila", cor: "azul" };
}

function limiteDaFila(dias: number) {
  return Date.now() - dias * 86400_000;
}

export default async function DetalheAutomacao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criada?: string; salvo?: string }>;
}) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const { usuario, conta, situacao } = await basePainel();
  const r = repo();
  const a = await r.automacao(usuario.id, id);
  if (!a) notFound();

  const [n, recentes, pausa, posts, { filaJanelaDias }] = await Promise.all([
    r.numeros(usuario.id, { automacaoId: a.id }),
    r.comentariosRecentes(usuario.id, a.id, 30),
    conta ? r.pausa(usuario.id, conta.id) : Promise.resolve(null),
    conta?.status === "conectada" && a.mediaId ? postsDaConta(conta) : Promise.resolve(null),
    regras(),
  ]);
  const post = posts?.ok ? posts.posts.find((p) => p.id === a.mediaId) : undefined;
  const miniatura = post?.miniatura ?? a.mediaMiniatura;
  const limiteFila = limiteDaFila(filaJanelaDias);
  const demonstracao = Boolean(conta?.demonstracao);
  const pausadoAte = noFuturo(pausa?.directAte) ? pausa?.directAte ?? null : null;
  const total = Math.max(1, n.dms + n.naFila + n.erros);

  return (
    <>
      <CabecalhoPagina
        titulo={a.nome}
        voltar={{ href: "/painel/automacoes", rotulo: "Automações" }}
        descricao={
          <span className="inline-flex flex-wrap items-center gap-2">
            {a.ativa ? <Selo cor="verde">Ligada</Selo> : <Selo>Pausada</Selo>}
            <span>criada em {dataCurta(a.criadaEm)}</span>
          </span>
        }
        acoes={
          <>
            <BotaoLink href={`/painel/automacoes/${a.id}/editar`} variante="secundario" tamanho="sm">
              <IconeLapis className="size-4" /> Editar
            </BotaoLink>
            <AlternarAutomacao id={a.id} ativa={a.ativa} />
            <ExcluirAutomacao id={a.id} nome={a.nome} />
          </>
        }
      />

      <div className="space-y-6">
        {q.criada ? (
          <Aviso tipo="ok">
            Automação criada!{" "}
            {demonstracao
              ? "No modo demonstração ninguém comenta de verdade: usa \"Simular comentários\" aqui embaixo pra ver a tela funcionando."
              : "Quem comentar a palavra a partir de agora entra na fila e recebe a DM."}
          </Aviso>
        ) : null}
        {q.salvo ? <Aviso tipo="ok">Alterações salvas.</Aviso> : null}
        {a.ativa && situacao && !situacao.liberada ? (
          <Aviso tipo="atencao">
            O teste acabou: esta automação está ligada, mas ninguém recebe DM até tu assinar.
          </Aviso>
        ) : null}
        {pausadoAte ? (
          <Aviso tipo="atencao">
            O Instagram pediu pra tua conta esperar. As DMs voltam às {hora(pausadoAte)}; a fila continua guardada.
          </Aviso>
        ) : null}

        {/* ------------------------------------------------ números */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Numero rotulo="Comentaram" valor={n.comentarios} icone={<IconeComentario className="size-4" />} />
          <Numero rotulo="Receberam a DM" valor={n.dms} icone={<IconeEnvio className="size-4" />} destaque />
          <Numero rotulo="Na fila" valor={n.naFila} icone={<IconeFila className="size-4" />} />
          <Numero rotulo="Não entregues" valor={n.erros} icone={<IconeAlerta className="size-4" />} />
          <div className="col-span-2 lg:col-span-1">
            <Numero
              rotulo="Cliques no link"
              valor={n.cliques}
              icone={<IconeLink className="size-4" />}
              detalhe={n.dms ? `${Math.round((n.cliques / n.dms) * 100)}% de quem recebeu` : "conta só cliques únicos"}
            />
          </div>
        </section>

        {n.comentarios ? (
          <div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-superficie-3" aria-hidden>
              <div className="bg-verde" style={{ width: `${(n.dms / total) * 100}%` }} />
              <div className="bg-azul" style={{ width: `${(n.naFila / total) * 100}%` }} />
              <div className="bg-vermelho/70" style={{ width: `${(n.erros / total) * 100}%` }} />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-suave">
              <span><span className="mr-1.5 inline-block size-2 rounded-full bg-verde" />receberam</span>
              <span><span className="mr-1.5 inline-block size-2 rounded-full bg-azul" />na fila</span>
              <span><span className="mr-1.5 inline-block size-2 rounded-full bg-vermelho/70" />não entregues</span>
            </p>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* ------------------------------------------------ como está configurada */}
          <Cartao className="h-fit p-5">
            <h2 className="text-base font-bold">Como funciona esta</h2>
            <div className="mt-4 flex items-center gap-3">
              {a.qualquerPost ? (
                <div className="grid size-16 shrink-0 place-items-center rounded-xl bg-azul/15 text-azul-claro">
                  <IconeRaio className="size-6" />
                </div>
              ) : (
                <Miniatura src={miniatura} alt="" className="size-16 shrink-0 rounded-xl" />
              )}
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{a.qualquerPost ? "Qualquer post" : "Um post"}</p>
                <p className="line-clamp-2 text-suave">
                  {a.qualquerPost ? "Vale pra todos os posts do perfil." : a.mediaLegenda || "Sem legenda"}
                </p>
              </div>
            </div>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-apagado">Palavras</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {a.palavras.map((p) => (
                    <span key={p} className="rounded-md bg-azul/15 px-2 py-0.5 text-xs font-semibold text-azul-claro">
                      {p.toUpperCase()}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-apagado">Mensagem da DM</dt>
                <dd className="mt-1.5 whitespace-pre-wrap rounded-xl bg-superficie-2 px-3.5 py-2.5 leading-relaxed">
                  {a.mensagemDm}
                  <span className="mt-2 block border-t border-borda pt-2 text-center font-semibold text-azul-claro">
                    {a.linkTitulo}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-apagado">Link</dt>
                <dd className="mt-1 break-all">
                  <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" className="text-azul-claro hover:underline">
                    {a.linkUrl}
                  </a>
                  <span className="mt-1 block text-xs text-suave">
                    O botão passa por {linkCurtoExibido(a.codigo)} pra contar o clique.
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-apagado">Resposta pública</dt>
                <dd className="mt-1 text-suave">{a.respostaPublica ?? "Desligada"}</dd>
              </div>
            </dl>
          </Cartao>

          {/* ------------------------------------------------ quem comentou */}
          <Cartao className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borda px-5 py-4">
              <div>
                <h2 className="text-base font-bold">Quem comentou</h2>
                <p className="text-xs text-suave">Os 30 mais recentes.</p>
              </div>
              {demonstracao ? <SimularComentarios id={a.id} /> : null}
            </div>
            {recentes.length ? (
              <ul className="divide-y divide-borda">
                {recentes.map((c) => {
                  const e = estadoDoComentario(c, limiteFila);
                  return (
                    <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-superficie-3 text-sm font-bold text-suave" aria-hidden>
                        {(c.autorUsername ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-semibold">@{c.autorUsername ?? "desconhecido"}</span>{" "}
                          <span className="text-xs text-apagado">{haQuanto(c.recebidoEm)}</span>
                        </p>
                        <p className="truncate text-sm text-suave">{c.texto}</p>
                      </div>
                      <span title={e.detalhe} className="shrink-0">
                        <Selo cor={e.cor}>{e.rotulo}</Selo>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="font-semibold">Ninguém comentou a palavra ainda</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-suave">
                  {demonstracao
                    ? "No modo demonstração, aperta \"Simular comentários\" pra ver como fica."
                    : `Quando alguém comentar ${a.palavras[0]?.toUpperCase() ?? "a palavra"}, aparece aqui com o status da DM.`}
                </p>
              </div>
            )}
            {n.comentarios > recentes.length ? (
              <p className="border-t border-borda px-5 py-3 text-xs text-suave">
                Mostrando {recentes.length} de {numero(n.comentarios)}.
              </p>
            ) : null}
          </Cartao>
        </div>
      </div>
    </>
  );
}
