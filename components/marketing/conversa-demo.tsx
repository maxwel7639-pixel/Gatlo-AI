"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { CASOS, CASO_IDS, type CasoId } from "@/lib/site-conteudo";
import { IconeCheck, IconeComentario, IconeCoracao, IconeEnvio, IconeInstagram, IconeLink, IconeSeta, IconeVoltar } from "@/components/icones";
import s from "./marketing.module.css";

const ETAPAS = [
  { nome: "O comentário", titulo: "O interesse tem uma palavra.", texto: "Tu escolhe o post e a palavra. Quando alguém comenta, a Gatlo reconhece o pedido e prepara a mensagem que tu escreveu." },
  { nome: "A entrega", titulo: "O link encontra a pessoa.", texto: "A mensagem sai no direct com o teu link. A fila respeita o ritmo de envio e pausa quando o Instagram pede pra esperar." },
  { nome: "A conversa", titulo: "Daqui pra frente, é contigo.", texto: "A pessoa pode responder no teu Instagram. Tu entra com a atenção, o contexto e o teu jeito de conversar." },
  { nome: "O clique", titulo: "Tu acompanha o caminho.", texto: "No painel, vê os comentários, os envios, a fila e os cliques. O clique leva pra página que tu configurou." },
];

function acompanhaMovimento(avisa: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", avisa);
  return () => media.removeEventListener("change", avisa);
}
const movimentoReduzido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const noServidor = () => false;

/** Ilustração em HTML. Não se conecta ao Instagram nem envia mensagens. */
export function CelularDemo({ caso = "materiais-gratuitos", etapa = 1 }: { caso?: CasoId; etapa?: number }) {
  const c = CASOS[caso];
  return (
    <div className={s.telefone} aria-hidden="true" style={{ "--caso": c.cor } as CSSProperties}>
      <div className={s.telefoneTela}>
        <div className={s.statusBar}><span>9:41</span><span className={s.camera} /><span className={s.bateria} /></div>
        <div className={s.appBar}>
          <IconeVoltar className="size-5" /><span className={s.avatar}>{c.perfil.slice(0, 1).toUpperCase()}</span>
          <div><b>{c.perfil}</b><small>Conta profissional</small></div><IconeInstagram className="ml-auto size-5" />
        </div>
        <div key={`${caso}-${etapa}`} className={s.telaConteudo}>
          {etapa === 0 ? (
            <>
              <Image className={s.capaPost} src={c.capa} alt="" width={1080} height={1350} />
              <div className={s.postIcones}><IconeCoracao /><IconeComentario /><IconeEnvio /></div>
              <p className={s.legendaPost}><b>{c.perfil}</b> {c.legenda}</p>
              <div className={s.comentario}><span className={s.avatarAna}>A</span><p><b>ana.luiza</b><br />{c.comentario}</p><IconeCoracao className="ml-auto size-3" /></div>
            </>
          ) : etapa < 3 ? (
            <>
              <p className={s.dataChat}>Hoje · 9:41</p>
              <div className={s.miniPost}><Image src={c.capa} alt="" width={36} height={45} /><span>Tu comentou<br /><b>{c.palavra}</b></span></div>
              <div className={s.mensagem}><p>{c.mensagem}</p><span className={s.linkMensagem}>{c.botao}<IconeLink className="size-4" /></span></div>
              <p className={s.enviado}><IconeCheck className="size-3" /> Enviado</p>
              {etapa === 2 && <div className={s.mensagemResposta}><span className={s.avatarAna}>A</span><p>{c.resposta}</p></div>}
              <div className={s.campoChat}>Mensagem…<IconeCoracao className="size-4" /></div>
            </>
          ) : (
            <div className={s.painelDemo}>
              <span className={s.painelMarca}>Gatlo AI</span><p>Teu conteúdo em movimento</p>
              <div className={s.automacaoDemo}><span className={s.dot} /> Automação ativa<b>{c.palavra}</b><small>{c.post}</small></div>
              <div className={s.metricasDemo}>{[["Comentaram", "1"], ["Receberam", "1"], ["Na fila", "0"], ["Cliques", "1"]].map(([nome, valor]) => <div key={nome} data-clique={nome === "Cliques" || undefined}><small>{nome}</small><b>{valor}</b></div>)}</div>
              <div className={s.cliqueDemo}><span className={s.avatarAna}>A</span><div><b>ana.luiza</b><small>Recebeu a DM e abriu o link</small></div><IconeCheck className="size-4" /></div>
              <p className={s.notaPainel}>Um clique é um acesso ao link, não uma venda ou um agendamento confirmado.</p>
            </div>
          )}
        </div>
        <div className={s.homeBar} />
      </div>
    </div>
  );
}

