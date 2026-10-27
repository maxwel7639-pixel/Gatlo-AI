import type { Metadata } from "next";
import { FormNovaSenha } from "@/components/formularios-auth";

export const metadata: Metadata = { title: "Senha nova", robots: { index: false, follow: false } };

/**
 * Chega-se aqui pelo link do e-mail (Supabase: /auth/confirmar já criou a
 * sessão) ou, no modo demonstração, pelo link que aparece na tela (?codigo=).
 */
export default async function NovaSenha({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>;
}) {
  const { codigo } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Cria uma senha nova</h1>
      <p className="mt-1.5 mb-6 text-sm text-suave">Depois de salvar, tu já entra no painel.</p>
      <FormNovaSenha codigo={codigo ?? ""} />
    </>
  );
}
