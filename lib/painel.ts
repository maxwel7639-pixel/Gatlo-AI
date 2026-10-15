import "server-only";
import { cache } from "react";
import { exigirUsuario } from "./auth/sessao";
import { repo } from "./dados";
import { instagramDemonstracao, usaBancoLocal } from "./env";

/**
 * O básico que toda tela do painel precisa: quem é, qual Instagram está
 * conectado e a situação da assinatura. `cache` = uma vez por requisição,
 * mesmo que o layout e a página peçam.
 */
export const basePainel = cache(async () => {
  const usuario = await exigirUsuario();
  const r = repo();
  const [conta, situacao] = await Promise.all([r.contaInstagram(usuario.id), r.situacao(usuario.id)]);
  return {
    usuario,
    conta,
    situacao,
    demonstracao: { instagram: instagramDemonstracao, banco: usaBancoLocal },
  };
});
