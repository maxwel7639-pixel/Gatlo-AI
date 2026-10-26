// Edge Function pública `gatilho-webhook` (verify_jwt desligado em supabase/config.toml).
//
// Quem chama é a Meta. O que protege a função é o próprio segredo dela:
//   GET  -> hub.verify_token = INSTAGRAM_WEBHOOK_VERIFY_TOKEN devolve hub.challenge
//   POST -> X-Hub-Signature-256 (HMAC com INSTAGRAM_APP_SECRET) conferido antes de
//           qualquer efeito; só então responde 200 e grava o comentário na fila.
//
// A lógica mora em processar.ts (sem banco) e manipulador.ts (HTTP); aqui só a ligação.
import { bancoSupabase } from "./banco_supabase.ts";
import { criarManipulador } from "./manipulador.ts";

Deno.serve(
  criarManipulador({
    env: (nome) => Deno.env.get(nome),
    banco: () => {
      const url = Deno.env.get("SUPABASE_URL");
      const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !chave) throw new Error("faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
      return bancoSupabase(url, chave);
    },
  }),
);
