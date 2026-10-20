import "server-only";
import { PRODUTO, SITE_URL } from "./config";

/**
 * API do Mercado Pago, do jeito que o cliente assina no CARTÃO: a assinatura
 * recorrente (`preapproval`), não uma compra avulsa.
 *
 * O cliente escolhe o QUE assinar; o SERVIDOR decide QUANTO custa. Por isso o
 * preço entra como argumento (`precoCentavos`), lido por quem chamou a partir
 * da tabela `regras` — aqui dentro não tem preço escrito, e nem deve ter: o
 * preço do produto é dinheiro, e dinheiro mora no banco.
 */

const API = "https://api.mercadopago.com";

function token(): string {
  const t = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!t) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado.");
  return t;
}

async function mp<T>(caminho: string, init?: RequestInit & { idempotencia?: string }): Promise<T> {
  const { idempotencia, ...resto } = init ?? {};

  const r = await fetch(`${API}${caminho}`, {
    ...resto,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(idempotencia ? { "X-Idempotency-Key": idempotencia } : {}),
      ...(resto.headers ?? {}),
    },
    cache: "no-store",
  });

  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const motivo = (corpo as { message?: string }).message ?? r.status;
    throw new Error(`Mercado Pago ${caminho} respondeu ${r.status}: ${motivo}`);
  }
  return corpo as T;
}

/**
 * A referência diz QUEM é o dono do pagamento: "assinatura|<user id>". Ela vem
 * SEMPRE da API do MP, nunca do corpo do webhook (lá dentro manda qualquer um
 * na internet) — um aviso forjado não escolhe para quem creditar.
 */
export type ReferenciaAssinatura = { tipo: "assinatura"; userId: string } | null;

export function lerReferencia(referencia: string | null | undefined): ReferenciaAssinatura {
  if (!referencia) return null;
  const separado = referencia.split("|");
  const tipo = separado[0];
  const userId = separado.slice(1).join("|");
  if (tipo !== "assinatura" || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return { tipo: "assinatura", userId };
}

export type PagamentoMP = {
  id: string | number;
  status: string;
  transaction_amount: number | null;
  external_reference: string | null;
  preapproval_id: string | null;
  currency_id?: string | null;
  transaction_amount_refunded?: number | null;
};

/** A assinatura (preapproval) como o MP devolve: pending, authorized, paused ou cancelled. */
export type AssinaturaMP = { id: string; status: string; init_point: string | null; external_reference?: string | null };

/**
 * Cria a assinatura recorrente e devolve o id dela e o endereço do checkout do MP.
 * `precoCentavos` é quem chama que manda (regras.preco_mensal_centavos).
 * `anteriorId`: o preapproval que este substitui (cancelado no MP). Entra na chave
 * de idempotência, senão o MP devolveria o preapproval velho dentro da janela dele.
 */
export async function criarAssinatura(o: {
  userId: string;
  email: string;
  precoCentavos: number;
  anteriorId?: string | null;
}): Promise<{ id: string; url: string }> {
  // POST /preapproval (o mesmo caminho do Fisga em produção)
  const r = await mp<{ id: string | null; init_point: string | null; sandbox_init_point: string | null }>("/preapproval", {
    method: "POST",
    // mesma requisição, mesmo resultado: o duplo clique não cria duas assinaturas
    idempotencia: `assinatura-${o.userId}-${o.anteriorId ?? "primeira"}`,
    body: JSON.stringify({
      reason: `${PRODUTO.nome} — assinatura mensal`,
      external_reference: `assinatura|${o.userId}`,
      payer_email: o.email,
      back_url: `${SITE_URL}/painel/conta?assinatura=iniciada`,
      // é o endereço desta rota que recebe os avisos (app/api/mercadopago-webhook)
      notification_url: `${SITE_URL}/api/mercadopago-webhook`,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: o.precoCentavos / 100,
        currency_id: "BRL",
      },
    }),
  });

  const url = r.init_point ?? r.sandbox_init_point;
  if (!url || !r.id) throw new Error("Mercado Pago não devolveu o id e o endereço do checkout.");
  return { id: String(r.id), url };
}

export async function consultarAssinatura(id: string): Promise<AssinaturaMP> {
  return await mp<AssinaturaMP>(`/preapproval/${encodeURIComponent(id)}`);
}

export async function consultarPagamento(id: string): Promise<PagamentoMP> {
  return await mp<PagamentoMP>(`/v1/payments/${encodeURIComponent(id)}`);
}

/**
 * Cancela o preapproval no MP (PUT /preapproval/{id} com status "cancelled").
 * NÃO mexe no nosso banco: o status só muda quando o aviso do MP chega e a API
 * confirma (lib/mp-webhook.ts).
 */
export async function cancelarAssinaturaMP(id: string): Promise<AssinaturaMP> {
  return await mp<AssinaturaMP>(`/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled" }),
  });
}
