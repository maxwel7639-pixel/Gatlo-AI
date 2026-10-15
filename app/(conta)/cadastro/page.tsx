import type { Metadata } from "next";
import Link from "next/link";
import { FormCadastro } from "@/components/formularios-auth";

export const metadata: Metadata = { title: "Criar conta" };

export default function Cadastro() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Teste 7 dias grátis</h1>
      <p className="mt-1.5 mb-6 text-sm leading-relaxed text-suave">
        Sem cartão. No fim do teste a automação pausa até tu assinar; nada é cobrado sozinho.
      </p>
      <FormCadastro />
      <p className="mt-6 text-center text-sm text-suave">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-semibold text-azul-claro hover:underline">
          Entrar
        </Link>
      </p>
    </>
  );
}
