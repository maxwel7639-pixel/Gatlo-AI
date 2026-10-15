import Link from "next/link";
import { usaBancoLocal } from "@/lib/env";
import { Logo } from "@/components/ui";

/** Moldura das telas de entrar, cadastrar e trocar a senha. */
export default function LayoutConta({ children }: { children: React.ReactNode }) {
  return (
    <div className="brilho-topo flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
        <div className="w-full max-w-md">
          {usaBancoLocal ? (
            <p className="mb-4 rounded-xl border border-amarelo/30 bg-amarelo/10 px-4 py-2.5 text-center text-xs font-semibold text-amarelo">
              Modo demonstração: o cadastro fica só neste computador.
            </p>
          ) : null}
          <div className="rounded-3xl border border-borda bg-superficie p-6 shadow-2xl shadow-black/40 sm:p-8">
            {children}
          </div>
        </div>
      </main>
      <footer className="flex justify-center gap-5 pb-8 text-xs text-suave">
        <Link href="/termos" className="hover:text-texto">Termos</Link>
        <Link href="/privacidade" className="hover:text-texto">Privacidade</Link>
        <Link href="/exclusao-de-dados" className="hover:text-texto">Exclusão de dados</Link>
      </footer>
    </div>
  );
}
