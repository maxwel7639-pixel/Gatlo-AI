import Link from "next/link";
import { Logo } from "@/components/ui";
import { IconeCheck, IconeComentario, IconeEnvio, IconeLink, IconeSeta } from "@/components/icones";
import { CASOS, CASO_IDS, type CasoId } from "@/lib/site-conteudo";
import { PRODUTO } from "@/lib/config";
import s from "./marketing.module.css";

export function FaixaEtapas() {
  const linha = <><b>Um comentário abre a conversa</b><IconeComentario /><b>A Gatlo entrega teu link</b><IconeEnvio /><b>Tu cuida do próximo passo</b><IconeLink /></>;
  return <div className={s.faixa}><div className={s.faixaTrilho}><span>{linha}</span><span aria-hidden="true">{linha}</span></div></div>;
}

export function CasosDeUso({ atual }: { atual?: CasoId }) {
  return (
    <section className={s.usos} aria-labelledby="usos-titulo"><div className={s.container}>
      <div className={s.cabSecao}><div><p className={s.sobreTitulo}>Feito pra entrar na tua rotina</p><h2 id="usos-titulo">O próximo passo<br />tem o teu jeito.</h2></div><p>O mesmo caminho, com o link que faz sentido pro teu negócio.</p></div>
      <div className={s.cardsUsos}>{CASO_IDS.filter(c => c !== atual).map((id, i) => <Link key={id} href={`/solucoes/${id}`} className={s.cardUso} style={{ "--caso": CASOS[id].cor } as React.CSSProperties}><span>0{i + 1} / {CASOS[id].nome}</span><div className={s.seloUso}><IconeLink /></div><h3>{CASOS[id].destaque}</h3><p>{CASOS[id].descricao}</p><span className={s.setaCard}><IconeSeta className="size-6" /></span></Link>)}</div>
    </div></section>
  );
}

export function ComoComecar({ caso }: { caso?: CasoId }) {
  const passos = caso ? CASOS[caso].passos.map((titulo, i) => ({ titulo, texto: ["Começa com um convite que tenha a ver com o teu conteúdo e com quem te acompanha.", "Tu decide a palavra, a mensagem e o link. Vê a prévia antes de ligar a automação.", "Acompanha os envios e os cliques no painel. A conversa continua no teu Instagram."][i] })) : [
    { titulo: "Conecta teu Instagram.", texto: "Usa uma conta profissional, comercial ou de criador, e autoriza a conexão pelo Instagram." },
    { titulo: "Escolhe o convite.", texto: "Define o post, a palavra, a mensagem e o link. Confere como a entrega vai aparecer." },
    { titulo: "Publica. Acompanha. Conversa.", texto: "A Gatlo entrega o link. Tu acompanha o movimento no painel e segue a conversa com as pessoas." },
  ];
  return <section className={s.passos}><div className={s.container}><div className={s.cabSecao}><div><p className={s.sobreTitulo}>Pra começar</p><h2>Três escolhas.<br />Teu link em movimento.</h2></div><Link href="/cadastro" className={s.linkTexto}>Criar minha conta<IconeSeta className="size-5" /></Link></div><div className={s.passosGrade}>{passos.map((p, i) => <div key={p.titulo}><span className={s.passoNumero}>0{i + 1}</span><h3>{p.titulo}</h3><p>{p.texto}</p></div>)}</div></div></section>;
}

export function Beneficio({ caso }: { caso: CasoId }) {
  const c = CASOS[caso];
  return <section className={s.beneficio}><span className={s.beneficioMarca} aria-hidden="true">{c.palavra}</span><div className={`${s.container} ${s.beneficioGrade}`}><div><p className={s.sobreTitulo}>O conteúdo abre a porta</p><h2>{c.beneficio}</h2></div><div><p>{c.explicacao}</p><ul>{c.usos.map(u => <li key={u}><IconeCheck className="size-5" />{u}</li>)}</ul></div></div></section>;
}

export function Perguntas({ caso }: { caso?: CasoId }) {
  const perguntas = [
    ...(caso ? [{ p: CASOS[caso].pergunta, r: CASOS[caso].respostaFaq }] : []),
    { p: "Preciso saber programar?", r: "Não. Tu escolhe o post, escreve as palavras que vão ativar a automação e prepara a mensagem com o link. O painel mostra uma prévia antes de tu ativar." },
    { p: "Funciona com qualquer conta do Instagram?", r: "Precisa ser uma conta profissional, comercial ou de criador. A conexão e os recursos disponíveis dependem das permissões liberadas pelo Instagram para a conta e para o app." },
    { p: "A Gatlo responde toda a conversa por mim?", r: "Não. A Gatlo entrega a mensagem e o link configurados para quem comentou a palavra. As respostas seguintes continuam no teu Instagram, contigo." },
    { p: "E se muita gente comentar ao mesmo tempo?", r: "Os envios entram numa fila. A Gatlo envia em rodadas e pausa se o Instagram pedir pra esperar. Isso organiza o envio; não é uma garantia contra limites ou bloqueios impostos pela plataforma." },
    { p: "Posso usar um link que já tenho?", r: "Sim. Pode ser o teu site, catálogo, material ou agenda externa. O clique passa pelo link da automação para ser contado e segue para o destino que tu escolheu." },
  ];
  return <section className={s.faq}><div className={`${s.container} ${s.faqGrade}`}><div><p className={s.sobreTitulo}>Sem dúvida no próximo passo</p><h2>Antes do<br />primeiro convite.</h2><p className={s.faqIntro}>O que tu precisa saber pra usar a Gatlo com clareza.</p></div><div className={s.faqLista}>{perguntas.map(q => <details key={q.p}><summary>{q.p}</summary><p>{q.r}</p></details>)}</div></div></section>;
}

export function Convite() {
  return <section className={s.convite}><div className={s.container}><p className={s.sobreTitulo}>Teu próximo post pode começar uma conversa</p><h2>Tu cria o conteúdo.<br />A Gatlo leva o link.</h2><p>Menos copiar e colar. Mais tempo pra quem já demonstrou interesse.</p><Link href="/cadastro" className={s.botaoClaro}>Começar meu teste<IconeSeta className="size-5" /></Link></div></section>;
}

export function RodapeSite() {
  return <footer className={s.rodape}><div className={s.container}><div className={s.rodapeGrade}><div className={s.rodapeSobre}><Logo /><p>Do comentário ao link na DM.<br />Um produto da {PRODUTO.empresa}, em {PRODUTO.cidade}.</p></div><nav aria-label="Produto e soluções"><b>Explora a Gatlo</b><Link href="/produto/instagram">Instagram</Link>{CASO_IDS.map(c => <Link key={c} href={`/solucoes/${c}`}>{CASOS[c].nome}</Link>)}<Link href="/#preco">Preço e teste</Link></nav><nav aria-label="Ajuda e informações legais"><b>Vamos conversar</b><a href={`mailto:${PRODUTO.emailSuporte}`}>{PRODUTO.emailSuporte}</a><Link href="/entrar">Entrar na minha conta</Link><Link href="/termos">Termos de uso</Link><Link href="/privacidade">Privacidade</Link><Link href="/exclusao-de-dados">Exclusão de dados</Link></nav></div><div className={s.rodapeBase}><span>Gatlo AI · MX Digital</span><span>Instagram é uma marca da Meta. A Gatlo é um produto independente.</span></div></div><div className={s.rodapeNome} aria-hidden="true">Gatlo AI</div></footer>;
}
