"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { PRODUTO } from "@/lib/config";
import { Logo } from "@/components/ui";
import { IconeCadeado, IconeComentario, IconeMenu, IconeRaio, IconeRelogio, IconeX } from "@/components/icones";
import s from "./landing.module.css";

type Item = { href: string; texto: string; descricao?: string; icone?: (p: { className?: string }) => ReactNode };
type Grupo = { titulo?: string; itens: Item[] };
/** com href o item vai direto (sem painel); cartoes = painel de cartões com ícone, senão colunas */
type Menu = { id: string; texto: string; href?: string; cartoes?: boolean; grupos: Grupo[] };

const paraCadastro = (textos: string[]) => textos.map((texto) => ({ href: "/cadastro", texto }));

function menus(testeDias: number): Menu[] {
  return [
    {
      id: "produto",
      texto: "Produto",
      cartoes: true,
      grupos: [
        {
          itens: [
            { href: "#cap-titulo", texto: "Como funciona", descricao: "Do comentário ao clique, sozinho", icone: IconeComentario },
            { href: "#antes-depois", texto: "Antes e depois", descricao: "Teu direct com e sem o Gatlo AI", icone: IconeRaio },
            { href: "#limites", texto: "Limites", descricao: "O que ele faz e o que não promete", icone: IconeCadeado },
            { href: "#preco", texto: "Preço", descricao: `Teste ${testeDias} dias grátis, sem cartão`, icone: IconeRelogio },
          ],
        },
      ],
    },
    {
      id: "para-quem",
      texto: "Para quem",
      // ainda não existe página por perfil nem por uso: todos levam ao cadastro
      grupos: [
        { titulo: "Por perfil", itens: paraCadastro(["Criadores", "Lojas", "Infoprodutores", "Agências"]) },
        { titulo: "Por uso", itens: paraCadastro(["Link de produto", "Material grátis", "Cupom", "Lista de espera"]) },
      ],
    },
    { id: "preco", texto: "Preço", href: "#preco", grupos: [] },
    {
      id: "ajuda",
      texto: "Ajuda",
      grupos: [
        {
          titulo: "Começar",
          itens: [
            { href: "/cadastro", texto: "Criar conta" },
            { href: "/entrar", texto: "Entrar" },
            { href: "/recuperar-senha", texto: "Recuperar senha" },
          ],
        },
        {
          titulo: "Legal",
          itens: [
            { href: "/termos", texto: "Termos de uso" },
            { href: "/privacidade", texto: "Privacidade" },
            { href: "/exclusao-de-dados", texto: "Exclusão de dados" },
          ],
        },
        { titulo: "Contato", itens: [{ href: `mailto:${PRODUTO.emailSuporte}`, texto: PRODUTO.emailSuporte }] },
      ],
    },
  ];
}

type PropsIr = { href: string; className?: string; style?: CSSProperties; onClick?: () => void; children: ReactNode };

/** e-mail vai num <a> comum; o resto (páginas e âncoras) pelo Link do Next */
function Ir({ href, ...p }: PropsIr) {
  return href.startsWith("mailto:") ? <a href={href} {...p} /> : <Link href={href} {...p} />;
}

/**
 * Cabeçalho da landing (modelo: o do Manychat). Fixo por cima do hero e recuado das bordas; no topo
 * é transparente, e a partir de 50px de rolagem (ou com um menu aberto) o fundo assenta em vidro
 * claro e o texto fica escuro; rolando, o nome recolhe e fica só o ícone.
 * No computador, passar o mouse num item abre o painel embaixo da barra; trocar de item troca o
 * conteúdo, que sobe em escadinha. No telefone, os três tracinhos abrem o menu de tela cheia.
 * As outras páginas continuam com o CabecalhoPublico.
 */
