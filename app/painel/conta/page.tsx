import type { Metadata } from "next";
import Link from "next/link";
import { basePainel } from "@/lib/painel";
import { PRODUTO } from "@/lib/config";
import { usaSupabase } from "@/lib/env";
import { desconectarInstagram } from "@/lib/acoes";
import { emReais, regras } from "@/lib/regras";
import { dataCurta, numero } from "@/lib/formato";
import { Aviso, Avatar, Cartao, Selo, classeBotao } from "@/components/ui";
import { CabecalhoPagina, ConectarInstagram } from "@/components/painel/blocos";
import { ExcluirConta } from "@/components/painel/excluir-conta";
import { AssinarCartao } from "@/components/painel/assinar-cartao";
import { AssinarPix } from "@/components/painel/assinar-pix";
import { IconeCheck, IconeInstagram } from "@/components/icones";

export const metadata: Metadata = { title: "Conta" };

const ERROS: Record<string, string> = {
  negado: "Tu cancelou o login do Instagram. Quando quiser, é só tentar de novo.",
  estado: "O login do Instagram não pôde ser conferido (link velho ou aberto em outro navegador). Tenta de novo.",
  meta: "O Instagram não completou a conexão agora. Tenta de novo em instantes. Lembra: precisa ser conta profissional.",
  ja_conectada: "Esse Instagram já está conectado em outro cadastro. Fala com o suporte se ele for teu.",
  muitas_tentativas: "Muitas tentativas de conexão. Espera um pouco e tenta de novo.",
  desconectado: "Conecta o Instagram antes de ligar uma automação.",
};

const PERMISSOES = [
  "Ver o teu perfil e os teus posts (pra mostrar a grade e as métricas).",
  "Ler os comentários dos teus posts (pra achar quem escreveu a palavra).",
  "Mandar mensagem no direct de quem comentou e responder o comentário.",
];

