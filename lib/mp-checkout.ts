import { consultarAssinatura, criarAssinatura } from "./mercadopago";

/**
 * O MIOLO DE "ASSINAR NO CARTÃO", sem Next no meio (a ação em lib/acoes.ts só
 * traz o usuário da sessão e injeta o banco e as regras de verdade; os testes
 * rodam este miolo com o Mercado Pago simulado).
 *
 * Duas decisões moram aqui:
 *  - o PREÇO vem de `lerPreco` (regras.preco_mensal_centavos, lido no servidor).
 *    Esta função não recebe preço de ninguém, muito menos do navegador.
 *  - NUNCA DOIS PREAPPROVALS VIVOS. O id do preapproval é guardado na hora que
 *    nasce; antes de abrir outro checkout, pergunta ao MP em que pé está o
 *    guardado: autorizado ou pausado = recusa (o MP já cobra ou vai cobrar);
 *    pendente = devolve o MESMO checkout, sem criar outro (o link guarda o
 *    preço do dia em que nasceu, como toda assinatura); cancelado = pode criar.
 */

export type AssinaturaGuardada = {
  status: string;
  gateway: string | null;
  gatewayAssinaturaId: string | null;
};

export type DepsCheckout = {
  /** Preço do mês em centavos, de `regras` (servidor). */
  lerPreco: () => Promise<number>;
  /** A linha da assinatura do usuário no banco. */
  assinaturaAtual: () => Promise<AssinaturaGuardada | null>;
  /** Grava o id do preapproval e o preço da época (`guardar_preapproval`). */
  guardar: (preapprovalId: string, valorCentavos: number) => Promise<void>;
};

export async function abrirCheckout(
  usuario: { id: string; email: string },
  d: DepsCheckout,
): Promise<{ url: string } | { erro: string }> {
  const atual = await d.assinaturaAtual();
  // Já ativa: um 2º checkout viraria cobrança dobrada.
  if (atual?.status === "ativa") return { erro: "A tua assinatura já está ativa." };

  let anteriorId: string | null = null;
  if (atual?.gateway === "mercadopago" && atual.gatewayAssinaturaId) {
    // Ativa ou não, o MP pode estar cobrando (cartão recusado que ele ainda tenta
    // de novo, 1º aviso que atrasou): quem sabe é ele, não o nosso banco.
    const pa = await consultarAssinatura(atual.gatewayAssinaturaId);
    if (pa.status === "pending") {
      if (!pa.init_point) throw new Error("Mercado Pago não devolveu o endereço do checkout pendente.");
      return { url: pa.init_point };
    }
    if (pa.status !== "cancelled") {
      return {
        erro:
          "Já existe uma assinatura tua no Mercado Pago. Se o pagamento ainda não apareceu aqui, espera uns minutos e recarrega a página.",
      };
    }
    anteriorId = atual.gatewayAssinaturaId;
  }

  const precoCentavos = await d.lerPreco();
  const { id, url } = await criarAssinatura({ userId: usuario.id, email: usuario.email, precoCentavos, anteriorId });
  await d.guardar(id, precoCentavos);
  return { url };
}
