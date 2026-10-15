import Link from "next/link";
import { basePainel } from "@/lib/painel";
import { repo } from "@/lib/dados";
import { regras } from "@/lib/regras";
import { hora, inicioDoMes, noFuturo, nomeDoMes, numero } from "@/lib/formato";
import { Aviso, Avatar, BotaoLink, Cartao, Miniatura, Selo } from "@/components/ui";
import { CabecalhoPagina, ConectarInstagram, EstadoVazio, Numero } from "@/components/painel/blocos";
import {
  IconeComentario,
  IconeEnvio,
  IconeFila,
  IconeLink,
  IconeMais,
  IconeRaio,
  IconeSeta,
} from "@/components/icones";

export default async function VisaoGeral({
  searchParams,
}: {
  searchParams: Promise<{ bemvindo?: string; conectado?: string }>;
}) {
  const q = await searchParams;
  const { usuario, conta, situacao, demonstracao } = await basePainel();
  const r = repo();
  const primeiroNome = usuario.nome?.split(" ")[0] ?? "";

  const conectada = conta?.status === "conectada";
  const [automacoes, numeros, pausa, { testeDias }] = await Promise.all([
    r.listarAutomacoes(usuario.id),
    r.numeros(usuario.id, { desde: inicioDoMes() }),
    conta ? r.pausa(usuario.id, conta.id) : Promise.resolve(null),
    regras(),
  ]);
  const ativas = automacoes.filter((a) => a.ativa);
  const pausadoAte = noFuturo(pausa?.directAte) ? pausa?.directAte ?? null : null;
  const mes = nomeDoMes();

  return (
    <>
      <CabecalhoPagina
        titulo={primeiroNome ? `Oi, ${primeiroNome}` : "Visão geral"}
        descricao="O resumo do teu Instagram e das automações."
        acoes={
          conectada ? (
            <BotaoLink href="/painel/automacoes/nova">
              <IconeMais className="size-5" /> Nova automação
            </BotaoLink>
          ) : null
        }
      />

      <div className="space-y-6">
        {q.bemvindo ? (
          <Aviso tipo="ok">
            Conta criada! Teu teste de {testeDias} dias começou. Agora conecta o Instagram pra criar a primeira
            automação.
          </Aviso>
        ) : null}
        {q.conectado && conectada ? (
          <Aviso tipo="ok">Instagram conectado: @{conta?.username}. Escolhe um post e cria a tua automação.</Aviso>
        ) : null}
        {situacao && !situacao.liberada ? (
          <Aviso tipo="atencao">
            Teu teste acabou e as automações estão pausadas: ninguém recebe DM até tu assinar. A assinatura chega na
            próxima versão do painel; enquanto isso, fala com a gente pelo suporte.
          </Aviso>
        ) : null}
        {pausadoAte ? (
          <Aviso tipo="atencao">
            O Instagram pediu pra tua conta esperar (limite de mensagens). As DMs voltam às {hora(pausadoAte)}; quem
            comentou continua na fila e recebe.
          </Aviso>
        ) : null}

        {!conta || !conectada ? (
          <ConectarInstagram demonstracao={demonstracao.instagram} expirada={conta?.status === "expirada"} />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <Cartao className="flex items-center gap-4 p-5">
              <Avatar src={conta.fotoUrl} nome={conta.username} className="size-14" />
              <div className="min-w-0">
                <p className="truncate text-lg font-bold">@{conta.username}</p>
                <p className="truncate text-sm text-suave">
                  {conta.seguidores !== null ? `${numero(conta.seguidores)} seguidores` : conta.nome}
                </p>
                <div className="mt-1.5">
                  {conta.demonstracao ? <Selo cor="amarelo">Perfil fictício</Selo> : <Selo cor="verde">Conectada</Selo>}
                </div>
              </div>
            </Cartao>

            <Cartao className="p-5">
              {situacao?.status === "trial" && situacao.liberada ? (
                <>
                  <p className="text-sm font-medium text-suave">Teste grátis</p>
                  <p className="mt-1 text-2xl font-bold">
                    {situacao.diasRestantes === 1 ? "Falta 1 dia" : `Faltam ${situacao.diasRestantes} dias`}
                  </p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-superficie-3" aria-hidden>
                    <div
                      className="h-full rounded-full bg-azul"
                      style={{ width: `${Math.max(6, Math.min(100, (situacao.diasRestantes / testeDias) * 100))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-suave">Depois, a automação pausa até tu assinar.</p>
                </>
              ) : situacao?.liberada ? (
                <>
                  <p className="text-sm font-medium text-suave">Assinatura</p>
                  <p className="mt-1 text-2xl font-bold text-verde">Ativa</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-suave">Teste grátis</p>
                  <p className="mt-1 text-2xl font-bold text-amarelo">Acabou</p>
                  <p className="mt-2 text-xs text-suave">As automações estão pausadas.</p>
                </>
              )}
            </Cartao>

            <Cartao className="p-5">
              <p className="text-sm font-medium text-suave">Automações ligadas</p>
              <p className="numeros mt-1 text-2xl font-bold">
                {ativas.length}
                <span className="text-base font-medium text-suave"> de {automacoes.length}</span>
              </p>
              <Link href="/painel/automacoes" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-azul-claro hover:underline">
                Ver todas <IconeSeta className="size-4" />
              </Link>
            </Cartao>
          </div>
        )}

        <section>
          <h2 className="mb-3 text-lg font-bold">Números de {mes}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero rotulo="Comentaram a palavra" valor={numeros.comentarios} icone={<IconeComentario className="size-4" />} />
            <Numero rotulo="Receberam a DM" valor={numeros.dms} icone={<IconeEnvio className="size-4" />} destaque />
            <Numero rotulo="Na fila agora" valor={numeros.naFila} icone={<IconeFila className="size-4" />} />
            <Numero
              rotulo="Cliques no link"
              valor={numeros.cliques}
              icone={<IconeLink className="size-4" />}
              detalhe={numeros.dms ? `${Math.round((numeros.cliques / numeros.dms) * 100)}% de quem recebeu` : undefined}
            />
          </div>
        </section>

        {conectada ? (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Automações ligadas</h2>
              {ativas.length ? (
                <Link href="/painel/automacoes" className="text-sm font-semibold text-azul-claro hover:underline">
                  Ver todas
                </Link>
              ) : null}
            </div>
            {ativas.length ? (
              <Cartao className="divide-y divide-borda">
                {ativas.slice(0, 5).map((a) => (
                  <Link
                    key={a.id}
                    href={`/painel/automacoes/${a.id}`}
                    className="flex items-center gap-4 px-4 py-3.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-superficie-2"
                  >
                    {a.qualquerPost ? (
                      <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-azul/15 text-azul-claro">
                        <IconeRaio className="size-5" />
                      </div>
                    ) : (
                      <Miniatura src={a.mediaMiniatura} alt="" className="size-11 shrink-0 rounded-lg" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.nome}</p>
                      <p className="truncate text-sm text-suave">
                        {a.palavras.map((p) => p.toUpperCase()).join(" · ")}
                        {a.qualquerPost ? " · qualquer post" : ""}
                      </p>
                    </div>
                    <IconeSeta className="size-5 shrink-0 text-apagado" />
                  </Link>
                ))}
              </Cartao>
            ) : (
              <EstadoVazio
                icone={<IconeRaio className="size-7" />}
                titulo="Nenhuma automação ligada"
                texto="Escolhe um post, a palavra e a mensagem com o link. Quem comentar a palavra recebe a mensagem no direct."
                acao={
                  <div className="flex flex-wrap justify-center gap-2">
                    <BotaoLink href="/painel/automacoes/nova">Criar automação</BotaoLink>
                    <BotaoLink href="/painel/posts" variante="secundario">
                      Ver meus posts
                    </BotaoLink>
                  </div>
                }
              />
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
