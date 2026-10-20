import { emReais } from "@/lib/regras";
import { dataCurta } from "@/lib/formato";
import type { Situacao } from "@/lib/dados/tipos";
import { Aviso, Cartao, Selo } from "../ui";
import { AssinarCartao } from "./assinar-cartao";
import { AssinarPix } from "./assinar-pix";
import { CancelarAssinatura } from "./cancelar-assinatura";

type Passo = "assinar" | "assinar_de_novo" | "nenhum";

type Visao = {
  titulo: string;
  /** Rótulo e valor da linha "até quando". */
  ate: { rotulo: string; valor: string };
  texto: string;
  /** Resumo do que fazer agora, na grade de três. */
  proximo: string;
  passo: Passo;
  /** "botao" = cancelar sempre à vista; "escondido" = só se a pessoa abrir; null = sem cancelar. */
  cancelar: "botao" | "escondido" | null;
};

function faltam(dias: number) {
  return dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`;
}

/**
 * O que a tela diz em cada status. Só LÊ a situação que o banco devolveu
 * (`assinatura_situacao`): nada aqui decide acesso. "Teste acabou" e "vencida"
 * chegam os dois como `vencida`; o que separa é nunca ter pago (`periodoAte` nulo).
 */
export function visaoDaAssinatura(s: Situacao, carenciaDias: number, agora = Date.now()): Visao {
  const trial = dataCurta(s.trialAte);
  const periodo = s.periodoAte ? dataCurta(s.periodoAte) : "–";

  if (s.status === "trial") {
    return {
      titulo: "Teste grátis",
      ate: { rotulo: "Teste até", valor: `${trial} (${faltam(s.diasRestantes)})` },
      texto: "Sem cartão: no fim do teste o robô pausa até tu assinar.",
      proximo: "Assinar quando quiser",
      passo: "assinar",
      cancelar: "escondido",
    };
  }
  if (s.status === "ativa") {
    const noFiado = s.periodoAte !== null && Date.parse(s.periodoAte) < agora;
    return {
      titulo: "Assinatura ativa",
      ate: { rotulo: "Paga até", valor: periodo },
      texto: noFiado
        ? `A cobrança de ${periodo} ainda não entrou. O robô segue liberado por até ${carenciaDias} dias de tolerância; se o pagamento não cair, ele pausa.`
        : `A próxima cobrança vem por volta de ${periodo}, no mesmo meio de pagamento.`,
      proximo: noFiado ? "Conferir o pagamento" : "Nada: renova sozinha",
      passo: "nenhum",
      cancelar: "botao",
    };
  }
  if (s.status === "cancelada") {
    return s.liberada
      ? {
          titulo: "Assinatura cancelada",
          ate: { rotulo: "Acesso até", valor: `${periodo} (${faltam(s.diasRestantes)})` },
          texto: "Não vamos cobrar de novo. O robô segue liberado até o fim do período que já foi pago.",
          proximo: "Assinar de novo, se quiser ficar",
          passo: "assinar_de_novo",
          cancelar: null,
        }
      : {
          titulo: "Assinatura cancelada",
          ate: { rotulo: "Acesso acabou em", valor: periodo },
          texto: "O período pago terminou e o robô está pausado. Assinando de novo ele volta a mandar DM.",
          proximo: "Assinar de novo",
          passo: "assinar_de_novo",
          cancelar: null,
        };
  }
  if (s.status === "estornado") {
    return {
      titulo: "Pagamento estornado",
      ate: { rotulo: "Acesso pago", valor: s.periodoAte ? `acabou em ${periodo}` : "nenhum mês pago" },
      texto: "O pagamento foi devolvido, o mês dele saiu da conta e a cobrança foi cancelada. O robô está pausado.",
      proximo: "Assinar de novo",
      passo: "assinar_de_novo",
      cancelar: null,
    };
  }
  // vencida: o teste acabou (nunca pagou) ou a assinatura passou da tolerância
  if (s.periodoAte === null) {
    return {
      titulo: "O teste acabou",
      ate: { rotulo: "Terminou em", valor: trial },
      texto: "O robô está pausado e não manda DM até tu assinar. Teus dados e tuas automações continuam aqui.",
      proximo: "Assinar",
      passo: "assinar",
      cancelar: "escondido",
    };
  }
  return {
    titulo: "Assinatura vencida",
    ate: { rotulo: "Venceu em", valor: periodo },
    texto: `A cobrança de ${periodo} não entrou e a tolerância de ${carenciaDias} dias acabou. O robô está pausado até tu assinar de novo.`,
    proximo: "Assinar de novo",
    passo: "assinar_de_novo",
    cancelar: "escondido",
  };
}

/**
 * O cartão "Assinatura" da /painel/conta. Server component: só mostra a situação
 * e põe os botões, que chamam ações de servidor (lib/acoes.ts). Na demonstração
 * (`gateway` falso) os botões aparecem, mas as ações recusam sozinhas.
 */
export function Assinatura({
  situacao,
  precoCentavos,
  carenciaDias,
  gateway,
  iniciada,
}: {
  situacao: Situacao | null;
  precoCentavos: number;
  carenciaDias: number;
  gateway: boolean;
  iniciada: boolean;
}) {
  if (!situacao) {
    return (
      <Cartao className="p-5 sm:p-6">
        <p className="text-sm text-suave">Não achei a tua assinatura. Fala com o suporte.</p>
      </Cartao>
    );
  }

  const v = visaoDaAssinatura(situacao, carenciaDias);
  const preco = emReais(precoCentavos);
  const deNovo = v.passo === "assinar_de_novo";

  return (
    <Cartao className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{v.titulo}</h3>
            {situacao.liberada ? <Selo cor="verde">Robô liberado</Selo> : <Selo cor="amarelo">Robô pausado</Selo>}
          </div>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-suave">{v.texto}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-2xl font-bold">{preco}</p>
          <p className="text-xs text-suave">por mês · cartão ou Pix Automático</p>
        </div>
      </div>

      <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-borda bg-borda sm:grid-cols-3">
        {[
          ["Robô", situacao.liberada ? "Liberado, manda DM" : "Pausado, não manda DM"],
          [v.ate.rotulo, v.ate.valor],
          ["Próximo passo", v.proximo],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="bg-superficie-2 px-4 py-3">
            <dt className="text-xs text-suave">{rotulo}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{valor}</dd>
          </div>
        ))}
      </dl>

      {/* Sem assinatura no banco, ou já ativa, não abre checkout: o clique criaria cobrança sem dono certo ou dobrada. */}
      {v.passo !== "nenhum" ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <AssinarCartao preco={preco} deNovo={deNovo} />
          <AssinarPix preco={preco} deNovo={deNovo} />
        </div>
      ) : null}

      {/* Só o clique pede ao gateway; o status muda quando ele avisa. */}
      {v.cancelar === "botao" ? <CancelarAssinatura /> : null}
      {v.cancelar === "escondido" ? (
        <details className="group mt-3 rounded-xl border border-borda px-4 py-3">
          <summary className="cursor-pointer rounded text-sm font-semibold text-suave transition-colors hover:text-texto">
            {situacao.periodoAte === null
              ? "Abriu o checkout ou o QR e quer trocar de cartão para Pix (ou o contrário)?"
              : "Ainda aparece cobrança no teu cartão ou no teu Pix?"}
          </summary>
          <CancelarAssinatura
            semFundo
            texto={
              situacao.periodoAte === null
                ? "Cancela o pedido que ficou aberto. Teu teste segue como está, e depois tu assina pelo outro caminho."
                : "Cancela o que ficou aberto no gateway pra não cobrarem de novo. Depois é só assinar de novo, no cartão ou no Pix."
            }
            rotulo="Cancelar cobrança aberta"
          />
        </details>
      ) : null}

      {!gateway ? (
        <p className="mt-3 text-xs text-apagado">Modo demonstração: os botões aqui não cobram nem cancelam nada de verdade.</p>
      ) : null}

      {iniciada && v.passo !== "nenhum" ? (
        <div className="mt-3">
          <Aviso tipo="info">
            Se tu concluiu o pagamento, a assinatura ativa sozinha em alguns minutos. Recarrega esta página pra conferir.
          </Aviso>
        </div>
      ) : null}
    </Cartao>
  );
}
