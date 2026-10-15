import type { Metadata } from "next";
import Link from "next/link";
import { PRODUTO } from "@/lib/config";
import { usaSupabase } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { PaginaTexto } from "@/components/publico";
import { Aviso } from "@/components/ui";
import { dataHora } from "@/lib/formato";

export const metadata: Metadata = { title: "Exclusão de dados" };

/** Status de um pedido que veio pela Meta (o link que a Meta mostra pra pessoa). */
async function statusDoPedido(codigo: string) {
  if (!usaSupabase || !/^[A-Za-z0-9_-]{8,64}$/.test(codigo)) return null;
  const { data } = await createAdminClient()
    .from("pedidos_exclusao")
    .select("recebido_em, concluido_em")
    .eq("codigo", codigo)
    .maybeSingle();
  return data;
}

export default async function ExclusaoDeDados({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>;
}) {
  const { codigo } = await searchParams;
  const pedido = codigo ? await statusDoPedido(codigo) : null;
  const n = PRODUTO.nome;
  const email = PRODUTO.emailSuporte;

  return (
    <PaginaTexto titulo="Exclusão de dados" atualizado="14 de outubro de 2026">
      {codigo ? (
        pedido ? (
          <Aviso tipo={pedido.concluido_em ? "ok" : "info"}>
            Pedido <strong>{codigo}</strong>:{" "}
            {pedido.concluido_em
              ? `concluído em ${dataHora(pedido.concluido_em)}. Os dados ligados a essa conta do Instagram foram apagados.`
              : `recebido em ${dataHora(pedido.recebido_em)} e em andamento.`}
          </Aviso>
        ) : (
          <Aviso tipo="atencao">
            Não achei o pedido {codigo}. Confere o código ou escreve pra {email}.
          </Aviso>
        )
      ) : null}

      <p>
        Tu pode apagar os teus dados do {n} quando quiser. Escolhe o caminho que combina com o teu caso:
      </p>

      <h2>1. Tenho conta no {n} e quero apagar tudo</h2>
      <ul>
        <li>
          Entra no painel, vai em <strong>Conta</strong> e clica em <strong>Excluir minha conta</strong>. Apaga na
          hora: cadastro, conexão e token do Instagram, automações, comentários recebidos e cliques.
        </li>
        <li>
          Sem acesso ao painel? Manda um e-mail pra <a href={`mailto:${email}?subject=Excluir%20meus%20dados`}>{email}</a>{" "}
          com o assunto <strong>Excluir meus dados</strong>, a partir do e-mail cadastrado. Apagamos em até 15 dias e
          respondemos confirmando.
        </li>
        <li>
          Registros de pagamento ficam guardados pelo prazo da lei fiscal (5 anos), sem uso nenhum além disso.
        </li>
      </ul>

      <h2>2. Só quero tirar o acesso ao meu Instagram</h2>
      <ul>
        <li>
          No painel: <strong>Conta → Desconectar Instagram</strong>. O token é apagado na hora e as automações
          pausam.
        </li>
        <li>
          Ou no próprio Instagram: <strong>Configurações → Apps e sites</strong> (ou Central de Contas →
          Permissões), remove o {n}. A Meta nos avisa e a gente apaga o token e os dados ligados a essa conta.
        </li>
      </ul>

      <h2>3. Comentei num post e recebi uma DM de um cliente do {n}</h2>
      <p>
        Manda um e-mail pra <a href={`mailto:${email}?subject=Excluir%20meu%20comentario`}>{email}</a> com o teu
        @ do Instagram e o perfil onde tu comentou. Apagamos o registro do teu comentário (nome de usuário, id e
        texto) em até 15 dias. Pra não receber mais nada, é só não comentar a palavra de novo; o {n} nunca manda
        mensagem pra quem não comentou.
      </p>

      <p className="pt-4 text-sm text-suave">
        Mais detalhes em <Link href="/privacidade">política de privacidade</Link>.
      </p>
    </PaginaTexto>
  );
}
