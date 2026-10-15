import Link from "next/link";
import { PRODUTO } from "@/lib/config";

/** A marca: o balão com o raio + o nome que vem de lib/config.ts. */
export function Logo({ tamanho = "md", href = "/" }: { tamanho?: "sm" | "md"; href?: string | null }) {
  const icone = tamanho === "sm" ? "size-7" : "size-8";
  const conteudo = (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className={icone} aria-hidden>
        <rect width="64" height="64" rx="16" fill="#1E50F0" />
        <path d="M17 20a6 6 0 0 1 6-6h18a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H29l-8 7v-7.4A6 6 0 0 1 17 34z" fill="#fff" />
        <path d="M34 18.5 26 30h6l-2 9.5L38 28h-6z" fill="#1E50F0" />
      </svg>
      <span className={`font-bold tracking-tight ${tamanho === "sm" ? "text-lg" : "text-xl"}`}>
        {PRODUTO.nome}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} className="rounded-lg">
      {conteudo}
    </Link>
  ) : (
    conteudo
  );
}

type Variante = "primario" | "secundario" | "fantasma" | "perigo";

const ESTILO: Record<Variante, string> = {
  primario:
    "bg-azul text-white hover:bg-azul-hover shadow-[0_8px_24px_-12px_rgba(30,80,240,0.9)] disabled:opacity-60",
  secundario:
    "bg-superficie-2 text-texto border border-borda-forte hover:bg-superficie-3 disabled:opacity-60",
  fantasma: "text-suave hover:text-texto hover:bg-superficie-2",
  perigo: "bg-vermelho/10 text-vermelho border border-vermelho/30 hover:bg-vermelho/20",
};

const TAMANHO = {
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-5 text-[15px] gap-2 rounded-xl",
  lg: "h-13 px-7 text-base gap-2 rounded-xl",
};

export function classeBotao(variante: Variante = "primario", tamanho: keyof typeof TAMANHO = "md") {
  return `inline-flex items-center justify-center font-semibold transition-colors whitespace-nowrap ${TAMANHO[tamanho]} ${ESTILO[variante]}`;
}

export function BotaoLink({
  href,
  children,
  variante = "primario",
  tamanho = "md",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variante?: Variante;
  tamanho?: keyof typeof TAMANHO;
  className?: string;
}) {
  return (
    <Link href={href} className={`${classeBotao(variante, tamanho)} ${className}`}>
      {children}
    </Link>
  );
}

export function Cartao({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-borda bg-superficie ${className}`}>{children}</div>
  );
}

type Cor = "azul" | "verde" | "amarelo" | "vermelho" | "cinza";
const COR_SELO: Record<Cor, string> = {
  azul: "bg-azul/15 text-azul-claro ring-azul/30",
  verde: "bg-verde/10 text-verde ring-verde/25",
  amarelo: "bg-amarelo/10 text-amarelo ring-amarelo/25",
  vermelho: "bg-vermelho/10 text-vermelho ring-vermelho/25",
  cinza: "bg-superficie-3 text-suave ring-borda-forte",
};

export function Selo({ children, cor = "cinza" }: { children: React.ReactNode; cor?: Cor }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${COR_SELO[cor]}`}
    >
      {children}
    </span>
  );
}

export function Aviso({
  tipo = "info",
  children,
}: {
  tipo?: "info" | "erro" | "ok" | "atencao";
  children: React.ReactNode;
}) {
  const estilo = {
    info: "border-azul/30 bg-azul/10 text-azul-claro",
    erro: "border-vermelho/30 bg-vermelho/10 text-vermelho",
    ok: "border-verde/30 bg-verde/10 text-verde",
    atencao: "border-amarelo/30 bg-amarelo/10 text-amarelo",
  }[tipo];
  return (
    <div role={tipo === "erro" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${estilo}`}>
      {children}
    </div>
  );
}

/** Rótulo + campo + dica, no mesmo padrão em todo formulário. */
export function Campo({
  rotulo,
  dica,
  children,
  htmlFor,
  extra,
}: {
  rotulo: string;
  dica?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-texto">
          {rotulo}
        </label>
        {extra}
      </div>
      {children}
      {dica ? <p className="text-xs leading-relaxed text-suave">{dica}</p> : null}
    </div>
  );
}

export const classeEntrada =
  "w-full rounded-xl border border-borda-forte bg-superficie-2 px-3.5 py-2.5 text-[15px] text-texto placeholder:text-apagado outline-none transition-colors focus:border-azul-claro focus:bg-superficie-3";

/** Miniatura de post (img comum: as URLs vêm prontas da CDN do Instagram). */
export function Miniatura({
  src,
  alt,
  className = "",
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div className={`grid place-items-center bg-superficie-3 text-apagado ${className}`} aria-label={alt}>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- sem otimizador de imagem de propósito (next.config.ts)
  return <img src={src} alt={alt} loading="lazy" className={`object-cover ${className}`} />;
}

/** Foto do perfil do Instagram (ou a inicial, se não houver). */
export function Avatar({ src, nome, className = "size-10" }: { src: string | null; nome: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- idem Miniatura
    return <img src={src} alt="" className={`rounded-full object-cover ring-2 ring-borda-forte ${className}`} />;
  }
  return (
    <span
      className={`grid place-items-center rounded-full bg-gradient-to-br from-azul to-azul-claro font-bold text-white ${className}`}
      aria-hidden
    >
      {nome.slice(0, 1).toUpperCase()}
    </span>
  );
}
