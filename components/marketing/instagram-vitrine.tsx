"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { IconeCheck, IconeComentario, IconeCoracao, IconeEnvio, IconeInstagram, IconeLink, IconeVoltar } from "@/components/icones";
import { useMovimentoReduzido } from "./conversa-demo";
import s from "./marketing.module.css";

const FOTO = "/landing/instagram-criadora.webp";
const RECURSOS = [
  { titulo: "Transforma comentários em próximos passos.", texto: "Teu post desperta o interesse. Uma palavra nos comentários dá o caminho pra entregar o link e começar uma conversa.", etiqueta: "Do post ao pedido", detalhe: "A pessoa comenta a palavra que tu escolheu." },
  { titulo: "O link chega. Sem copiar e colar.", texto: "Guia, catálogo ou agenda: a mensagem que tu preparou vai pro direct de quem pediu. Cada convite tem o teu jeito.", etiqueta: "Do pedido à DM", detalhe: "A mensagem é tua. A entrega fica com a Gatlo." },
  { titulo: "A conversa continua contigo.", texto: "A pessoa pode responder no teu Instagram. Tu segue de onde ela está, com atenção e contexto pra dar o próximo passo.", etiqueta: "Da entrega à conversa", detalhe: "Tu conversa no Instagram de sempre." },
  { titulo: "Vê o caminho que teu conteúdo abriu.", texto: "Acompanha quem comentou, quem recebeu, o que está na fila e os cliques no link. Mais clareza pra escolher teu próximo convite.", etiqueta: "Do conteúdo ao clique", detalhe: "Clique contado. O próximo passo é no teu link." },
];

export function FotoInstagram() {
  const ref = useRef<HTMLElement>(null);
  const [ativo, setAtivo] = useState(0);
  const reduz = useMovimentoReduzido();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduz) return;
    let quadro = 0;
    const mede = () => {
      quadro = 0;
      const r = el.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (80 - r.top) / Math.max(1, r.height * .8)));
      el.style.setProperty("--foto-p", p.toFixed(4));
      setAtivo(Math.min(3, Math.floor(p * 4)));
    };
    const agenda = () => { if (!quadro) quadro = requestAnimationFrame(mede); };
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { addEventListener("scroll", agenda, { passive: true }); agenda(); }
      else removeEventListener("scroll", agenda);
    });
    obs.observe(el); addEventListener("resize", agenda);
    return () => { obs.disconnect(); cancelAnimationFrame(quadro); removeEventListener("scroll", agenda); removeEventListener("resize", agenda); };
  }, [reduz]);
  return <section ref={ref} className={s.fotoInstagram} aria-label="Do teu conteúdo à conversa"><div className={s.fotoMoldura}><Image src={FOTO} alt="Criadora de conteúdo usando o celular em seu espaço de trabalho. Imagem ilustrativa gerada por IA." fill sizes="100vw" loading="eager" /><div className={s.fotoSombra} /><div className={s.fotoChecklist}><p>Menos tarefa no direct.</p><ul>{["Entrega teu link", "Responde o comentário", "Organiza os envios", "Acompanha os cliques"].map((t,i)=><li key={t} data-ativo={i===ativo || undefined}><IconeCheck /><span>{t}</span></li>)}</ul></div><div className={s.fotoBalao}><span><IconeEnvio className="size-4" /> Gatlo AI</span><p>Quem pediu o guia já recebeu o link.</p><b>Agora tu continua a conversa.</b></div></div></section>;
}

