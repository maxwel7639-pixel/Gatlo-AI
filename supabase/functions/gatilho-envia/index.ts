// Edge Function pública `gatilho-envia` (verify_jwt desligado em supabase/config.toml).
//
// Quem chama é o agendador do banco (pg_cron, de 3 em 3 min). O que protege a função é o
// segredo dela, conferido antes de qualquer efeito: cabeçalho `x-cron-chave` igual a
// GATILHO_CRON_CHAVE. Só então abre o banco, lê os tokens e fala com a Meta.
//
// A lógica mora em rodada.ts (atrás das interfaces Banco e Meta) e manipulador.ts (HTTP);
// aqui só a ligação com o mundo de verdade.
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
