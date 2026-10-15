"use client";

import { useActionState, useId, useState } from "react";
import { salvarAutomacao, type EstadoAutomacao } from "@/lib/acoes";
import { LIMITES } from "@/lib/automacao-validar";
import { limparPalavras, palavraQueBateu } from "@/lib/palavras";
import { PreviaCelular } from "../previa-celular";
import { Aviso, Campo, Miniatura, classeBotao, classeEntrada } from "../ui";
import { IconeCheck, IconeRaio, IconeX } from "../icones";

export type PostEscolha = {
  id: string;
  miniatura: string | null;
  legenda: string;
  data: string;
};

export type ValoresIniciais = {
  id?: string;
  nome: string;
  qualquerPost: boolean;
  mediaId: string | null;
  palavras: string[];
  mensagemDm: string;
  linkUrl: string;
  linkTitulo: string;
  respostaPublica: string | null;
  ativa: boolean;
  /** retrato guardado (quando o post já não está entre os últimos) */
  miniaturaGuardada?: string | null;
};

const inicial: EstadoAutomacao = {};

function Contador({ atual, max }: { atual: number; max: number }) {
  return (
    <span className={`numeros text-xs ${atual > max ? "font-semibold text-vermelho" : "text-apagado"}`}>
      {atual}/{max}
    </span>
  );
}

function Erro({ texto }: { texto?: string }) {
  return texto ? <p className="text-sm font-medium text-vermelho">{texto}</p> : null;
}

