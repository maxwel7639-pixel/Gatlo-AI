import { consultarAutorizacao, criarAutorizacao, criarCliente, ouNaoExiste } from "./asaas";
import { limparCpfCnpj } from "./cpf-cnpj";
import { consultarAssinatura } from "./mercadopago";

/**
 * O MIOLO DE "ASSINAR NO PIX AUTOMÁTICO", sem Next no meio (a ação em
 * lib/acoes.ts só traz o usuário da sessão; lib/asaas-servidor.ts injeta o banco
 * e as regras de verdade; os testes rodam este miolo com o Asaas simulado).
 * Mesmo desenho do cartão (lib/mp-checkout.ts):
 *
 *  - o PREÇO vem de `lerPreco` (regras.preco_mensal_centavos, lido no servidor).
 *    Esta função não recebe preço de ninguém, muito menos do navegador.
 *  - NUNCA DUAS COBRANÇAS VIVAS, nem entre os dois gateways. O id da autorização é
 *    guardado na hora que nasce; antes de abrir outra, pergunta ao Asaas em que pé
 *    está a guardada: ativa = recusa; criada (QR ainda valendo) = devolve a MESMA;
 *    cancelada, recusada ou expirada = pode criar. Cartão do Mercado Pago ainda
 *    vivo (pendente, autorizado ou pausado) também recusa.
 *  - o CPF/CNPJ é pedido ao usuário só para o Asaas criar o cliente: é validado
 *    aqui, vai pro Asaas e não é guardado.
 */

export type AssinaturaPix = {
  status: string;
  gateway: string | null;
  gatewayAssinaturaId: string | null;
  gatewayClienteId: string | null;
};

export type DepsPix = {
  /** Preço do mês em centavos, de `regras` (servidor). */
  lerPreco: () => Promise<number>;
  /** A linha da assinatura do usuário no banco. */
  assinaturaAtual: () => Promise<AssinaturaPix | null>;
  /** Grava cliente, autorização e o preço da época (`guardar_autorizacao_asaas`). */
  guardar: (clienteId: string, autorizacaoId: string, valorCentavos: number) => Promise<void>;
};

/** O que a tela mostra: o "copia e cola" e a imagem do QR Code (base64). */
export type PixPronto = { payload: string; imagem: string };

export async function abrirAutorizacao(
  usuario: { id: string; email: string; nome: string | null },
  cpfCnpjDigitado: string,
  d: DepsPix,
): Promise<PixPronto | { erro: string }> {
  const atual = await d.assinaturaAtual();
  if (atual?.status === "ativa") return { erro: "A tua assinatura já está ativa." };

  if (atual?.gateway === "mercadopago" && atual.gatewayAssinaturaId) {
    // O cartão pode estar cobrando mesmo com o nosso banco ainda em "trial": quem sabe é o MP.
    const pa = await consultarAssinatura(atual.gatewayAssinaturaId);
    if (pa.status !== "cancelled") {
      return {
        erro:
          "Já existe uma assinatura no cartão em andamento. Conclui ou cancela ela no Mercado Pago antes de assinar no Pix.",
      };
    }
  }

  if (atual?.gateway === "asaas" && atual.gatewayAssinaturaId) {
    const a = await ouNaoExiste(consultarAutorizacao(atual.gatewayAssinaturaId));
    if (a?.status === "ACTIVE") {
      return {
        erro:
          "O Pix Automático já está autorizado. Se a assinatura ainda não apareceu aqui, espera uns minutos e recarrega a página.",
      };
    }
    if (a?.status === "CREATED") {
      if (!a.payload || !a.encodedImage) throw new Error("Asaas não devolveu o QR Code da autorização pendente.");
      return { payload: a.payload, imagem: a.encodedImage };
    }
    // cancelada, recusada, expirada ou apagada no Asaas: segue e cria outra
  }

  // O cliente do Asaas é reaproveitado (e o CPF/CNPJ nem é pedido de novo).
  let clienteId = atual?.gatewayClienteId ?? null;
  if (!clienteId) {
    const documento = limparCpfCnpj(cpfCnpjDigitado);
    if (!documento) return { erro: "CPF ou CNPJ inválido. Confere os números e tenta de novo." };
    const nome = usuario.nome?.trim() || usuario.email.split("@")[0];
    clienteId = await criarCliente({ userId: usuario.id, nome, email: usuario.email, cpfCnpj: documento });
  }

  const precoCentavos = await d.lerPreco();
  const nova = await criarAutorizacao({ clienteId, userId: usuario.id, precoCentavos });
  await d.guardar(clienteId, nova.id, precoCentavos);
  return { payload: nova.payload!, imagem: nova.encodedImage! };
}
