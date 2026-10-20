import { CABECALHO_TOKEN, receberAviso } from "@/lib/asaas-webhook";
import { autorizacaoGuardadaDoServidor } from "@/lib/asaas-servidor";
import { estornarNoBanco, marcarCanceladaNoBanco, registrarNoBanco } from "@/lib/registrar-pagamento";

/**
 * Webhook do Asaas (Pix Automático).
 *
 * REGRA CENTRAL: o corpo que chega aqui NÃO é fonte de verdade. Dele sai só o
 * id da cobrança; status, valor, dono e autorização vêm da API do Asaas
 * consultada com a nossa chave (lib/asaas-webhook.ts, onde está a lógica e onde
 * ela é testada). Liberar é `registrar_pagamento` no banco, que confere o preço,
 * amarra o pagamento à autorização guardada e é idempotente pelo id da cobrança.
 *
 * Respostas: 401 token errado, ausente ou sem `ASAAS_WEBHOOK_TOKEN` configurado
 * (só "não autorizado", o motivo vai pro log); 500 falhou ao consultar o Asaas ou
 * ao gravar (ele reenvia); 200 liberado ou ignorado (valor divergente, autorização
 * que não é a guardada e cobrança de conta excluída ignoram com ALERTA em nível
 * de erro no log, porque o Asaas não reenvia).
 */
export async function POST(request: Request) {
  const corpo = await request.json().catch(() => null) as { event?: unknown; payment?: { id?: unknown }; authorization?: { id?: unknown } } | null;

  const r = await receberAviso(
    {
      evento: typeof corpo?.event === "string" ? corpo.event : null,
      pagamentoId: typeof corpo?.payment?.id === "string" ? corpo.payment.id : null,
      autorizacaoId: typeof corpo?.authorization?.id === "string" ? corpo.authorization.id : null,
      token: request.headers.get(CABECALHO_TOKEN),
    },
    { registrar: registrarNoBanco, autorizacaoGuardada: autorizacaoGuardadaDoServidor, estornar: estornarNoBanco, marcar: marcarCanceladaNoBanco },
  );
  if (r.status === 500) console.error("[asaas-webhook]", r.status, r.corpo.erro);
  return Response.json(r.corpo, { status: r.status });
}