export function FormAutomacao({
  posts,
  postsErro,
  valores,
  conta,
  linkCurto,
}: {
  posts: PostEscolha[];
  postsErro?: string;
  valores: ValoresIniciais;
  conta: { username: string; fotoUrl: string | null };
  linkCurto: string;
}) {
  const [estado, acao, salvando] = useActionState(salvarAutomacao, inicial);
  const erros = estado.erros ?? {};
  const ids = useId();

  const [alvo, setAlvo] = useState<"post" | "qualquer">(valores.qualquerPost ? "qualquer" : "post");
  const [mediaId, setMediaId] = useState<string | null>(valores.mediaId);
  const [palavras, setPalavras] = useState<string[]>(valores.palavras);
  const [digitando, setDigitando] = useState("");
  const [mensagem, setMensagem] = useState(valores.mensagemDm);
  const [link, setLink] = useState(valores.linkUrl);
  const [titulo, setTitulo] = useState(valores.linkTitulo);
  const [responder, setResponder] = useState(Boolean(valores.respostaPublica));
  const [resposta, setResposta] = useState(valores.respostaPublica ?? "Te mandei no direct! 📩");
  const [teste, setTeste] = useState("");

  const postEscolhido = posts.find((p) => p.id === mediaId);
  const miniatura =
    alvo === "qualquer" ? posts[0]?.miniatura ?? null : postEscolhido?.miniatura ?? valores.miniaturaGuardada ?? null;

  function adicionar(texto: string) {
    const novas = texto.split(",").map((p) => p.trim()).filter(Boolean);
    if (!novas.length) return;
    setPalavras((atuais) => limparPalavras([...atuais, ...novas]).slice(0, LIMITES.palavras));
    setDigitando("");
  }

  const bateu = teste ? palavraQueBateu(teste, palavras) : null;
  const exemploComentario = palavras[0] ? `${palavras[0]} 🙏` : "";

  return (
    <form action={acao} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      {valores.id ? <input type="hidden" name="id" value={valores.id} /> : null}
      <input type="hidden" name="alvo" value={alvo} />
      <input type="hidden" name="mediaId" value={alvo === "post" ? mediaId ?? "" : ""} />
      {palavras.map((p) => (
        <input key={p} type="hidden" name="palavras" value={p} />
      ))}

      <div className="min-w-0 space-y-8">
        {erros.geral ? <Aviso tipo="erro">{erros.geral}</Aviso> : null}

        {/* ------------------------------------------------ 1. post */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">1. Em qual post?</h2>
            <p className="text-sm text-suave">Um post específico, ou qualquer post do perfil (inclusive os próximos).</p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-superficie-2 p-1 sm:inline-grid">
            {(
              [
                ["post", "Um post"],
                ["qualquer", "Qualquer post"],
              ] as const
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                onClick={() => setAlvo(v)}
                aria-pressed={alvo === v}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  alvo === v ? "bg-azul text-white" : "text-suave hover:text-texto"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {alvo === "post" ? (
            postsErro ? (
              <Aviso tipo="erro">{postsErro}</Aviso>
            ) : (
              <div className="grid max-h-[22rem] grid-cols-3 gap-2 overflow-y-auto rounded-2xl border border-borda bg-superficie p-2 sm:grid-cols-4 md:grid-cols-5">
                {posts.map((p) => {
                  const sim = p.id === mediaId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setMediaId(p.id)}
                      aria-pressed={sim}
                      title={p.legenda}
                      className={`group relative aspect-[4/5] overflow-hidden rounded-xl ring-2 transition ${
                        sim ? "ring-azul-claro" : "ring-transparent hover:ring-borda-forte"
                      }`}
                    >
                      <Miniatura src={p.miniatura} alt={p.legenda} className="size-full" />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1 text-left text-[10.5px] font-semibold text-white">
                        {p.data}
                      </span>
                      {sim ? (
                        <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-azul text-white">
                          <IconeCheck className="size-4" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <p className="rounded-xl border border-borda bg-superficie px-4 py-3 text-sm leading-relaxed text-suave">
              Vale pra todos os posts. Se outra automação usar a mesma palavra num post específico, a do post
              específico tem a preferência.
            </p>
          )}
          <Erro texto={erros.mediaId} />
        </section>

        {/* ------------------------------------------------ 2. palavras */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">2. Qual palavra?</h2>
            <p className="text-sm text-suave">Quem comentar uma destas palavras recebe a DM. Até {LIMITES.palavras}.</p>
          </div>
          <div className="rounded-xl border border-borda-forte bg-superficie-2 p-2 focus-within:border-azul-claro">
            <div className="flex flex-wrap gap-1.5">
              {palavras.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded-lg bg-azul/20 py-1 pr-1 pl-2.5 text-sm font-semibold text-azul-claro">
                  {p.toUpperCase()}
                  <button
                    type="button"
                    onClick={() => setPalavras((a) => a.filter((x) => x !== p))}
                    className="grid size-5 place-items-center rounded-md hover:bg-azul/30"
                    aria-label={`Tirar ${p}`}
                  >
                    <IconeX className="size-3.5" />
                  </button>
                </span>
              ))}
              <input
                id={`${ids}-palavra`}
                value={digitando}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.endsWith(",")) adicionar(v);
                  else setDigitando(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionar(digitando);
                  } else if (e.key === "Backspace" && !digitando && palavras.length) {
                    setPalavras((a) => a.slice(0, -1));
                  }
                }}
                onBlur={() => adicionar(digitando)}
                placeholder={palavras.length ? "Mais uma…" : "Ex.: QUERO, LINK, RECEITA"}
                maxLength={LIMITES.palavra}
                className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-[15px] outline-none placeholder:text-apagado"
                aria-label="Palavra-chave"
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-suave">
            Aperta Enter ou vírgula pra adicionar. <strong className="text-texto/90">Maiúscula e acento não fazem diferença</strong>:
            QUERO, quero e Quéro contam igual. A palavra precisa estar inteira no comentário (&quot;link&quot; não pega
            &quot;linkedin&quot;).
          </p>
          <Erro texto={erros.palavras} />

          <div className="rounded-xl border border-dashed border-borda-forte p-3">
            <label htmlFor={`${ids}-teste`} className="text-xs font-semibold text-suave">
              Testa um comentário
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id={`${ids}-teste`}
                value={teste}
                onChange={(e) => setTeste(e.target.value)}
                placeholder="Ex.: Quéro o link por favor!"
                className={`${classeEntrada} py-2`}
              />
              {teste ? (
                bateu ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-verde">
                    <IconeCheck className="size-4" /> Bateu: {bateu.toUpperCase()}
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-apagado">
                    <IconeX className="size-4" /> Não recebe
                  </span>
                )
              ) : null}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ 3. mensagem */}
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-bold">3. A mensagem da DM</h2>
            <p className="text-sm text-suave">Vai uma vez pra cada comentário, com um botão que abre o teu link.</p>
          </div>
          <Campo rotulo="Mensagem" htmlFor={`${ids}-msg`} extra={<Contador atual={mensagem.length} max={LIMITES.mensagem} />}>
            <textarea
              id={`${ids}-msg`}
              name="mensagemDm"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              rows={4}
              maxLength={LIMITES.mensagem}
              required
              className={`${classeEntrada} resize-y leading-relaxed`}
            />
          </Campo>
          <Erro texto={erros.mensagemDm} />

          <div className="grid gap-5 sm:grid-cols-[1fr_14rem]">
            <div className="space-y-1.5">
              <Campo rotulo="Link" htmlFor={`${ids}-link`} dica="Pra onde o botão leva: tua página, WhatsApp, PDF, loja…">
                <input
                  id={`${ids}-link`}
                  name="linkUrl"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  inputMode="url"
                  placeholder="https://teusite.com.br/oferta"
                  maxLength={LIMITES.link}
                  required
                  className={classeEntrada}
                />
              </Campo>
              <Erro texto={erros.linkUrl} />
            </div>
            <div className="space-y-1.5">
              <Campo rotulo="Texto do botão" htmlFor={`${ids}-titulo`} extra={<Contador atual={titulo.length} max={LIMITES.titulo} />}>
                <input
                  id={`${ids}-titulo`}
                  name="linkTitulo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  maxLength={LIMITES.titulo}
                  required
                  className={classeEntrada}
                />
              </Campo>
              <Erro texto={erros.linkTitulo} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ 4. resposta pública */}
        <section className="space-y-4">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-lg font-bold">4. Responder o comentário em público</span>
              <span className="block text-sm text-suave">Opcional. Ex.: &quot;te mandei no direct!&quot;</span>
            </span>
            <input
              type="checkbox"
              name="responder"
              checked={responder}
              onChange={(e) => setResponder(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative mt-1 h-7 w-12 shrink-0 rounded-full bg-superficie-3 ring-1 ring-borda-forte transition-colors peer-checked:bg-azul peer-focus-visible:outline-2 peer-focus-visible:outline-azul-claro after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" aria-hidden />
          </label>
          {responder ? (
            <Campo
              rotulo="Resposta"
              htmlFor={`${ids}-resp`}
              extra={<Contador atual={resposta.length} max={LIMITES.resposta} />}
              dica="Só sai se a DM saiu. Passou de 200 respostas em 24 h, o robô manda só a DM, pra gastar menos do limite da tua conta."
            >
              <input
                id={`${ids}-resp`}
                name="respostaPublica"
                value={resposta}
                onChange={(e) => setResposta(e.target.value)}
                maxLength={LIMITES.resposta}
                className={classeEntrada}
              />
            </Campo>
          ) : null}
          <Erro texto={erros.respostaPublica} />
        </section>

        {/* ------------------------------------------------ 5. nome e ligar */}
        <section className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <Campo rotulo="Nome da automação" htmlFor={`${ids}-nome`} dica="Só tu vê. Em branco, vira o nome da palavra.">
            <input
              id={`${ids}-nome`}
              name="nome"
              defaultValue={valores.nome}
              maxLength={LIMITES.nome}
              placeholder={palavras[0] ? `Palavra ${palavras[0].toUpperCase()}` : "Ex.: Receita do bolo"}
              className={classeEntrada}
            />
          </Campo>
          <label className="flex h-11 cursor-pointer items-center gap-3 rounded-xl border border-borda-forte bg-superficie-2 px-4 text-sm font-semibold">
            <input type="checkbox" name="ativa" defaultChecked={valores.ativa} className="size-4 accent-[var(--azul)]" />
            Ligada
          </label>
        </section>

        <div className="flex flex-col gap-3 border-t border-borda pt-6 sm:flex-row sm:items-center">
          <button type="submit" disabled={salvando} className={classeBotao("primario", "lg")}>
            <IconeRaio className="size-5" />
            {salvando ? "Salvando…" : valores.id ? "Salvar alterações" : "Criar automação"}
          </button>
          <p className="text-xs text-suave">Dá pra pausar, editar ou apagar quando quiser.</p>
        </div>
      </div>

      {/* ------------------------------------------------ prévia */}
      <aside className="lg:sticky lg:top-8">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.14em] text-apagado">Prévia no celular</p>
        <PreviaCelular
          d={{
            username: conta.username,
            fotoUrl: conta.fotoUrl,
            miniatura,
            autor: "cliente.exemplo",
            comentario: teste || exemploComentario,
            respostaPublica: responder ? resposta : null,
            mensagem,
            botao: titulo,
            linkExibido: `O botão abre ${linkCurto} → ${link || "teu link"}`,
          }}
        />
      </aside>
    </form>
  );
}
