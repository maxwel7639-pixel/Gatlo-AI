"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconeCasa, IconeGrade, IconeInstagram, IconeRaio } from "../icones";

const ITENS = [
  { href: "/painel", rotulo: "Visão geral", icone: IconeCasa, exato: true },
  { href: "/painel/posts", rotulo: "Posts", icone: IconeGrade },
  { href: "/painel/automacoes", rotulo: "Automações", icone: IconeRaio },
  { href: "/painel/conta", rotulo: "Conta", icone: IconeInstagram },
];

function ativo(pathname: string, href: string, exato?: boolean) {
  return exato ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Menu lateral (computador). */
export function NavLateral() {
  const pathname = usePathname();
  return (
    <nav className="space-y-1" aria-label="Painel">
      {ITENS.map(({ href, rotulo, icone: Icone, exato }) => {
        const sim = ativo(pathname, href, exato);
        return (
          <Link
            key={href}
            href={href}
            aria-current={sim ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors ${
              sim ? "bg-azul/15 text-azul-claro" : "text-suave hover:bg-superficie-2 hover:text-texto"
            }`}
          >
            <Icone className="size-5" />
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}

/** Barra de baixo (celular). */
export function NavInferior() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Painel"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-borda bg-fundo/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {ITENS.map(({ href, rotulo, icone: Icone, exato }) => {
          const sim = ativo(pathname, href, exato);
          return (
            <Link
              key={href}
              href={href}
              aria-current={sim ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${
                sim ? "text-azul-claro" : "text-suave"
              }`}
            >
              <Icone className="size-[22px]" />
              {rotulo}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
