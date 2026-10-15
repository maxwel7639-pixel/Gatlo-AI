import { BotaoLink, Logo } from "@/components/ui";

export default function NaoEncontrado() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <Logo />
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="max-w-sm text-suave">O endereço pode estar errado, ou o que estava aqui foi apagado.</p>
      <BotaoLink href="/painel">Ir pro painel</BotaoLink>
    </main>
  );
}
