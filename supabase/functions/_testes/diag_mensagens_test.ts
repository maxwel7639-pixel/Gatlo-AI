import { assert, assertEquals } from "@std/assert";
import { resumirEventosMensagem } from "../gatilho-webhook/diag_mensagens.ts";
import { inscreverMensagensDiag } from "../../../lib/instagram/meta.ts";

// Diagnóstico temporário do Passo 0: só ids e formas no log, nunca o texto da mensagem.

Deno.test("diag: resume mensagem e postback sem levar o texto", () => {
  const r = resumirEventosMensagem({
    object: "instagram",
    entry: [{
      id: "conta-1",
      time: 1,
      messaging: [
        { sender: { id: "pessoa-9" }, recipient: { id: "conta-1" }, timestamp: 2, message: { mid: "m1", text: "meu email é a@b.com" } },
        { sender: { id: "pessoa-9" }, recipient: { id: "conta-1" }, postback: { mid: "m2", payload: "g:abc:1", title: "Quero" } },
        { sender: { id: "conta-1" }, recipient: { id: "pessoa-9" }, message: { mid: "m3", is_echo: true, text: "oi" } },
      ],
    }],
  });
  assertEquals(r.length, 3);
  assertEquals(r[0].remetente, "pessoa-9");
  assertEquals(r[0].mid, "m1");
  assertEquals(r[0].tamanho_texto, 19);
  assertEquals(r[1].postback_payload, "g:abc:1");
  assertEquals(r[2].eco, true);
  assert(!JSON.stringify(r).includes("a@b.com"), "o texto nunca entra no resumo");
});

Deno.test("diag: changes de comentário são ignoradas; outros campos entram", () => {
  const r = resumirEventosMensagem({
    entry: [{
      id: "conta-1",
      changes: [
        { field: "comments", value: { id: "c1", text: "quero" } },
        { field: "messages", value: { sender: { id: "pessoa-9" }, message: { text: "x" } } },
      ],
    }],
  });
  assertEquals(r.length, 1);
  assertEquals(r[0].campo, "messages");
  assertEquals(r[0].remetente, "pessoa-9");
});

Deno.test("diag: corpo estranho não quebra", () => {
  assertEquals(resumirEventosMensagem(null), []);
  assertEquals(resumirEventosMensagem({ entry: "x" }), []);
  assertEquals(resumirEventosMensagem({ entry: [null, { id: 1, messaging: [null] }] }), []);
});

Deno.test("diag: inscrição em mensagens nunca lança, mesmo com a Meta recusando", async () => {
  const original = globalThis.fetch;
  const erro = console.error;
  console.error = () => {};
  globalThis.fetch = (() => Promise.resolve(Response.json({ error: { message: "sem permissão", code: 10 } }, { status: 400 }))) as typeof fetch;
  try {
    await inscreverMensagensDiag("falso");
  } finally {
    globalThis.fetch = original;
    console.error = erro;
  }
});