export default async function Conta({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; aviso?: string; desconectado?: string; assinatura?: string }>;
}) {
  const q = await searchParams;
  const { usuario, conta, situacao, demonstracao } = await basePainel();
  const r = await regras();
  const conectada = conta?.status === "conectada";

  return (
    <>
      <CabecalhoPagina titulo="Conta" descricao="Instagram conectado, assinatura e teus dados." />
      <div className="space-y-6">
        {q.erro && ERROS[q.erro] ? <Aviso tipo="erro">{ERROS[q.erro]}</Aviso> : null}
        {q.aviso === "permissoes" ? (
          <Aviso tipo="atencao">
            O Instagram conectou, mas sem a permissão de comentários ou de mensagens. Sem elas o robô não funciona:
            desconecta e conecta de novo marcando tudo.
          </Aviso>
        ) : null}
        {q.desconectado ? (
          <Aviso tipo="ok">Instagram desconectado. O acesso foi apagado e as automações pausaram.</Aviso>
        ) : null}

        {/* ------------------------------------------------ Instagram */}
        <section>
          <h2 className="mb-3 text-lg font-bold">Instagram</h2>
          {conectada && conta ? (
            <Cartao className="p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <Avatar src={conta.fotoUrl} nome={conta.username} className="size-14" />
                  <div>
                    <p className="text-lg font-bold">@{conta.username}</p>
                    <p className="text-sm text-suave">
                      {[conta.nome, conta.seguidores !== null ? `${numero(conta.seguidores)} seguidores` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {conta.demonstracao ? <Selo cor="amarelo">Perfil fictício</Selo> : <Selo cor="verde">Conectada</Selo>}
                      <Selo>desde {dataCurta(conta.conectadaEm)}</Selo>
                    </div>
                  </div>
                </div>
                <form action={desconectarInstagram}>
                  <button type="submit" className={classeBotao("secundario", "sm")}>
                    Desconectar Instagram
                  </button>
                </form>
              </div>
              <div className="mt-6 border-t border-borda pt-5">
                <p className="text-sm font-semibold">O que o {PRODUTO.nome} pode fazer no teu Instagram</p>
                <ul className="mt-3 space-y-2 text-sm text-suave">
                  {PERMISSOES.map((p) => (
                    <li key={p} className="flex gap-2">
                      <IconeCheck className="mt-0.5 size-4 shrink-0 text-verde" /> {p}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs leading-relaxed text-apagado">
                  Desconectar apaga o acesso na hora. Pra tirar também do lado do Instagram: Configurações → Apps e
                  sites → remover. Não postamos, não apagamos e não lemos o teu direct.
                </p>
              </div>
            </Cartao>
          ) : (
            <ConectarInstagram demonstracao={demonstracao.instagram} expirada={conta?.status === "expirada"} />
          )}
        </section>

        {/* ------------------------------------------------ assinatura */}
        <section>
          <h2 className="mb-3 text-lg font-bold">Assinatura</h2>
          <Cartao className="p-5 sm:p-6">
            {situacao ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-bold">
                      {situacao.status === "trial"
                        ? "Teste grátis"
                        : situacao.status === "ativa"
                          ? "Assinatura ativa"
                          : situacao.status === "cancelada"
                            ? "Assinatura cancelada"
                            : "Teste ou assinatura vencida"}
                    </p>
                    {situacao.liberada ? <Selo cor="verde">Robô liberado</Selo> : <Selo cor="amarelo">Robô pausado</Selo>}
                  </div>
                  <p className="mt-1 text-sm text-suave">
                    {situacao.status === "trial" && situacao.liberada
                      ? `Vai até ${dataCurta(situacao.trialAte)} (${situacao.diasRestantes === 1 ? "falta 1 dia" : `faltam ${situacao.diasRestantes} dias`}). Sem cartão: no fim, a automação pausa até tu assinar.`
                      : situacao.periodoAte && situacao.liberada
                        ? `Paga até ${dataCurta(situacao.periodoAte)}.`
                        : "As automações não mandam DM até tu assinar."}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-2xl font-bold">{emReais(r.precoMensalCentavos)}</p>
                  <p className="text-xs text-suave">por mês · cartão ou Pix Automático</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-suave">Não achei a tua assinatura. Fala com o suporte.</p>
            )}
            {/* Sem assinatura no banco, ou já ativa, não abre checkout: o clique criaria cobrança sem dono certo ou dobrada. */}
            {situacao && situacao.status !== "ativa" ? (
              usaSupabase ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <AssinarCartao preco={emReais(r.precoMensalCentavos)} />
                  <AssinarPix preco={emReais(r.precoMensalCentavos)} />
                </div>
              ) : (
                <p className="mt-5 rounded-xl bg-superficie-2 px-4 py-3 text-sm text-suave">Assinatura só no app de verdade.</p>
              )
            ) : null}
            {q.assinatura === "iniciada" && situacao && situacao.status !== "ativa" ? (
              <div className="mt-3">
                <Aviso tipo="info">
                  Se tu concluiu o pagamento no Mercado Pago, a assinatura ativa sozinha em alguns minutos. Recarrega
                  esta página pra conferir.
                </Aviso>
              </div>
            ) : null}
          </Cartao>
        </section>

        {/* ------------------------------------------------ dados */}
        <section>
          <h2 className="mb-3 text-lg font-bold">Teus dados</h2>
          <Cartao className="space-y-4 p-5 sm:p-6">
            <div className="text-sm">
              <p>
                <span className="text-suave">Nome:</span> {usuario.nome ?? "–"}
              </p>
              <p>
                <span className="text-suave">E-mail:</span> {usuario.email}
              </p>
            </div>
            <p className="text-sm text-suave">
              Como tratamos os dados: <Link href="/privacidade" className="text-azul-claro hover:underline">privacidade</Link>
              {" · "}
              <Link href="/exclusao-de-dados" className="text-azul-claro hover:underline">exclusão de dados</Link>
            </p>
            <div className="border-t border-borda pt-4">
              <ExcluirConta />
            </div>
          </Cartao>
        </section>

        {demonstracao.instagram ? (
          <p className="flex items-center gap-2 text-xs text-apagado">
            <IconeInstagram className="size-4" /> Modo demonstração ligado: nada aqui fala com a Meta.
          </p>
        ) : null}
      </div>
    </>
  );
}
