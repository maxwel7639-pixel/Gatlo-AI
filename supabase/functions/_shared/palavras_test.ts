import { assert, assertEquals } from "@std/assert";
import { limparPalavras, normalizar, palavraQueBateu } from "./palavras.ts";

// A cópia da função tem que ser IDÊNTICA a lib/palavras.ts: é a mesma regra que
// a prévia do painel mostra, e a prévia nunca pode mentir. Só a quebra de linha
// é ignorada (o git no Windows troca LF por CRLF).
Deno.test("palavras.ts da função é idêntica a lib/palavras.ts", async () => {
  const doApp = await Deno.readTextFile(new URL("../../../lib/palavras.ts", import.meta.url));
  const daFuncao = await Deno.readTextFile(new URL("./palavras.ts", import.meta.url));
  const semCr = (s: string) => s.replace(/\r\n/g, "\n");
  assert(
    semCr(doApp) === semCr(daFuncao),
    "supabase/functions/_shared/palavras.ts divergiu de lib/palavras.ts: copie o arquivo de novo (cp lib/palavras.ts supabase/functions/_shared/palavras.ts)",
  );
});

Deno.test("palavraQueBateu: maiúscula e acento não contam, palavra inteira", () => {
  assertEquals(palavraQueBateu("QUÉRO o link", ["quero"]), "quero");
  assertEquals(palavraQueBateu("LINK!!!", ["link"]), "link");
  assertEquals(palavraQueBateu("vi no linkedin", ["link"]), null);
  assertEquals(palavraQueBateu("quero o link", ["preço", "quero o link"]), "quero o link");
  assertEquals(palavraQueBateu("😍🔥", ["🔥"]), "🔥");
});

Deno.test("normalizar e limparPalavras", () => {
  assertEquals(normalizar("  Quéro   Já "), "quero ja");
  assertEquals(limparPalavras([" Quero ", "QUERO", "", "link"]), ["Quero", "link"]);
});
