import "server-only";
import { SITE_URL } from "./config";
import { dataCurta, legendaCurta } from "./formato";
import { postsDaConta } from "./instagram";
import type { ContaInstagram } from "./dados/tipos";
import type { PostEscolha } from "@/components/painel/form-automacao";

/** Os posts no formato leve que o formulário de automação usa. */
export async function postsParaEscolha(conta: ContaInstagram): Promise<{ posts: PostEscolha[]; erro?: string }> {
  const r = await postsDaConta(conta);
  if (!r.ok) return { posts: [], erro: r.erro };
  return {
    posts: r.posts.map((p) => ({
      id: p.id,
      miniatura: p.miniatura,
      legenda: legendaCurta(p.legenda, 80),
      data: dataCurta(p.publicadoEm),
    })),
  };
}

/** Como o link curto aparece (sem o https://). */
export function linkCurtoExibido(codigo?: string): string {
  return `${SITE_URL.replace(/^https?:\/\//, "")}/l/${codigo ?? "…"}`;
}
