import Link from "next/link";
import { PRODUTO } from "@/lib/config";
import { BotaoLink, Logo } from "./ui";

export function CabecalhoPublico() {
  return (
    <header className="sticky top-0 z-30 border-b border-borda/60 bg-fundo/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link href="/entrar" className="rounded-lg px-3 py-2 text-sm font-semibold text-suave hover:text-texto">
            Entrar
          </Link>
          <BotaoLink href="/cadastro" tamanho="sm">
            Teste 7 dias grátis
          </BotaoLink>
        </nav>
      </div>
    </header>
  );
}

export function Rodape() {
  return (
    <footer className="mt-auto border-t border-borda/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-2">
          <Logo tamanho="sm" />
          <p className="text-sm text-suave">
            Um produto da {PRODUTO.empresa} · {PRODUTO.cidade}
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-suave">
          <Link href="/termos" className="hover:text-texto">Termos de uso</Link>
          <Link href="/privacidade" className="hover:text-texto">Privacidade</Link>
          <Link href="/exclusao-de-dados" className="hover:text-texto">Exclusão de dados</Link>
          <a href={`mailto:${PRODUTO.emailSuporte}`} className="hover:text-texto">{PRODUTO.emailSuporte}</a>
        </nav>
      </div>
    </footer>
  );
}

/** Moldura das páginas de texto (termos, privacidade, exclusão). */
export function PaginaTexto({
  titulo,
  atualizado,
  children,
}: {
  titulo: string;
  atualizado: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <CabecalhoPublico />
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{titulo}</h1>
        <p className="mt-2 text-sm text-suave">Atualizado em {atualizado}</p>
        <div className="texto-legal mt-10 space-y-5 text-[15.5px] leading-relaxed text-texto/90 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-texto [&_a]:text-azul-claro [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-2 [&_strong]:text-texto">
          {children}
        </div>
      </main>
      <Rodape />
    </>
  );
}