export function CabecalhoVidro({ testeDias }: { testeDias: number }) {
  const [rolou, setRolou] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [gaveta, setGaveta] = useState(false);
  const zona = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const lista = menus(testeDias);
  const comPainel = lista.filter((m) => !m.href);
  const atual = comPainel.find((m) => m.id === menu);

  useEffect(() => {
    let quadro = 0;
    const mede = () => {
      quadro = 0;
      setRolou(scrollY >= 50);
    };
    const agenda = () => {
      if (!quadro) quadro = requestAnimationFrame(mede);
    };
    agenda();
    addEventListener("scroll", agenda, { passive: true });
    return () => {
      cancelAnimationFrame(quadro);
      removeEventListener("scroll", agenda);
    };
  }, []);

  // aberto: Esc fecha (e devolve o foco ao item); tocar fora do painel fecha
  useEffect(() => {
    if (!menu && !gaveta) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) document.getElementById(`gatilho-${menu}`)?.focus();
      setMenu(null);
      setGaveta(false);
    };
    const fora = (e: PointerEvent) => {
      if (!zona.current?.contains(e.target as Node)) setMenu(null);
    };
    addEventListener("keydown", tecla);
    addEventListener("pointerdown", fora);
    return () => {
      removeEventListener("keydown", tecla);
      removeEventListener("pointerdown", fora);
    };
  }, [menu, gaveta]);

  // menu de tela cheia: a página não rola por baixo; virou computador, fecha
  useEffect(() => {
    if (!gaveta) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const largo = matchMedia("(min-width: 1024px)");
    const fecha = () => largo.matches && setGaveta(false);
    largo.addEventListener("change", fecha);
    return () => {
      document.body.style.overflow = antes;
      largo.removeEventListener("change", fecha);
    };
  }, [gaveta]);

  const abre = (id: string | null) => {
    clearTimeout(timer.current);
    setMenu(id);
  };
  const fechaTudo = () => {
    setMenu(null);
    setGaveta(false);
  };

  return (
    <header
      className={s.cab}
      data-rolou={rolou ? "" : undefined}
      data-vidro={rolou || atual || gaveta ? "" : undefined}
    >
      {atual && <div className={s.menuFundo} aria-hidden="true" />}

      <div
        ref={zona}
        className={s.cabZona}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setMenu(null), 150);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(null);
        }}
      >
        <div className={s.cabBarra}>
          <Logo tamanho="sm" classeNome={s.cabNome} />
          <nav aria-label="Principal" className={s.cabLinks}>
            {lista.map((m) =>
              m.href ? (
                <Link key={m.id} href={m.href} className={s.cabItem} onPointerEnter={() => abre(null)}>
                  {m.texto}
                </Link>
              ) : (
                <button
                  key={m.id}
                  id={`gatilho-${m.id}`}
                  type="button"
                  className={s.cabItem}
                  aria-expanded={menu === m.id}
                  aria-controls="menu-painel"
                  data-ativo={menu === m.id ? "" : undefined}
                  onPointerEnter={(e) => e.pointerType === "mouse" && abre(m.id)}
                  // teclado (detail 0) abre e fecha; clique de mouse só abre, o hover já abriu
                  onClick={(e) => setMenu(e.detail === 0 && menu === m.id ? null : m.id)}
                >
                  {m.texto}
                </button>
              ),
            )}
          </nav>
          <div className={s.cabAcoes}>
            <Link href="/cadastro" className={s.cabBotao}>
              {/* um span só: dentro do flex do botão, o espaço entre pedaços soltos some */}
              <span>
                Teste <span className="max-sm:hidden">{testeDias} dias </span>grátis
              </span>
            </Link>
            <Link href="/entrar" className={s.cabEntrar}>
              Entrar
            </Link>
            <button
              type="button"
              className={s.cabTracinhos}
              aria-expanded={gaveta}
              aria-controls="menu-celular"
              aria-label={gaveta ? "Fechar menu" : "Abrir menu"}
              onClick={() => setGaveta(!gaveta)}
            >
              {gaveta ? <IconeX className="size-6" /> : <IconeMenu className="size-6" />}
            </button>
          </div>
        </div>

        {atual && (
          <div id="menu-painel" className={s.menuPainel}>
            <div className={s.menuCaixa}>
              {/* a key troca junto com o menu: o conteúdo remonta e sobe em escadinha de novo */}
              <div key={atual.id} className={atual.cartoes ? s.menuCartoes : s.menuColunas}>
                {atual.cartoes
                  ? atual.grupos[0].itens.map((it, i) => (
                      <Ir
                        key={it.texto}
                        href={it.href}
                        className={`${s.menuCartao} ${s.menuSobe}`}
                        style={{ "--i": i } as CSSProperties}
                        onClick={fechaTudo}
                      >
                        {it.icone && (
                          <span className={s.menuIcone}>
                            <it.icone className="size-5" />
                          </span>
                        )}
                        <span className={s.menuTitulo}>{it.texto}</span>
                        <span className={s.menuDescricao}>{it.descricao}</span>
                      </Ir>
                    ))
                  : atual.grupos.map((g, i) => (
                      <div key={g.titulo} className={`${s.menuColuna} ${s.menuSobe}`} style={{ "--i": i } as CSSProperties}>
                        <p className={s.menuRotulo}>{g.titulo}</p>
                        <ul>
                          {g.itens.map((it) => (
                            <li key={it.texto}>
                              <Ir href={it.href} className={s.menuLink} onClick={fechaTudo}>
                                {it.texto}
                              </Ir>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {gaveta && (
        <div id="menu-celular" className={s.gaveta}>
          {/* o Preço solto não entra: já está nos cartões do Produto */}
          <nav aria-label="Menu">
            {comPainel.map((m, i) => (
              <div key={m.id} className={`${s.gavetaGrupo} ${s.menuSobe}`} style={{ "--i": i } as CSSProperties}>
                <p className={s.menuRotulo}>{m.texto}</p>
                {m.grupos.map((g) => (
                  <div key={g.titulo ?? m.id}>
                    {m.grupos.length > 1 && <p className={s.gavetaSub}>{g.titulo}</p>}
                    <ul className={s.gavetaLinks}>
                      {g.itens.map((it) => (
                        <li key={it.texto}>
                          <Ir href={it.href} className={s.gavetaLink} onClick={fechaTudo}>
                            {it.texto}
                          </Ir>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className={`${s.gavetaRodape} ${s.menuSobe}`} style={{ "--i": comPainel.length } as CSSProperties}>
            <Link href="/cadastro" className={`${s.cabBotao} ${s.gavetaBotao}`} onClick={fechaTudo}>
              Teste {testeDias} dias grátis
            </Link>
            <Link href="/entrar" className={s.gavetaEntrar} onClick={fechaTudo}>
              Entrar
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
