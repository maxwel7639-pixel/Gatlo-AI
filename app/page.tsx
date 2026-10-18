import { PRODUTO } from "@/lib/config";
import { REGRAS_DEMONSTRACAO, emReais, regras, type Regras } from "@/lib/regras";
import { CabecalhoPublico, Rodape } from "@/components/publico";
import { BotaoLink, Cartao } from "@/components/ui";
import { PreviaCelular } from "@/components/previa-celular";
import {
  IconeCheck,
  IconeComentario,
  IconeEnvio,
  IconeFila,
  IconeInstagram,
  IconeLink,
  IconeX,
} from "@/components/icones";

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

  return (
    <>
      <CabecalhoPublico />
      <main className="flex-1">
        {/* ---------------------------------------------------- topo */}
        <section className="brilho-topo">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20">
            <div>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-azul/30 bg-azul/10 px-3 py-1 text-xs font-semibold text-azul-claro">
                <IconeInstagram className="size-4" /> Para Instagram profissional
              </p>
              <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Quem comentar a palavra recebe o teu link na DM.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-suave">
                Tu escolhe o post, a palavra e a mensagem. O {PRODUTO.nome} manda o link no direct de
                quem comentou, sozinho, numa fila que respeita o limite do Instagram.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <BotaoLink href="/cadastro" tamanho="lg">
                  Teste {r.testeDias} dias grátis
                </BotaoLink>
                <p className="text-sm text-suave">Sem cartão no teste. Depois, {preco} por mês.</p>
              </div>
            </div>
            <PreviaCelular
              animar
              d={{
                username: "cafe.da.serra",
                fotoUrl: "/demo/avatar",
                miniatura: "/demo/miniatura/1?v=2",
                autor: "ana.luiza.rs",
                comentario: "RECEITA 🙏",
                respostaPublica: "Te mandei no direct! 📩",
                mensagem: "Oi! Aqui está a receita do bolo de cenoura da vó, com o passo a passo completo 👇",
                botao: "Ver a receita",
                linkExibido: "Link do botão: a página que tu escolher",
              }}
            />
          </div>
        </section>

        {/* ---------------------------------------------------- como funciona */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">Como funciona</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                icone: <IconeInstagram className="size-6" />,
                titulo: "1. Conecta o Instagram",
                texto: "Login oficial do Instagram. A gente nunca vê nem guarda a tua senha.",
              },
              {
                icone: <IconeComentario className="size-6" />,
                titulo: "2. Escolhe post e palavra",
                texto: "Um post específico ou qualquer post. Maiúscula e acento não fazem diferença: QUERO e quero contam igual.",
              },
              {
                icone: <IconeEnvio className="size-6" />,
                titulo: "3. Quem comenta recebe",
                texto: "A pessoa recebe a tua mensagem com um botão pro link. Tu acompanha quem recebeu e quem clicou.",
              },
            ].map((p) => (
              <Cartao key={p.titulo} className="p-6">
                <div className="mb-4 grid size-11 place-items-center rounded-xl bg-azul/15 text-azul-claro">
                  {p.icone}
                </div>
                <h3 className="text-lg font-bold">{p.titulo}</h3>
                <p className="mt-2 leading-relaxed text-suave">{p.texto}</p>
              </Cartao>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- a fila */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <Cartao className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[auto_1fr] lg:items-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-amarelo/10 text-amarelo">
              <IconeFila className="size-7" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">A fila que respeita o limite do Instagram</h2>
              <p className="mt-3 max-w-3xl leading-relaxed text-suave">
                O Instagram limita quantas mensagens uma conta manda por hora. Se 500 pessoas comentarem de uma
                vez, o {PRODUTO.nome} não dispara tudo junto: manda em ritmo (até uns {porHora} por hora) e, se a
                Meta pedir pra esperar, pausa a tua conta e continua depois. Quem comentou fica na fila e recebe
                dentro do prazo que a Meta dá pra responder um comentário no direct ({r.janelaRespostaPrivadaDias}{" "}
                dias). Isso diminui a chance de bloqueio, mas não zera: quem decide o limite é o Instagram.
              </p>
            </div>
          </Cartao>
        </section>

        {/* ---------------------------------------------------- faz / não faz */}
        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:px-6 md:grid-cols-2">
          <Cartao className="p-6 sm:p-8">
            <h2 className="text-xl font-bold">O que faz</h2>
            <ul className="mt-5 space-y-3.5">
              {FAZ.map((t) => (
                <li key={t} className="flex gap-3 leading-relaxed text-texto/90">
                  <IconeCheck className="mt-0.5 size-5 shrink-0 text-verde" />
                  {t}
                </li>
              ))}
            </ul>
          </Cartao>
          <Cartao className="p-6 sm:p-8">
            <h2 className="text-xl font-bold">O que não faz</h2>
            <ul className="mt-5 space-y-3.5">
              {NAO_FAZ.map((t) => (
                <li key={t} className="flex gap-3 leading-relaxed text-texto/90">
                  <IconeX className="mt-0.5 size-5 shrink-0 text-vermelho" />
                  {t}
                </li>
              ))}
            </ul>
          </Cartao>
        </section>

        {/* ---------------------------------------------------- preço */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-azul/30 bg-gradient-to-br from-azul/20 via-superficie to-superficie p-8 sm:p-12">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">Um plano, sem pegadinha</h2>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold tracking-tight">{preco}</span>
                  <span className="text-suave">por mês</span>
                </p>
                <ul className="mt-6 space-y-2.5 text-texto/90">
                  <li className="flex gap-2.5"><IconeCheck className="size-5 text-verde" /> {r.testeDias} dias grátis, sem cartão</li>
                  <li className="flex gap-2.5"><IconeCheck className="size-5 text-verde" /> Até 50 automações, com até 10 palavras cada</li>
                  {/* Só cartão por enquanto: voltar a citar Pix Automático quando o C2 existir. */}
                  <li className="flex gap-2.5"><IconeCheck className="size-5 text-verde" /> No fim do teste, a automação pausa até tu assinar: cartão (Mercado Pago)</li>
                  <li className="flex gap-2.5"><IconeLink className="size-5 text-verde" /> Cancela quando quiser, sem multa</li>
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
    </>
  );
}
