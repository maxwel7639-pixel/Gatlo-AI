import { PRODUTO } from "@/lib/config";
import { REGRAS_DEMONSTRACAO, emReais, regras, type Regras } from "@/lib/regras";
import { CabecalhoPublico, Rodape } from "@/components/publico";
import { BotaoLink } from "@/components/ui";
import { IconeCheck, IconeInstagram, IconeLink, IconeSeta, IconeX } from "@/components/icones";
import { Historia } from "@/components/landing/historia";
import { FaixaFuncoes } from "@/components/landing/faixa-funcoes";
import { PalavrasFundo } from "@/components/landing/palavras-fundo";
import { LuzDoCursor } from "@/components/landing/luz-do-cursor";
import s from "@/components/landing/landing.module.css";

// O preço vem da tabela `regras` do banco; a página se refaz a cada hora.
export const revalidate = 3600;

async function regrasParaVitrine(): Promise<Regras> {
  try {
    return await regras();
  } catch (e) {
    console.error("[landing] regras:", (e as Error).message);
    return REGRAS_DEMONSTRACAO;
  }
}

/** 180 → "3 h"; 45 → "45 min" */
const tempo = (min: number) => (min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`);

const FAZ = [
  "Manda o teu link no direct de quem comentou a palavra, uma vez por comentário.",
  "Responde o comentário em público (\"te mandei na DM!\"), se tu quiser.",
  "Funciona num post escolhido ou em qualquer post do perfil.",
  "Mostra quantos comentaram, quantos receberam, quantos estão na fila e quantos clicaram.",
  "Pausa sozinho quando o Instagram pede pra esperar, e continua depois.",
];

const NAO_FAZ = [
  "Não garante que o Instagram nunca vai limitar tua conta: ele limita quem manda muito, e a fila existe por isso.",
  "Não manda mensagem pra quem não comentou, nem pra lista comprada.",
  "Não mostra quem te segue nem quem viu o post.",
  "Não promete venda: ele entrega o link, o resto é a tua oferta.",
  "Não posta nem apaga nada no teu perfil.",
];

export default async function Inicio() {
  const r = await regrasParaVitrine();
  const preco = emReais(r.precoMensalCentavos);
  const porHora = Math.round((60 / 3) * r.envioMaxPorRodada);

  const hero = (
    <div>
      <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-azul/30 bg-azul/10 px-3 py-1 text-xs font-semibold text-azul-claro">
        <IconeInstagram className="size-4" /> Para Instagram profissional
      </p>
      <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
        Quem comentar a palavra recebe o teu link na DM.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-suave">
        Tu escolhe o post, a palavra e a mensagem. O {PRODUTO.nome} manda o link no direct de quem comentou,
        sozinho, numa fila que respeita o limite do Instagram.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <BotaoLink href="/cadastro" tamanho="lg">
          Teste {r.testeDias} dias grátis
        </BotaoLink>
        <p className="text-sm text-suave">Sem cartão no teste. Depois, {preco} por mês.</p>
      </div>
      <p className="mt-10 flex items-center gap-2 text-sm text-suave">
        <IconeSeta className="size-4 shrink-0 rotate-90 text-azul-claro" />
        Rola a página: o celular mostra o caminho, do comentário até o clique.
      </p>
    </div>
  );

  return (
    <>
      <LuzDoCursor />
      <CabecalhoPublico />
      <main className="flex-1">
        {/* ---------------------------------------------------- topo + a história no celular */}
        <section className={s.secao}>
          <PalavrasFundo />
          <Historia
            hero={hero}
            porHora={porHora}
            janelaDias={r.janelaRespostaPrivadaDias}
            respostasMax={r.respostasPublicasMax24h}
            pausa={tempo(r.envioPausaDirectMin)}
          />
        </section>

        {/* ---------------------------------------------------- faixa com as funções */}
        <FaixaFuncoes porHora={porHora} testeDias={r.testeDias} />

        {/* ---------------------------------------------------- faz / não faz */}
        <section className={`${s.comMarca} mx-auto max-w-6xl px-4 pt-28 pb-20 sm:px-6`}>
          <span className={s.marca} aria-hidden="true">
            LIMITES
          </span>
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            O que ele faz, e o que ele não promete
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-suave">
            Pra tu decidir sabendo exatamente o que leva.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className={`${s.cartaoLuz} p-6 sm:p-8`} data-luz>
              <h3 className="text-xl font-bold">O que faz</h3>
              <ul className="mt-5 space-y-3.5">
                {FAZ.map((t) => (
                  <li key={t} className="flex gap-3 leading-relaxed text-texto/90">
                    <IconeCheck className="mt-0.5 size-5 shrink-0 text-verde" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${s.cartaoLuz} p-6 sm:p-8`} data-luz>
              <h3 className="text-xl font-bold">O que não faz</h3>
              <ul className="mt-5 space-y-3.5">
                {NAO_FAZ.map((t) => (
                  <li key={t} className="flex gap-3 leading-relaxed text-texto/90">
                    <IconeX className="mt-0.5 size-5 shrink-0 text-vermelho" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- preço */}
        <section className={`${s.comMarca} mx-auto max-w-6xl px-4 pt-24 pb-24 sm:px-6`}>
          <span className={s.marca} aria-hidden="true">
            {r.testeDias} DIAS
          </span>
          <div className={`${s.cartaoLuz} ${s.cartaoPreco} p-8 sm:p-12`} data-luz>
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">Um plano, sem pegadinha</h2>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold tracking-tight">{preco}</span>
                  <span className="text-suave">por mês</span>
                </p>
                <ul className="mt-6 space-y-2.5 text-texto/90">
                  <li className="flex gap-2.5">
                    <IconeCheck className="size-5 shrink-0 text-verde" /> {r.testeDias} dias grátis, sem cartão
                  </li>
                  <li className="flex gap-2.5">
                    <IconeCheck className="size-5 shrink-0 text-verde" /> Até 50 automações, com até 10 palavras cada
                  </li>
                  <li className="flex gap-2.5">
                    <IconeCheck className="size-5 shrink-0 text-verde" /> No fim do teste, a automação pausa até tu
                    assinar: cartão (Mercado Pago) ou Pix Automático (Asaas)
                  </li>
                  <li className="flex gap-2.5">
                    <IconeLink className="size-5 shrink-0 text-verde" /> Cancela quando quiser, sem multa
                  </li>
                </ul>
              </div>
              <BotaoLink href="/cadastro" tamanho="lg">
                Teste {r.testeDias} dias grátis
              </BotaoLink>
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-suave">
            Precisa de uma conta profissional do Instagram (comercial ou de criador). Conta pessoal não tem acesso
            à API de mensagens da Meta.
          </p>
        </section>
      </main>
      <Rodape />
      {/* o nome, gigante e cortado no fim da página: acende em azul onde o mouse passa */}
      <div className={s.gigante} data-luz aria-hidden="true">
        <p className={s.giganteApagado}>{PRODUTO.nome}</p>
        <p className={s.giganteAceso}>{PRODUTO.nome}</p>
      </div>
    </>
  );
}