export function HeroConversa({ caso = "materiais-gratuitos" }: { caso?: CasoId }) {
  return <div className={s.heroConversa}><span className={s.orbita} aria-hidden="true" /><div className={s.cartaoFlutuante}><IconeComentario className="size-5" /><span>Comentou <b>{CASOS[caso].palavra}</b></span><IconeCheck className="size-4" /></div><CelularDemo caso={caso} etapa={1} /><div className={s.cartaoEntrega}><span className={s.entregaIcone}><IconeEnvio className="size-5" /></span><div><b>O link já chegou.</b><small>Agora a conversa é tua.</small></div></div><span className={s.seloDemo}>Conversa de demonstração</span></div>;
}

export function HistoriaProduto({ caso = "materiais-gratuitos" }: { caso?: CasoId }) {
  const trilho = useRef<HTMLElement>(null);
  const [etapa, setEtapa] = useState(0);
  const reduz = useSyncExternalStore(acompanhaMovimento, movimentoReduzido, noServidor);

  useEffect(() => {
    const el = trilho.current;
    if (!el || reduz) return;
    let quadro = 0;
    const mede = () => {
      quadro = 0;
      const r = el.getBoundingClientRect();
      const percurso = Math.max(1, r.height - innerHeight + 72);
      const p = Math.max(0, Math.min(0.999, (72 - r.top) / percurso));
      setEtapa(Math.floor(p * ETAPAS.length));
    };
    const agenda = () => { if (!quadro) quadro = requestAnimationFrame(mede); };
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { addEventListener("scroll", agenda, { passive: true }); agenda(); }
      else removeEventListener("scroll", agenda);
    });
    obs.observe(el);
    addEventListener("resize", agenda);
    return () => { obs.disconnect(); cancelAnimationFrame(quadro); removeEventListener("scroll", agenda); removeEventListener("resize", agenda); };
  }, [reduz]);

  function escolhe(i: number) {
    if (reduz || !trilho.current) { setEtapa(i); return; }
    const r = trilho.current.getBoundingClientRect();
    const percurso = Math.max(1, r.height - innerHeight + 72);
    window.scrollTo({ top: scrollY + r.top - 72 + percurso * ((i + 0.25) / ETAPAS.length), behavior: "instant" });
  }

  return (
    <section id="como-funciona" ref={trilho} className={s.historia} data-reduz={reduz || undefined} aria-labelledby="historia-titulo">
      <div className={s.historiaPalco}>
        <div className={s.historiaTexto}>
          <p className={s.sobreTitulo}>Do post ao próximo passo</p>
          <h2 id="historia-titulo">Uma palavra.<br />Uma conversa inteira pela frente.</h2>
          <div className={s.navegacaoEtapas} aria-label="Etapas da demonstração">{ETAPAS.map((e, i) => <button type="button" key={e.nome} onClick={() => escolhe(i)} aria-current={etapa === i ? "step" : undefined} aria-label={`Etapa ${i + 1}: ${e.nome}`}><span>0{i + 1}</span><b>{e.nome}</b></button>)}</div>
          <div className={s.textoEtapa}>
            <h3>{ETAPAS[etapa].titulo}</h3><p>{ETAPAS[etapa].texto}</p>
          </div>
          <p className={s.dicaScroll}>Rola pra acompanhar ou escolhe uma etapa acima.</p>
        </div>
        <div className={s.historiaVisual}><span className={s.numeroGigante} aria-hidden="true">0{etapa + 1}</span><CelularDemo caso={caso} etapa={etapa} /><p className={s.demoLegenda}>Exemplo fictício. A resposta é da pessoa, no Instagram.</p></div>
      </div>
    </section>
  );
}

