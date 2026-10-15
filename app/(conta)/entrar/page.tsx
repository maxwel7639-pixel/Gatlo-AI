import type { Metadata } from "next";
import Link from "next/link";
import { FormEntrar } from "@/components/formularios-auth";
import { Aviso } from "@/components/ui";

export const metadata: Metadata = { title: "Entrar" };

const ERROS: Record<string, string> = {
  link_invalido: "Esse link não vale mais. Entra com e-mail e senha.",
  link_expirado: "O link venceu ou já foi usado. Entra com e-mail e senha, ou pede outro em \"esqueci a senha\".",
};

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string; erro?: string }>;
}) {
  const { proximo, erro } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Entrar</h1>
      <p className="mt-1.5 mb-6 text-sm text-suave">Bom te ver de novo.</p>
      {erro && ERROS[erro] ? (
        <div className="mb-5">
          <Aviso tipo="atencao">{ERROS[erro]}</Aviso>
        </div>
      ) : null}
      <FormEntrar proximo={proximo ?? "/painel"} />
      <p className="mt-6 text-center text-sm text-suave">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-semibold text-azul-claro hover:underline">
          Teste 7 dias grátis
        </Link>
      </p>
    </>
  );
}
