import Link from "next/link";
import { PRODUTO } from "@/lib/config";
import { numero } from "@/lib/formato";
import { Cartao, classeBotao } from "../ui";
import { IconeCadeado, IconeInstagram } from "../icones";

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
  voltar,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
  voltar?: { href: string; rotulo: string };
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {voltar ? (
          <Link href={voltar.href} className="mb-2 inline-block text-sm font-semibold text-suave hover:text-texto">
            ← {voltar.rotulo}
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{titulo}</h1>
        {descricao ? <p className="mt-1.5 text-[15px] text-suave">{descricao}</p> : null}
      </div>
      {acoes ? <div className="flex shrink-0 flex-wrap gap-2">{acoes}</div> : null}
    </div>
  );
}

export function Numero({
  rotulo,
  valor,
  icone,
  detalhe,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  icone: React.ReactNode;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <Cartao className={`p-4 sm:p-5 ${destaque ? "border-azul/40 bg-gradient-to-br from-azul/15 to-superficie" : ""}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-suave">
        <span className={destaque ? "text-azul-claro" : "text-apagado"}>{icone}</span>
        {rotulo}
      </div>
      <p className="numeros mt-2 text-3xl font-bold tracking-tight">{numero(valor)}</p>
      {detalhe ? <p className="mt-1 text-xs text-suave">{detalhe}</p> : null}
    </Cartao>
  );
}

export function EstadoVazio({
  icone,
  titulo,
  texto,
  acao,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  acao?: React.ReactNode;
}) {
  return (
    <Cartao className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-azul/15 text-azul-claro">{icone}</div>
      <h2 className="mt-4 text-lg font-bold">{titulo}</h2>
      <p className="mt-1.5 max-w-md text-[15px] leading-relaxed text-suave">{texto}</p>
      {acao ? <div className="mt-6">{acao}</div> : null}
    </Cartao>
  );
}

/** O cartão grande de "conecta o teu Instagram". */
export function ConectarInstagram({ demonstracao, expirada = false }: { demonstracao: boolean; expirada?: boolean }) {
  return (
    <Cartao className="overflow-hidden">
      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white">
            <IconeInstagram className="size-6" />
          </div>
          <h2 className="text-xl font-bold">
            {expirada ? "Conecta o Instagram de novo" : "Conecta o teu Instagram"}
          </h2>
          <p className="mt-2 max-w-xl leading-relaxed text-suave">
            {expirada
              ? "A autorização venceu ou foi removida no Instagram. Enquanto isso, as automações não mandam nada."
              : `É pelo login oficial do Instagram: a gente nunca vê a tua senha. Precisa ser conta profissional (comercial ou criador).`}
          </p>
          <p className="mt-3 flex items-center gap-2 text-xs text-apagado">
            <IconeCadeado className="size-4" /> O acesso fica cifrado no servidor do {PRODUTO.nome} e tu desconecta
            quando quiser.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          {/* <a> e não <Link>: o Link pré-carrega rotas e isto aqui inicia o login */}
          <a href="/api/instagram/conectar" className={classeBotao("primario", "lg")}>
            <IconeInstagram className="size-5" />
            {demonstracao ? "Conectar perfil de demonstração" : "Conectar Instagram"}
          </a>
          {demonstracao ? (
            <p className="max-w-xs text-xs text-suave md:text-right">
              Modo demonstração: conecta um perfil inventado (Café da Serra), sem falar com a Meta.
            </p>
          ) : null}
        </div>
      </div>
    </Cartao>
  );
}
