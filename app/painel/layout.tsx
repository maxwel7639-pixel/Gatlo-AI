import type { Metadata } from "next";
import Link from "next/link";
import { basePainel } from "@/lib/painel";
import { PRODUTO } from "@/lib/config";
import { sair } from "@/lib/auth/acoes";
import { Logo, Selo } from "@/components/ui";
import { NavInferior, NavLateral } from "@/components/painel/nav";
import { IconeSair } from "@/components/icones";
import "@/components/painel/navegacao-apple.css";

export const metadata: Metadata = {
  title: { default: "Painel", template: `%s · ${PRODUTO.nome}` },
  robots: { index: false, follow: false },
};

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const { usuario, situacao, demonstracao } = await basePainel();
  const teste = situacao?.status === "trial";

  return (
    <div className="gatlo-painel-apple flex min-h-screen">
      {/* ------------------------------------------------ lateral (computador) */}
      <div className="gatlo-lateral-espaco hidden lg:block">
      <aside className="gatlo-lateral border-r border-borda px-3 py-5">
        <div className="relative px-2">
          <span className="gatlo-lateral-marca" aria-hidden="true">G</span>
          <div className="gatlo-lateral-texto">
          <Logo href="/painel" />
          </div>
        </div>
        {demonstracao.instagram ? (
          <div className="gatlo-lateral-texto mt-4 px-2">
            <Selo cor="amarelo">Modo demonstração</Selo>
          </div>
        ) : null}
        <div className="mt-6 flex-1">
          <NavLateral />
        </div>

        {situacao ? (
          <Link
            href="/painel/conta"
            className="gatlo-lateral-texto mb-4 block rounded-xl border border-borda bg-superficie-2 px-3.5 py-3 text-sm hover:border-borda-forte"
          >
            {teste && situacao.liberada ? (
              <>
                <p className="font-semibold">Teste grátis</p>
                <p className="text-suave">
                  {situacao.diasRestantes === 1 ? "Falta 1 dia" : `Faltam ${situacao.diasRestantes} dias`}
                </p>
              </>
            ) : situacao.liberada ? (
              <p className="font-semibold text-verde">Assinatura ativa</p>
            ) : (
              <>
                <p className="font-semibold text-amarelo">Automações pausadas</p>
                <p className="text-suave">O teste acabou. Assina pra voltar.</p>
              </>
            )}
          </Link>
        ) : null}

        <div className="flex items-center gap-2 border-t border-borda px-2 pt-4">
          <div className="gatlo-lateral-texto min-w-0 flex-1 order-2">
            <p className="truncate text-sm font-semibold">{usuario.nome ?? "Sem nome"}</p>
            <p className="truncate text-xs text-suave">{usuario.email}</p>
          </div>
          <form action={sair}>
            <button
              type="submit"
              title="Sair"
              className="grid size-9 place-items-center rounded-lg text-suave hover:bg-superficie-2 hover:text-texto"
            >
              <IconeSair className="size-5" />
              <span className="sr-only">Sair</span>
            </button>
          </form>
        </div>
      </aside>
      </div>

      {/* ------------------------------------------------ conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-borda bg-fundo/90 px-4 backdrop-blur-md lg:hidden">
          <Logo href="/painel" tamanho="sm" />
          <div className="flex items-center gap-2">
            {demonstracao.instagram ? <Selo cor="amarelo">Demonstração</Selo> : null}
            <form action={sair}>
              <button
                type="submit"
                className="grid size-9 place-items-center rounded-lg text-suave hover:bg-superficie-2 hover:text-texto"
              >
                <IconeSair className="size-5" />
                <span className="sr-only">Sair</span>
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          {children}
        </main>
      </div>
      <NavInferior />
    </div>
  );
}
