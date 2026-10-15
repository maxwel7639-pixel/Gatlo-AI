import type { Metadata } from "next";
import { basePainel } from "@/lib/painel";
import { repo } from "@/lib/dados";
import { postsDaConta } from "@/lib/instagram";
import { Aviso, BotaoLink } from "@/components/ui";
import { CabecalhoPagina, ConectarInstagram, EstadoVazio } from "@/components/painel/blocos";
import { CartaoPost } from "@/components/painel/cartao-post";
import { IconeGrade } from "@/components/icones";

export const metadata: Metadata = { title: "Posts" };

export default async function Posts() {
  const { usuario, conta, demonstracao } = await basePainel();

  if (!conta || conta.status !== "conectada") {
    return (
      <>
        <CabecalhoPagina titulo="Posts" descricao="Os teus últimos posts, com as métricas." />
        <ConectarInstagram demonstracao={demonstracao.instagram} expirada={conta?.status === "expirada"} />
      </>
    );
  }

  const [resultado, automacoes] = await Promise.all([
    postsDaConta(conta),
    repo().listarAutomacoes(usuario.id),
  ]);
  const porPost = new Map<string, number>();
  for (const a of automacoes) {
    if (a.mediaId) porPost.set(a.mediaId, (porPost.get(a.mediaId) ?? 0) + 1);
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Posts"
        descricao={`Os últimos posts de @${conta.username}. Escolhe um pra criar a automação.`}
        acoes={
          <BotaoLink href="/painel/automacoes/nova?alvo=qualquer" variante="secundario">
            Automação pra qualquer post
          </BotaoLink>
        }
      />

      {!resultado.ok ? (
        <div className="space-y-4">
          <Aviso tipo="erro">{resultado.erro}</Aviso>
          {resultado.reconectar ? <ConectarInstagram demonstracao={demonstracao.instagram} expirada /> : null}
        </div>
      ) : resultado.posts.length === 0 ? (
        <EstadoVazio
          icone={<IconeGrade className="size-7" />}
          titulo="Nenhum post ainda"
          texto="Quando tu publicar no Instagram, os posts aparecem aqui. Dá pra criar uma automação pra qualquer post, inclusive os próximos."
          acao={<BotaoLink href="/painel/automacoes/nova?alvo=qualquer">Automação pra qualquer post</BotaoLink>}
        />
      ) : (
        <>
          <p className="mb-4 text-xs text-apagado">
            Os números vêm do Instagram e podem atrasar até 48 h. Alcance, visualizações, salvamentos e
            compartilhamentos aparecem nos 12 posts mais novos.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {resultado.posts.map((p) => (
              <CartaoPost key={p.id} post={p} automacoes={porPost.get(p.id) ?? 0} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
