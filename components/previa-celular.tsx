import { Avatar, Miniatura } from "./ui";

/**
 * A prévia "como no celular": um comentário com a palavra vira a DM com o
 * botão do link. Só desenho (sem estado): a landing usa com textos fixos e o
 * formulário da automação passa o que a pessoa está digitando.
 */
export type DadosPrevia = {
  username: string;
  fotoUrl: string | null;
  miniatura: string | null;
  autor: string;
  comentario: string;
  respostaPublica: string | null;
  mensagem: string;
  botao: string;
  linkExibido: string;
};

export function PreviaCelular({ d, animar = false }: { d: DadosPrevia; animar?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[320px]">
      <div className="relative rounded-[2.6rem] border border-borda-forte bg-[#05070a] p-2.5 shadow-[0_40px_80px_-30px_rgba(30,80,240,0.45)]">
        <div className="overflow-hidden rounded-[2.1rem] bg-[#0b0e13]">
          {/* barra de status */}
          <div className="flex items-center justify-between px-6 pt-3 pb-1 text-[11px] font-semibold text-texto/80">
            <span>9:41</span>
            <span className="h-5 w-20 rounded-full bg-black" aria-hidden />
            <span className="flex items-center gap-1" aria-hidden>
              <span className="h-2 w-3 rounded-sm bg-texto/70" />
              <span className="h-2 w-4 rounded-sm bg-texto/70" />
            </span>
          </div>

          {/* 1. o comentário no post */}
          <div className="px-3.5 pt-2 pb-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-apagado">No post</p>
            <div className="flex gap-2.5 rounded-2xl bg-white/[0.04] p-2.5">
              <Miniatura src={d.miniatura} alt="" className="size-12 shrink-0 rounded-lg" />
              <div className="min-w-0 text-[12.5px] leading-snug">
                <p>
                  <span className="font-semibold">{d.autor}</span>{" "}
                  <span className="break-words text-texto/90">{d.comentario || "…"}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-apagado">agora · Responder</p>
                {d.respostaPublica ? (
                  <div className={`mt-2 flex items-start gap-1.5 ${animar ? "surgir" : ""}`} style={{ animationDelay: "0.2s" }}>
                    <Avatar src={d.fotoUrl} nome={d.username} className="size-4 ring-1" />
                    <p className="text-[12px]">
                      <span className="font-semibold">{d.username}</span>{" "}
                      <span className="break-words text-texto/85">{d.respostaPublica}</span>
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-azul-claro">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-azul/60" />
            vira DM
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-azul/60" />
          </div>

          {/* 2. a DM que chega */}
          <div className="px-3.5 pt-3 pb-5">
            <div className="mb-3 flex items-center gap-2 border-b border-white/5 pb-2.5">
              <Avatar src={d.fotoUrl} nome={d.username} className="size-7 ring-1" />
              <div className="leading-tight">
                <p className="text-[12.5px] font-semibold">{d.username}</p>
                <p className="text-[10.5px] text-apagado">Instagram · Direct</p>
              </div>
            </div>
            <div className={`max-w-[88%] overflow-hidden rounded-2xl rounded-bl-md bg-[#262a33] ${animar ? "surgir" : ""}`} style={{ animationDelay: "0.45s" }}>
              <p className="whitespace-pre-wrap break-words px-3.5 py-2.5 text-[12.5px] leading-snug">
                {d.mensagem || "Tua mensagem aparece aqui."}
              </p>
              <div className="border-t border-white/10 px-3.5 py-2.5 text-center text-[12.5px] font-semibold text-[#8ab4ff]">
                {d.botao || "Título do botão"}
              </div>
            </div>
            <p className="mt-1.5 truncate pl-1 text-[10px] text-apagado">{d.linkExibido}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