function MockupInstagram({ etapa }: { etapa: number }) {
  return <div className={s.igMockup} aria-hidden="true">
    <div className={s.igMockTopo}>{etapa>0 && <IconeVoltar className="size-5" />}<span className={s.igAvatar}>F</span><b>feed.criativo</b><IconeInstagram className="ml-auto size-6" /></div>
    <div className={s.igMockConteudo} key={etapa}>
      {etapa===0 ? <><div className={s.igPostFoto}><Image src={FOTO} alt="" fill sizes="(max-width: 767px) 80vw, 440px" /><p>Um post pode abrir<br />muitas conversas.</p></div><div className={s.igPostRodape}><div><IconeCoracao /><IconeComentario /><IconeEnvio /></div><p>Quer as 10 ideias de post?<br />Comenta <b>IDEIAS</b> que eu te mando o guia.</p></div><div className={s.igComentarioNovo}><span className={s.igAvatarAna}>A</span><p><b>ana.luiza</b><br />IDEIAS! Quero esse guia.</p><IconeCoracao className="ml-auto size-4" /></div></> : etapa<3 ? <><p className={s.igHoje}>Hoje · 9:41</p><div className={s.igContexto}><Image src="/landing/ideias.svg" alt="" width={50} height={62} /><p>Teu comentário no post<br /><b>IDEIAS! Quero esse guia.</b></p></div><div className={s.igDirect}><p>Oi, Ana! Aqui estão as 10 ideias de post que tu pediu. Salva pra quando faltar inspiração.</p><span>Abrir o guia<IconeLink className="size-5" /></span></div><p className={s.igEnviado}><IconeCheck className="size-3" /> Enviado</p>{etapa===2 && <div className={s.igResposta}><span className={s.igAvatarAna}>A</span><p>Era isso que eu precisava! Já escolhi a primeira.</p></div>}<div className={s.igCampo}>Mensagem…<IconeCoracao className="size-5" /></div></> : <div className={s.igPainel}><p>Gatlo AI</p><h3>O movimento<br />do teu post.</h3><div className={s.igMetricas}>{[["Comentaram","24"],["Receberam","21"],["Na fila","3"],["Cliques","12"]].map(([nome,n])=><div key={nome}><small>{nome}</small><b>{n}</b></div>)}</div><div className={s.igClique}><IconeCheck className="size-5" /><p>ana.luiza abriu o guia.<small>Agora há pouco · exemplo fictício</small></p></div><span className={s.igNota}>Um clique não é uma venda.<br />É uma pessoa seguindo o teu convite.</span></div>}
    </div>
  </div>;
}

export function RecursosInstagram() {
  const trilho = useRef<HTMLElement>(null);
  const [etapa, setEtapa] = useState(0);
  const reduz = useMovimentoReduzido();
  useEffect(() => {
    const el=trilho.current;
    if(!el || reduz) return;
    let quadro=0;
    const mede=()=>{quadro=0;const r=el.getBoundingClientRect();const p=Math.max(0,Math.min(.999,(72-r.top)/Math.max(1,r.height-innerHeight+72)));setEtapa(Math.floor(p*RECURSOS.length));};
    const agenda=()=>{if(!quadro)quadro=requestAnimationFrame(mede);};
    const obs=new IntersectionObserver(([e])=>{if(e.isIntersecting){addEventListener("scroll",agenda,{passive:true});agenda();}else removeEventListener("scroll",agenda);});
    obs.observe(el);addEventListener("resize",agenda);
    return()=>{obs.disconnect();cancelAnimationFrame(quadro);removeEventListener("scroll",agenda);removeEventListener("resize",agenda);};
  },[reduz]);
  function escolhe(i:number){
    if(reduz || !trilho.current){setEtapa(i);return;}
    const r=trilho.current.getBoundingClientRect();const percurso=Math.max(1,r.height-innerHeight+72);
    window.scrollTo({top:scrollY+r.top-72+percurso*((i+.2)/RECURSOS.length),behavior:"instant"});
  }
  const atual=RECURSOS[etapa];
  return <section id="como-funciona" ref={trilho} className={s.igRecursos} data-reduz={reduz || undefined} aria-label="Recursos do Instagram"><div className={s.igRecursosPalco}><div className={s.igRecursoTexto}><div className={s.igProgresso} aria-label="Capítulos dos recursos">{RECURSOS.map((r,i)=><button key={r.titulo} type="button" aria-label={`Recurso ${i+1}: ${r.titulo}`} aria-current={etapa===i?"step":undefined} onClick={()=>escolhe(i)}><span className="sr-only">{i+1}</span></button>)}</div><div className={s.igRecursoCopy} key={etapa}><h2>{atual.titulo}</h2><p>{atual.texto}</p></div><span className={s.igAjudaScroll}>Rola pra ver o próximo capítulo.</span></div><div className={s.igRecursoVisual}><MockupInstagram etapa={etapa} /><div className={s.igEtiqueta}><span>{atual.etiqueta}</span><b>{etapa+1}/4</b></div><p>{atual.detalhe}</p></div></div></section>;
}
