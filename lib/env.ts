import "server-only";

/**
 * Em que modo o app está rodando. São DUAS chaves independentes:
 *
 * 1. O BANCO (cadastro, login, automações):
 *    - Supabase, quando as variáveis do Supabase existem;
 *    - "banco local de demonstração" (um arquivo JSON em .gatilho-demo/),
 *      quando não existem E o app está em desenvolvimento ou com GATILHO_DEMO=1.
 *    Em produção, sem Supabase e sem GATILHO_DEMO=1, o app NÃO cai no banco
 *    local: avisa que falta configurar. Assim uma variável apagada por engano
 *    na Vercel não vira "cadastro que some quando o servidor reinicia".
 *
 * 2. O INSTAGRAM:
 *    - de verdade, quando INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET existem;
 *    - fictício (perfil e posts inventados), com GATILHO_DEMO=1 ou sem essas
 *      variáveis. Nada é mandado pra Meta nesse modo.
 */

const temSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const demoLigado = process.env.GATILHO_DEMO === "1";
const producao = process.env.NODE_ENV === "production";

/** Banco e login pelo Supabase. */
export const usaSupabase = temSupabase;

/** Banco e login no arquivo local (só demonstração). */
export const usaBancoLocal = !temSupabase && (demoLigado || !producao);

/** Nem um nem outro: produção sem configuração. As telas avisam. */
export const faltaConfigurarBanco = !usaSupabase && !usaBancoLocal;

const temMeta = Boolean(
  process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET,
);

/**
 * Instagram fictício? Também é fictício sempre que o banco é o local: conta de
 * verdade com token de verdade não pode morar num arquivo de teste.
 */
export const instagramDemonstracao = demoLigado || !temMeta || usaBancoLocal;

/**
 * Portas de pagamento prontas: a chave da API E o segredo do webhook. Sem a chave o
 * checkout dá erro; sem o segredo o webhook responde 401 e o pagamento nunca libera.
 * Faltando um dos dois, o botão some e a ação recusa. O Pix entra depois do sandbox.
 */
export const temCartao = Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN && process.env.MERCADOPAGO_WEBHOOK_SECRET);
export const temPix = Boolean(process.env.ASAAS_API_KEY && process.env.ASAAS_WEBHOOK_TOKEN);

export const AVISO_SEM_CONFIGURACAO =
  "O app está sem banco configurado. Preenche as variáveis do Supabase " +
  "(veja o .env.example e o README) ou liga GATILHO_DEMO=1 pra testar.";
