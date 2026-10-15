import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { basePainel } from "@/lib/painel";
import { repo } from "@/lib/dados";
import { linkCurtoExibido, postsParaEscolha } from "@/lib/form-dados";
import { CabecalhoPagina, ConectarInstagram } from "@/components/painel/blocos";
import { FormAutomacao } from "@/components/painel/form-automacao";

export const metadata: Metadata = { title: "Editar automação" };

export default async function EditarAutomacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { usuario, conta, demonstracao } = await basePainel();
  const a = await repo().automacao(usuario.id, id);
  if (!a) notFound();

  const voltar = { href: `/painel/automacoes/${a.id}`, rotulo: a.nome };
  if (!conta || conta.status !== "conectada") {
    return (
      <>
        <CabecalhoPagina titulo="Editar automação" voltar={voltar} />
        <ConectarInstagram demonstracao={demonstracao.instagram} expirada={conta?.status === "expirada"} />
      </>
    );
  }

  const { posts: ultimos, erro } = await postsParaEscolha(conta);
  // o post da automação pode ter saído dos últimos: entra como "post atual"
  const posts =
    a.mediaId && !ultimos.some((p) => p.id === a.mediaId)
      ? [{ id: a.mediaId, miniatura: a.mediaMiniatura, legenda: a.mediaLegenda ?? "Post atual", data: "atual" }, ...ultimos]
      : ultimos;

  return (
    <>
      <CabecalhoPagina titulo="Editar automação" voltar={voltar} />
      <FormAutomacao
        posts={posts}
        postsErro={erro}
        conta={{ username: conta.username, fotoUrl: conta.fotoUrl }}
        linkCurto={linkCurtoExibido(a.codigo)}
        valores={{ ...a, miniaturaGuardada: a.mediaMiniatura }}
      />
    </>
  );
}
