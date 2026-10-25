"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Logo, Miniatura } from "@/components/ui";
import {
  IconeComentario,
  IconeCoracao,
  IconeEnvio,
  IconePausa,
  IconePlay,
  IconeRelogio,
  IconeSalvo,
  IconeVoltar,
} from "@/components/icones";
import s from "./landing.module.css";

/**
 * A HISTÓRIA DO COMENTÁRIO, CONTADA PELA ROLAGEM (pedido do Maxwel, 24/10/2026).
 *
 * De um lado o texto (o hero é o ato 0, depois 6 passos); do outro um celular parado, que muda
 * conforme a pessoa rola: o post → o comentário chega → a resposta pública → o direct
 * (enviando… enviado… visto… ela responde) → o painel com quem clicou → a fila de 500.
 * O celular é o Instagram de quem usa o Gatlo AI (o perfil fictício @cafe.da.serra).
 *
 * Quem decide o ato é a rolagem: vale o último marco ([data-ato]) que passou da linha de
 * leitura (meio da tela no computador; logo abaixo do celular no celular). O texto é a fonte
 * pro leitor de tela; o desenho do celular é aria-hidden.
 */

const ULTIMO_ATO = 6;

export function Historia({
  hero,
  porHora,
  janelaDias,
  respostasMax,
  pausa,
}: {
  hero: ReactNode;
  porHora: number;
  janelaDias: number;
  respostasMax: number;
  /** quanto tempo a conta fica parada quando a Meta pede pra esperar, já escrito ("3 h") */
  pausa: string;
}) {
  const palco = useRef<HTMLDivElement>(null);
  const fixo = useRef<HTMLDivElement>(null);
  const [ato, setAto] = useState(0);
  const [fim, setFim] = useState(0); // 0 a 1 dentro do último passo (a fila esvaziando)

  useEffect(() => {
    const raiz = palco.current;
    if (!raiz) return;
    const marcos = [...raiz.querySelectorAll<HTMLElement>("[data-ato]")];
    const lista = raiz.querySelector<HTMLElement>("[data-lista]");
    const largo = matchMedia("(min-width: 1024px)");
    let quadro = 0;

    const mede = () => {
      quadro = 0;
      const vh = innerHeight;
      // no telefone o passo acende já um pouco abaixo da faixa do celular, onde se lê inteiro
      const linha = largo.matches ? vh * 0.5 : (fixo.current?.getBoundingClientRect().bottom ?? vh * 0.6) + vh * 0.16;

      let atual = 0;
      for (const m of marcos) if (m.getBoundingClientRect().top < linha) atual = Number(m.dataset.ato);
      setAto(atual);

      const ultimo = marcos[marcos.length - 1];
      if (ultimo) {
        const r = ultimo.getBoundingClientRect();
        const p = (linha - r.top) / Math.max(1, r.height * 0.8);
        setFim(Math.round(Math.min(1, Math.max(0, p)) * 100) / 100);
      }
      if (lista) {
        const r = lista.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (linha - r.top) / Math.max(1, r.height)));
        raiz.style.setProperty("--progresso", p.toFixed(4));
      }
    };
    const agenda = () => {
      if (!quadro) quadro = requestAnimationFrame(mede);
    };
    agenda();
    addEventListener("scroll", agenda, { passive: true });
    addEventListener("resize", agenda);
    return () => {
      cancelAnimationFrame(quadro);
      removeEventListener("scroll", agenda);
      removeEventListener("resize", agenda);
    };
  }, []);

  const passos = [
    {
      titulo: "Alguém comenta a palavra",
      texto:
        "A Ana comentou RECEITA. Maiúscula e acento não fazem diferença: RECEITA, receita e Receita contam igual. Vale num post escolhido ou em qualquer post do perfil.",
    },
    {
      titulo: "O comentário ganha resposta",
      texto: `Se tu quiser, o Gatlo AI responde em público ("te mandei no direct!"), pra quem chega depois saber que o link vai pela DM. Tem teto de ${respostasMax} respostas por dia, e dá pra desligar.`,
    },
    {
      titulo: "A DM sai sozinha",
      texto: `Tua mensagem chega no direct de quem comentou, com um botão pro teu link. Uma mensagem por comentário, dentro dos ${janelaDias} dias que a Meta dá pra responder um comentário no privado.`,
    },
    {
      titulo: "Ela vê e responde no teu direct",
      texto:
        "A conversa segue contigo, no Instagram de sempre. O Gatlo AI não conversa por ti: ele entrega o link na hora certa.",
    },
    {
      titulo: "Tu vê quem recebeu e quem clicou",
      texto: "No painel: quantos comentaram, quantos receberam, quantos estão na fila e quantos clicaram no link.",
    },
    {
      titulo: "Comentaram 500 de uma vez? Entra na fila",
      texto: `O Instagram limita quantas mensagens uma conta manda por hora. O Gatlo AI manda em ritmo, até uns ${porHora} por hora, e pausa sozinho quando a Meta pede pra esperar. Isso diminui a chance de bloqueio, mas não zera: quem decide o limite é o Instagram.`,
    },
  ];

  return (
    <div ref={palco} className={s.palco}>
      <div data-ato="0" className={s.hero}>
        {hero}
      </div>

      <div className={s.lado} aria-hidden="true">
        <div ref={fixo} className={s.fixo}>
          <Celular ato={ato} fim={fim} porHora={porHora} pausa={pausa} />
        </div>
      </div>

      <div className={s.passosCaixa}>
        <h2 className="sr-only">Do comentário ao clique, passo a passo</h2>
        <div className={s.passos} data-lista>
          <span className={s.trilho} aria-hidden="true">
            <span className={s.trilhoEnche} />
          </span>
          <ol>
            {passos.map((p, i) => {
              const n = i + 1;
              const estado = n < ato ? "feito" : n === ato ? "agora" : "depois";
              return (
                <li key={p.titulo} data-ato={n} data-estado={estado} className={s.passo}>
                  <span className={s.numero} aria-hidden="true">
                    {n}
                  </span>
                  <h3 className={s.passoTitulo}>
                    <span className="sr-only">Passo {n}: </span>
                    {p.titulo}
                  </h3>
                  <p className={s.passoTexto}>{p.texto}</p>
                </li>
              );
            })}
          </ol>
        </div>
        <p className={s.legenda}>Exemplo com perfil e nomes fictícios.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ o celular */

const ANA = "ana.luiza.rs";
const LOJA = "cafe.da.serra";
const FOTO_LOJA = "/demo/avatar";
// as outras duas pessoas que comentaram antes (somam 3 com a Ana)
const OUTRAS = [
  { nome: "bia.doces.poa", quando: "há 2 min", cor: "linear-gradient(135deg, #34d399, #0e7490)" },
  { nome: "marcos.rs", quando: "há 5 min", cor: "linear-gradient(135deg, #7fa6ff, #1e50f0)" },
];
const numero = (n: number) => n.toLocaleString("pt-BR");

function Celular({ ato, fim, porHora, pausa }: { ato: number; fim: number; porHora: number; pausa: string }) {
  // 0 a 2: o post · 3 e 4: o direct · 5 e 6: o painel do Gatlo AI
  const tela = ato <= 2 ? 0 : ato <= 4 ? 1 : 2;
  const pos = (i: number) => (i < tela ? "antes" : i === tela ? "agora" : "depois");

  // Antes da fila: 3 pessoas comentaram e receberam (a Ana clicou). No último passo chegam mais
  // 500 de uma vez, e a fila anda, para quando a Meta pede (meio da rolagem) e volta.
  const antes = 3;
  const naFila = ato === ULTIMO_ATO;
  const enviados = !naFila
    ? 0
    : Math.round(fim < 0.45 ? (fim / 0.45) * 230 : fim < 0.7 ? 230 : 230 + ((fim - 0.7) / 0.3) * 270);
  const pausado = naFila && fim >= 0.45 && fim < 0.7;
  const retomou = naFila && fim >= 0.7;

  return (
    <div className={s.celular}>
      <div className={s.tela}>
        <div className={s.barraStatus}>
          <span>9:41</span>
          <span className={s.ilha} />
          <span className={s.bateria} />
        </div>

        {ato === 1 && (
          <div className={s.notificacao}>
            <span className={s.avatarAna}>A</span>
            <p>
              <b>{ANA}</b> comentou: RECEITA 🙏
            </p>
          </div>
        )}

        <div className={s.cenas}>
          {/* ---------------- o post */}
          <div className={s.cena} data-pos={pos(0)}>
            <div className={s.igTopo}>
              <Avatar src={FOTO_LOJA} nome={LOJA} className="size-[26px] ring-1" />
              <b>{LOJA}</b>
              <span className={s.igMais}>•••</span>
            </div>
            <div className={s.igFoto}>
              <Miniatura src="/demo/miniatura/1?v=2" alt="" className="size-full" />
            </div>
            <div className={s.igAcoes}>
              <IconeCoracao className="size-[21px]" />
              <IconeComentario className="size-[21px]" />
              <IconeEnvio className="size-[21px]" />
              <IconeSalvo className={`size-[21px] ${s.igSalvar}`} />
            </div>
            <div className={s.igTexto}>
              <p>
                <b>1.284 curtidas</b>
              </p>
              <p>
                <b>{LOJA}</b> Bolo de cenoura da vó 🥕 Comenta <b>RECEITA</b> que eu te mando o passo a passo no direct 👇
              </p>
              <p className={s.igMeta}>Ver todos os {ato >= 1 ? 42 : 41} comentários</p>
            </div>
            {ato >= 1 && (
              <div className={`${s.comentario} ${s.comentarioNovo}`}>
                <span className={s.avatarAna}>A</span>
                <div>
                  <p>
                    <b>{ANA}</b> RECEITA 🙏
                  </p>
                  <p className={s.igMeta}>agora · Responder</p>
                </div>
              </div>
            )}
            {ato >= 2 && (
              <div className={`${s.comentario} ${s.comentarioResposta}`}>
                <Avatar src={FOTO_LOJA} nome={LOJA} className="size-[22px] ring-1" />
                <div>
                  <p>
                    <b>{LOJA}</b> Te mandei no direct! 📩
                  </p>
                  <p className={s.igMeta}>
                    agora · <span className={s.seloGatlo}>Gatlo AI</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ---------------- o direct */}
          <div className={s.cena} data-pos={pos(1)}>
            <div className={s.dmTopo}>
              <IconeVoltar className="size-[18px]" />
              <span className={s.avatarAna}>A</span>
              <div>
                <b>{ANA}</b>
                <small>Ana Luiza</small>
              </div>
            </div>
            <div className={s.dmFio}>
              <p className={s.dmContexto}>
                Resposta ao comentário dela
                <span>“RECEITA 🙏”</span>
              </p>
              {ato >= 3 && (
                <div className={s.balaoMeu}>
                  <p>Oi! Aqui está a receita do bolo de cenoura da vó, com o passo a passo 👇</p>
                  <span className={s.balaoBotao}>Ver a receita</span>
                </div>
              )}
              {ato >= 3 && (
                <p key={ato} className={s.dmStatus}>
                  {ato === 3 ? (
                    <>
                      <span className={s.enviando}>
                        <IconeRelogio className="size-3" /> Enviando…
                      </span>
                      <span className={s.enviado}>Enviado</span>
                    </>
                  ) : (
                    <span className={s.visto}>Visto</span>
                  )}
                </p>
              )}
              {ato >= 4 && (
                <div className={s.respostaDela}>
                  <div className={s.digitando}>
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className={s.balaoDela}>
                    <span className={s.avatarAna}>A</span>
                    <p>Amei!! Já salvei aqui 😍 obrigada</p>
                  </div>
                </div>
              )}
            </div>
            <div className={s.dmCampo}>Mensagem…</div>
          </div>

          {/* ---------------- o painel do Gatlo AI */}
          <div className={s.cena} data-pos={pos(2)}>
            <div className={s.gTopo}>
              <Logo tamanho="sm" href={null} />
              <span className={s.gTopoRotulo}>Painel</span>
            </div>
            <div className={s.gCartao}>
              <div className={s.gLinhaTopo}>
                <span className={s.gPalavra}>RECEITA</span>
                <span className={s.gAtiva}>
                  <i /> Ativa
                </span>
              </div>
              <p className={s.gSub}>Post: Bolo de cenoura da vó</p>
            </div>
            <div className={s.gNumeros}>
              <Numero rotulo="Comentaram" valor={numero(antes + (naFila ? 500 : 0))} />
              <Numero rotulo="Receberam" valor={numero(antes + enviados)} destaque />
              <Numero rotulo="Na fila" valor={numero(naFila ? 500 - enviados : 0)} />
              {naFila ? <Numero rotulo="Ritmo" valor={`~${porHora}/h`} /> : <Numero rotulo="Clicaram" valor="1" />}
            </div>
            {naFila ? (
              <div className={s.gFila}>
                <div className={s.gBarra}>
                  <span style={{ transform: `scaleX(${enviados / 500})` }} />
                </div>
                {pausado ? (
                  <p className={s.gPausa}>
                    <IconePausa className="size-3.5 shrink-0" /> O Instagram pediu pra esperar. Volta sozinho em {pausa}.
                  </p>
                ) : retomou ? (
                  <p className={s.gRetomou}>
                    <IconePlay className="size-3.5 shrink-0" /> Retomou de onde parou.
                  </p>
                ) : (
                  <p className={s.gNormal}>Mandando no ritmo do Instagram.</p>
                )}
              </div>
            ) : (
              <div className={s.gLista}>
                <p className={s.gSub}>Agora há pouco</p>
                <div className={s.gPessoa}>
                  <span className={s.avatarAna}>A</span>
                  <div>
                    <b>{ANA}</b>
                    <small>recebeu a DM · abriu o link</small>
                  </div>
                  <span className={s.gClicou}>clicou</span>
                </div>
                {OUTRAS.map((o) => (
                  <div key={o.nome} className={s.gPessoa}>
                    <span className={s.avatarOutra} style={{ background: o.cor }}>
                      {o.nome[0].toUpperCase()}
                    </span>
                    <div>
                      <b>{o.nome}</b>
                      <small>recebeu a DM · {o.quando}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={s.gNumero} data-destaque={destaque ? "" : undefined}>
      <small>{rotulo}</small>
      <b>{valor}</b>
    </div>
  );
}
