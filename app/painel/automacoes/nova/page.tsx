import type { Metadata } from "next";
import { basePainel } from "@/lib/painel";
import { linkCurtoExibido, postsParaEscolha } from "@/lib/form-dados";
import { CabecalhoPagina, ConectarInstagram } from "@/components/painel/blocos";
import { FormAutomacao } from "@/components/painel/form-automacao";

export const metadata: Metadata = { title: "Nova automação" };

export default async function NovaAutomacao({
  searchParams,
}: {
  searchParams: Promise<{ post?: string; alvo?: string }>;
}) {
  const q = await searchParams;
  const { conta, demonstracao } = await basePainel();

  if (!conta || conta.status !== "conectada") {
    return (
      <>
        <CabecalhoPagina titulo="Nova automação" voltar={{ href: "/painel/automacoes", rotulo: "Automações" }} />
        <ConectarInstagram demonstracao={demonstracao.instagram} expirada={conta?.status === "expirada"} />
      </>
    );
  }

  const { posts, erro } = await postsParaEscolha(conta);
  const qualquer = q.alvo === "qualquer";
  const mediaId = !qualquer && q.post && posts.some((p) => p.id === q.post) ? q.post : (posts[0]?.id ?? null);

  return (
    <>
      <CabecalhoPagina
        titulo="Nova automação"
        descricao="Quem comentar a palavra recebe a tua mensagem com o link no direct."
        voltar={{ href: "/painel/automacoes", rotulo: "Automações" }}
      />
      <FormAutomacao
        posts={posts}
        postsErro={erro}
        conta={{ username: conta.username, fotoUrl: conta.fotoUrl }}
        linkCurto={linkCurtoExibido()}
        valores={{
          nome: "",
          qualquerPost: qualquer,
          mediaId,
          palavras: [],
          mensagemDm: "Oi! Aqui está o link que tu pediu 👇",
          linkUrl: "",
          linkTitulo: "Acessar o link",
          respostaPublica: null,
          ativa: true,
        }}
      />
    </>
  );
}
