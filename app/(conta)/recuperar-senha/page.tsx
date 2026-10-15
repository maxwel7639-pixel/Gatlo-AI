import type { Metadata } from "next";
import Link from "next/link";
import { FormRecuperar } from "@/components/formularios-auth";

export const metadata: Metadata = { title: "Esqueci a senha" };

export default function RecuperarSenha() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Esqueci a senha</h1>
      <p className="mt-1.5 mb-6 text-sm text-suave">
        Diz o e-mail da conta que a gente manda um link pra criar uma senha nova.
      </p>
      <FormRecuperar />
      <p className="mt-6 text-center text-sm text-suave">
        Lembrou?{" "}
        <Link href="/entrar" className="font-semibold text-azul-claro hover:underline">
          Entrar
        </Link>
      </p>
    </>
  );
}
