import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase com a SERVICE ROLE: passa por cima do RLS.
 *
 * Só no servidor (o `server-only` acima quebra o build se alguém importar isto
 * num componente de navegador) e sempre DEPOIS de saber quem é o usuário pela
 * sessão. Usado só para o que o usuário não pode fazer sozinho: ler e gravar o
 * token do Instagram, gravar a conexão, registrar clique do link curto, a trava
 * de taxa e as regras de cobrança.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
