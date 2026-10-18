import type { Metadata } from "next";
import Link from "next/link";
import { PRODUTO } from "@/lib/config";
import { PaginaTexto } from "@/components/publico";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function Privacidade() {
  const n = PRODUTO.nome;
  return (
    <PaginaTexto titulo="Política de privacidade" atualizado="14 de outubro de 2026">
      <p>
        Esta política explica quais dados o {n} (serviço da {PRODUTO.empresa}, {PRODUTO.cidade}) trata, pra quê,
        e como tu pede pra ver ou apagar. Contato do encarregado:{" "}
        <a href={`mailto:${PRODUTO.emailSuporte}`}>{PRODUTO.emailSuporte}</a>.
      </p>

      <h2>1. Dados de quem usa o {n} (tu, cliente)</h2>
      <ul>
        <li>
          <strong>Cadastro:</strong> nome, e-mail e senha (guardada só como resumo criptográfico; ninguém lê).
        </li>
        <li>
          <strong>Instagram conectado:</strong> id da conta, nome de usuário, nome, foto, tipo de conta e número
          de seguidores; e o token de acesso que a Meta entrega no login. O token fica <strong>cifrado</strong>,
          numa área que só o nosso servidor acessa, e nunca vai pro navegador. Não vemos nem guardamos a tua senha
          do Instagram.
        </li>
        <li>
          <strong>Posts:</strong> a lista e as métricas (comentários, curtidas, alcance, visualizações,
          salvamentos, compartilhamentos) são lidas na hora pra te mostrar. Do post escolhido numa automação
          guardamos o id, o link, a miniatura e o começo da legenda.
        </li>
        <li>
          <strong>Automações:</strong> as palavras, a mensagem, o link e as configurações que tu cria.
        </li>
        <li>
          <strong>Pagamento:</strong> status, valor e os códigos do Mercado Pago ou do Asaas. Dado de cartão nunca
          passa pelo {n}: fica no gateway. No Pix Automático, o CPF ou CNPJ que tu digita vai direto pro Asaas e não
          fica guardado aqui.
        </li>
      </ul>

      <h2>2. Dados de quem comenta nos teus posts</h2>
      <p>
        Quando alguém comenta uma das tuas palavras-chave, o {n} recebe da Meta e guarda: o id do comentário, o
        nome de usuário e o id de quem comentou, o texto do comentário e os horários (comentário, envio da DM,
        resposta pública). Isso serve só pra mandar a mensagem uma vez e mostrar a fila e os números pra ti.
        Nesse caso tu é o controlador dos dados e a {PRODUTO.empresa} trata em teu nome (operadora, pela LGPD).
      </p>
      <p>
        Comentário que <strong>não</strong> tem a palavra-chave não é guardado.
      </p>

      <h2>3. Cliques no link</h2>
      <p>
        O botão da DM passa por um link curto do {n} que conta o clique e leva direto ao teu link. Guardamos a
        data e uma impressão embaralhada (com sal) do navegador, só pra contar clique único.{" "}
        <strong>O endereço IP não é guardado.</strong>
      </p>

      <h2>4. Pra que usamos (e a base legal)</h2>
      <ul>
        <li>Prestar o serviço que tu contratou (execução de contrato).</li>
        <li>Segurança: limite de tentativas de login e de cadastro, prevenção de abuso (legítimo interesse).</li>
        <li>Cobrança e obrigações fiscais (obrigação legal).</li>
      </ul>
      <p>
        Não vendemos dado nenhum, não usamos pra anúncio e não mandamos mensagem pra quem não comentou.
      </p>

      <h2>5. Com quem compartilhamos</h2>
      <ul>
        <li>
          <strong>Meta (Instagram):</strong> as chamadas da API pra ler posts e comentários e mandar as mensagens.
        </li>
        <li><strong>Supabase:</strong> banco de dados e login.</li>
        <li><strong>Vercel:</strong> hospedagem do site.</li>
        <li><strong>Mercado Pago e Asaas:</strong> cobrança da assinatura.</li>
      </ul>
      <p>Alguns desses fornecedores guardam dados fora do Brasil, com as garantias que a LGPD exige.</p>

      <h2>6. Por quanto tempo</h2>
      <ul>
        <li>Cadastro, automações e conexão: enquanto a conta existir.</li>
        <li>Comentários e cliques: até 90 dias; depois são apagados.</li>
        <li>Pagamentos: pelo prazo que a lei fiscal exige (5 anos).</li>
        <li>Desconectou o Instagram? O token é apagado na hora.</li>
      </ul>

      <h2>7. Teus direitos</h2>
      <p>
        Tu pode pedir acesso, correção, cópia ou exclusão dos teus dados, e revogar o acesso ao Instagram quando
        quiser. Quem comentou num post de um cliente pode pedir a exclusão dos próprios dados pelo mesmo e-mail.
        Como fazer: <Link href="/exclusao-de-dados">exclusão de dados</Link>.
      </p>

      <h2>8. Segurança</h2>
      <p>
        Conexão sempre criptografada (HTTPS), token do Instagram cifrado, cada cliente só enxerga os próprios
        dados (regra no próprio banco), limite de tentativas no login e cabeçalhos de segurança no site.
      </p>

      <h2>9. Mudanças</h2>
      <p>Se esta política mudar de um jeito que te afete, a gente avisa por e-mail antes.</p>
    </PaginaTexto>
  );
}