export function Exemplos({ inicial = "materiais-gratuitos" }: { inicial?: CasoId }) {
  const [caso, setCaso] = useState<CasoId>(inicial);
  const [etapa, setEtapa] = useState(0);
  const id = useId();
  function muda(novo: CasoId) { setCaso(novo); setEtapa(0); }
  function navega(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let proximo = i;
    if (e.key === "ArrowRight") proximo = (i + 1) % CASO_IDS.length;
    else if (e.key === "ArrowLeft") proximo = (i + CASO_IDS.length - 1) % CASO_IDS.length;
    else if (e.key === "Home") proximo = 0;
    else if (e.key === "End") proximo = CASO_IDS.length - 1;
    else return;
    e.preventDefault(); muda(CASO_IDS[proximo]); document.getElementById(`${id}-${CASO_IDS[proximo]}`)?.focus();
  }
  return (
    <section id="exemplos" className={s.exemplos} aria-labelledby="exemplos-titulo">
      <div className={s.container}>
        <div className={s.cabSecao}><div><p className={s.sobreTitulo}>Vê a ideia acontecer</p><h2 id="exemplos-titulo">Teu link.<br />Muitos começos.</h2></div><p>Escolhe um exemplo e avança a conversa.<br />É uma demonstração: nada é enviado.</p></div>
        <div className={s.exemploQuadro} style={{ "--caso": CASOS[caso].cor } as CSSProperties}>
          <div className={s.exemploEsquerda}>
            <div className={s.abas} role="tablist" aria-label="Tipo de exemplo">{CASO_IDS.map((c, i) => <button key={c} id={`${id}-${c}`} type="button" role="tab" aria-selected={caso === c} aria-controls={`${id}-painel`} tabIndex={caso === c ? 0 : -1} onClick={() => muda(c)} onKeyDown={(e) => navega(e, i)}>{CASOS[c].curto}</button>)}</div>
            <div role="tabpanel" id={`${id}-painel`} aria-labelledby={`${id}-${caso}`} tabIndex={0} className={s.exemploDescricao}>
              <span className={s.palavraExemplo}>{CASOS[caso].palavra}</span><h3>{CASOS[caso].destaque}</h3><p>{CASOS[caso].descricao}</p>
              <Link href={`/solucoes/${caso}`} className={s.linkTexto}>Conhecer esse uso<IconeSeta className="size-5" /></Link>
            </div>
          </div>
          <div className={s.exemploVisual}><CelularDemo caso={caso} etapa={etapa} /></div>
          <div className={s.exemploControle}>
            <p className={s.sobreTitulo}>Passo {etapa + 1} de 4</p>
            <h4>{ETAPAS[etapa].nome}</h4><p>{ETAPAS[etapa].texto}</p>
            <div className={s.botoesEtapa} aria-label="Controlar a conversa">{ETAPAS.map((e, i) => <button type="button" key={e.nome} aria-label={`Ver ${e.nome.toLowerCase()}`} aria-pressed={etapa === i} onClick={() => setEtapa(i)}>{i + 1}</button>)}</div>
            <button type="button" className={s.botaoEscuro} onClick={() => setEtapa((etapa + 1) % ETAPAS.length)}>{etapa === 3 ? "Ver de novo" : "Próximo passo"}<IconeSeta className="size-5" /></button>
            <span className={s.exemploNota}>Tu configura a mensagem.<br />A Gatlo entrega o link.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
