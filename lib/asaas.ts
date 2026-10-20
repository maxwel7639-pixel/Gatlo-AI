import "server-only";
import { PRODUTO } from "./config";

/**
 * API do Asaas, do jeito que o cliente assina no PIX AUTOMÁTICO (autorização
 * recorrente), a segunda porta de cobrança ao lado do cartão (lib/mercadopago.ts).
 *
 * Como no cartão: o cliente escolhe O QUE assina; o SERVIDOR decide QUANTO custa.
 * O preço entra como argumento (`precoCentavos`, lido de `regras` por quem chamou);
 * aqui dentro não tem preço escrito.
 *
 * Fontes (docs.asaas.com, lidas em 18/10/2026):
 *  - base e cabeçalhos: /docs/autenticação-1 (`access_token`; `User-Agent` é obrigatório
 *    em contas novas; sandbox https://api-sandbox.asaas.com/v3, produção https://api.asaas.com/v3)
 *  - criar autorização: /reference/criar-uma-autorizacao-pix-automatico
 *    (POST /v3/pix/automatic/authorizations; status CREATED, ACTIVE, CANCELLED, REFUSED, EXPIRED)
 *  - consultar autorização: /reference/recuperar-uma-unica-autorizacao-pix-automatico
 *  - consultar cobrança: /reference/recuperar-uma-unica-cobranca (GET /v3/payments/{id})
 *  - criar e consultar cliente: /reference/criar-novo-cliente e /reference/recuperar-um-unico-cliente
 */

const BASES = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  producao: "https://api.asaas.com/v3",
} as const;

/** Qualquer valor que não seja exatamente "producao" fica no sandbox: errar para o lado sem dinheiro. */
function base(): string {
  return process.env.ASAAS_AMBIENTE === "producao" ? BASES.producao : BASES.sandbox;
}

function chave(): string {
  const k = process.env.ASAAS_API_KEY;
  if (!k) throw new Error("ASAAS_API_KEY não configurada.");
  return k;
}

/** Erro da API com o código HTTP, para quem chama distinguir "não existe" (404) de "fora do ar". */
export class ErroAsaas extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function asaas<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base()}${caminho}`, {
    ...init,
    headers: {
      access_token: chave(),
      "User-Agent": `${PRODUTO.nome}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const motivo = (corpo as { errors?: { description?: string }[] }).errors?.[0]?.description ?? r.status;
    throw new ErroAsaas(`Asaas ${caminho} respondeu ${r.status}: ${motivo}`, r.status);
  }
  return corpo as T;
}

/** Devolve null quando o Asaas diz que não existe (404); qualquer outro erro continua erro. */
export async function ouNaoExiste<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ErroAsaas && e.status === 404) return null;
    throw e;
  }
}

export type AutorizacaoAsaas = {
  id: string;
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
  payload: string | null;
  encodedImage: string | null;
};

/** Os campos da cobrança que o webhook confere. Dono, valor e status vêm daqui, nunca do corpo do aviso. */
export type CobrancaAsaas = {
  id: string;
  customer: string | null;
  value: number | null;
  status: string;
  billingType: string | null;
  subscription: string | null;
  refunds?: unknown[] | null;
};

export type ClienteAsaas = { id: string; externalReference: string | null; deleted?: boolean };

/**
 * A referência do cliente diz QUEM é o dono: "assinatura|<user id>" (o mesmo
 * formato do cartão, lido por `lerReferencia` de lib/mercadopago.ts). É gravada
 * por nós ao criar o cliente e lida de volta da API do Asaas.
 */
export async function criarCliente(o: { userId: string; nome: string; email: string; cpfCnpj: string }): Promise<string> {
  const r = await asaas<{ id?: string }>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: o.nome,
      email: o.email,
      cpfCnpj: o.cpfCnpj,
      externalReference: `assinatura|${o.userId}`,
    }),
  });
  if (!r.id) throw new Error("Asaas não devolveu o id do cliente.");
  return r.id;
}

/**
 * Cria a autorização do Pix Automático e devolve o QR Code do 1º pagamento
 * (que também registra o consentimento do pagador). Modo SUBSCRIPTION: o Asaas
 * gera as cobranças dos meses seguintes sozinho, no `value` fixado aqui (o preço
 * de `regras` do dia da assinatura: o reajuste não pega quem já assinou).
 */
export async function criarAutorizacao(o: { clienteId: string; userId: string; precoCentavos: number }): Promise<AutorizacaoAsaas> {
  const preco = o.precoCentavos / 100;
  const r = await asaas<Partial<AutorizacaoAsaas>>("/pix/automatic/authorizations", {
    method: "POST",
    body: JSON.stringify({
      customerId: o.clienteId,
      // máx. 35 caracteres: o uuid sem os traços tem 32
      contractId: o.userId.replaceAll("-", ""),
      frequency: "MONTHLY",
      // data de hoje em UTC: nunca antes da de Brasília, então nunca no passado
      startDate: new Date().toISOString().slice(0, 10),
      paymentCreationMode: "SUBSCRIPTION",
      value: preco,
      description: PRODUTO.nome,
      immediateQrCode: { expirationSeconds: 3600, originalValue: preco, description: PRODUTO.nome },
    }),
  });
  if (!r.id || !r.payload || !r.encodedImage) throw new Error("Asaas não devolveu o id e o QR Code da autorização.");
  return {
    id: String(r.id),
    status: r.status ?? "CREATED",
    customerId: r.customerId ?? o.clienteId,
    subscriptionId: r.subscriptionId ?? null,
    payload: r.payload,
    encodedImage: r.encodedImage,
  };
}

export async function consultarAutorizacao(id: string): Promise<AutorizacaoAsaas> {
  const r = await asaas<Partial<AutorizacaoAsaas>>(`/pix/automatic/authorizations/${encodeURIComponent(id)}`);
  return {
    id: String(r.id ?? id),
    status: r.status ?? "",
    customerId: r.customerId ?? null,
    subscriptionId: r.subscriptionId ?? null,
    payload: r.payload ?? null,
    encodedImage: r.encodedImage ?? null,
  };
}

export async function consultarCobranca(id: string): Promise<CobrancaAsaas> {
  return await asaas<CobrancaAsaas>(`/payments/${encodeURIComponent(id)}`);
}

export async function consultarCliente(id: string): Promise<ClienteAsaas> {
  return await asaas<ClienteAsaas>(`/customers/${encodeURIComponent(id)}`);
}

/** Cancela a autorização (DELETE /pix/automatic/authorizations/{id}). Não mexe no nosso banco. */
export async function cancelarAutorizacao(id: string): Promise<void> {
  await asaas(`/pix/automatic/authorizations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Remove a assinatura (DELETE /subscriptions/{id}): cancelar a autorização não garante que o Asaas pare de gerar cobrança. */
export async function removerAssinaturaAsaas(id: string): Promise<void> {
  await asaas(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
}
