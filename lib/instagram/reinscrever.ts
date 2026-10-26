import { ErroMeta, inscreverComentarios } from "./meta";

export type ContaParaInscrever = { id: string; token: string };

/** Quantas inscrições ao mesmo tempo: o cron tem tempo de sobra, a Meta não precisa de rajada. */
const EM_PARALELO = 5;

/**
 * Inscreve cada conta nos avisos de comentário (POST /me/subscribed_apps, que é idempotente:
 * inscrever quem já está inscrita não muda nada). Serve para consertar a conta cuja inscrição
 * falhou na hora de conectar. A falha de uma conta vai para o log e não para as outras.
 * Nunca lança por causa de uma conta; o log leva só o id da conta e o motivo (nunca o token).
 */
export async function reinscrever(
  contas: ContaParaInscrever[],
  inscrever: (token: string) => Promise<void> = inscreverComentarios,
): Promise<{ inscritas: number; falhas: number }> {
  let inscritas = 0;
  let falhas = 0;
  for (let i = 0; i < contas.length; i += EM_PARALELO) {
    await Promise.all(
      contas.slice(i, i + EM_PARALELO).map(async (conta) => {
        try {
          await inscrever(conta.token);
          inscritas++;
        } catch (e) {
          falhas++;
          console.error("[reinscrever]", conta.id, e instanceof ErroMeta ? `${e.codigo} ${e.message}` : (e as Error).message);
        }
      }),
    );
  }
  return { inscritas, falhas };
}
