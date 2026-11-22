/**
 * DIAGNÓSTICO TEMPORÁRIO (Passo 0 da spec da Onda 1, docs/specs/2026-11-19-onda-1.md).
 * Registra no log o FORMATO dos eventos de mensagem que a Meta manda, para confirmar:
 * os nomes dos campos, e se o id de quem manda a mensagem é o mesmo de quem comentou.
 * Só ids, tipos e tamanhos: o texto da mensagem é dado de terceiro e nunca vai para o log.
 * Não mexe no processamento dos comentários.
 * shortcut: apagar este arquivo e a chamada em manipulador.ts quando o Passo 0 fechar.
 */

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const id = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : null;

export function resumirEventosMensagem(corpo: unknown): Record<string, unknown>[] {
  const saida: Record<string, unknown>[] = [];
  const raiz = objeto(corpo);
  const entradas = raiz?.entry;
  if (!Array.isArray(entradas)) return saida;

  for (const bruta of entradas) {
    const entrada = objeto(bruta);
    if (!entrada) continue;
    const conta = id(entrada.id);

    if (Array.isArray(entrada.messaging)) {
      for (const b of entrada.messaging) {
        const ev = objeto(b);
        if (!ev) continue;
        const msg = objeto(ev.message);
        const postback = objeto(ev.postback);
        saida.push({
          forma: "messaging",
          objeto: raiz?.object ?? null,
          conta,
          chaves: Object.keys(ev),
          remetente: id(objeto(ev.sender)?.id),
          destinatario: id(objeto(ev.recipient)?.id),
          timestamp: ev.timestamp ?? null,
          mid: id(msg?.mid) ?? id(postback?.mid),
          eco: msg?.is_echo ?? null,
          chaves_mensagem: msg ? Object.keys(msg) : null,
          tamanho_texto: typeof msg?.text === "string" ? msg.text.length : null,
          resposta_a: msg?.reply_to ? Object.keys(objeto(msg.reply_to) ?? {}) : null,
          postback_payload: typeof postback?.payload === "string" ? postback.payload.slice(0, 80) : null,
          postback_chaves: postback ? Object.keys(postback) : null,
        });
      }
    }

    if (Array.isArray(entrada.changes)) {
      for (const b of entrada.changes) {
        const mudanca = objeto(b);
        if (!mudanca || mudanca.field === "comments") continue;
        const valor = objeto(mudanca.value);
        saida.push({
          forma: "changes",
          objeto: raiz?.object ?? null,
          conta,
          campo: mudanca.field ?? null,
          chaves_valor: valor ? Object.keys(valor) : null,
          remetente: id(objeto(valor?.sender)?.id) ?? id(objeto(valor?.from)?.id),
        });
      }
    }
  }
  return saida;
}

export function registrarEventosMensagem(corpo: unknown): void {
  try {
    for (const r of resumirEventosMensagem(corpo)) console.log("[diag-mensagens]", JSON.stringify(r));
  } catch (e) {
    console.error("[diag-mensagens] falhou", e instanceof Error ? e.message : e);
  }
}
