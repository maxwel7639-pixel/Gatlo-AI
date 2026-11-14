import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { basePainel } from "@/lib/painel";
import { comentariosDoPost, postsDaConta } from "@/lib/instagram";
import { dataCurta, legendaCurta } from "@/lib/formato";
import { Aviso, Avatar, Miniatura, classeBotao } from "@/components/ui";
import { CabecalhoPagina, ConectarInstagram } from "@/components/painel/blocos";
import { ComentariosPost } from "@/components/painel/comentarios-post";

export const metadata: Metadata = { title: "Comentários do post" };

export default async function ComentariosDoPost({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { conta, demonstracao } = await basePainel();
  const voltar = { href: "/painel/posts", rotulo: "Posts" };

  if (!conta || conta.status !== "conectada") {
    return (
      <>
        <CabecalhoPagina titulo="Comentários do post" voltar={voltar} />
        <ConectarInstagram demonstracao={demonstracao.instagram} expirada={conta?.status === "expirada"} />
      </>
    );
  }

  // O post tem que ser desta conta (a mesma conferência a ação refaz no servidor).
  const posts = await postsDaConta(conta);
  if (!posts.ok) {
    return (
      <>
        <CabecalhoPagina titulo="Comentários do post" voltar={voltar} />
        <Aviso tipo="erro">{posts.erro}</Aviso>
      </>
    );
  }
  const post = posts.posts.find((p) => p.id === id);
  if (!post) notFound();

  const resultado = await comentariosDoPost(conta, post.id);

  return (
    <>
      <CabecalhoPagina
        titulo="Comentários do post"
        voltar={voltar}
        descricao="Responda, mande DM, oculte ou apague, direto daqui. Tudo vai na hora para o Instagram."
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="h-fit rounded-2xl border border-borda bg-superficie p-4">
          <div className="flex items-center gap-3">
            <Avatar src={conta.fotoUrl} nome={conta.username} className="size-10" />
            <div className="min-w-0">
              <p className="truncate font-semibold">@{conta.username}</p>
              <p className="text-xs text-suave">Conta conectada</p>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl bg-superficie-3">
            <Miniatura src={post.miniatura} alt={legendaCurta(post.legenda, 60)} className="aspect-[4/5] w-full" />
          </div>
          <p className="mt-3 text-xs font-medium text-suave">Post de {dataCurta(post.publicadoEm)}</p>
          <p className="mt-1 line-clamp-3 text-sm">{legendaCurta(post.legenda, 160)}</p>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer"
              className={`${classeBotao("secundario", "sm")} mt-3 w-full`}
            >
              Abrir no Instagram
            </a>
          ) : null}
        </aside>

        {resultado.ok ? (
          <ComentariosPost
            mediaId={post.id}
            contaIgUserId={conta.igUserId}
            username={conta.username}
            comentarios={resultado.comentarios}
          />
        ) : (
          <Aviso tipo="erro">{resultado.erro}</Aviso>
        )}
      </div>
    </>
  );
}
