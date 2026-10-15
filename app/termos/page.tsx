import type { Metadata } from "next";
import Link from "next/link";
import { PRODUTO } from "@/lib/config";
import { PaginaTexto } from "@/components/publico";
import { REGRAS_DEMONSTRACAO, emReais, regras } from "@/lib/regras";

export const metadata: Metadata = { title: "Termos de uso" };
export const revalidate = 3600;

export default async function Termos() {
  const r = await regras().catch(() => REGRAS_DEMONSTRACAO);
  const n = PRODUTO.nome;
  return (
    <PaginaTexto titulo="Termos de uso" atualizado="14 de outubro de 2026">
      <p>
        Estes termos valem pro uso do {n}, serviço da {PRODUTO.empresa} ({PRODUTO.cidade}). Ao criar a conta,
        tu concorda com eles. Dúvida? Escreve pra{" "}
        <a href={`mailto:${PRODUTO.emailSuporte}`}>{PRODUTO.emailSuporte}</a>.
      </p>

      <h2>1. O que o {n} faz</h2>
      <p>
        Tu conecta a tua conta profissional do Instagram, escolhe um post (ou qualquer post), uma ou mais
        palavras-chave e uma mensagem com link. Quando alguém comenta a palavra, o {n} manda a tua mensagem no
        direct dessa pessoa usando a resposta privada oficial da Meta (uma por comentário, até{" "}
        {r.janelaRespostaPrivadaDias} dias depois do comentário) e, se tu quiser, responde o comentário em público.
      </p>

      <h2>2. O que o {n} não garante</h2>
      <ul>
        <li>
          O Instagram limita quantas ações uma conta faz por hora. O {n} manda em fila e pausa quando a Meta pede,
          mas <strong>não garante que a tua conta nunca será limitada ou bloqueada</strong>: essa decisão é da Meta.
        </li>
        <li>Não garantimos vendas, cliques nem resultado nenhum: o {n} entrega a mensagem, a oferta é tua.</li>
        <li>
          Se a Meta mudar as regras da API, tirar uma permissão ou ficar fora do ar, o serviço pode parar no todo
          ou em parte até a gente se adaptar.
        </li>
        <li>
          Mensagem que a Meta recusar (comentário apagado, pessoa que bloqueou a conta etc.) não é reenviada.
        </li>
      </ul>

      <h2>3. Tuas responsabilidades</h2>
      <ul>
        <li>Usar uma conta do Instagram que é tua ou que tu tem autorização pra gerenciar.</li>
        <li>
          Seguir as regras do Instagram e da Meta e a lei brasileira (incluindo o Código de Defesa do Consumidor e
          a LGPD). Tu decide o que a mensagem diz e pra onde o link leva.
        </li>
        <li>
          Não usar o {n} pra spam, golpe, conteúdo ilegal, enganoso, adulto ou que viole direito de alguém. Conta
          que fizer isso é suspensa.
        </li>
        <li>Guardar a tua senha. O que for feito com o teu login é responsabilidade tua.</li>
      </ul>

      <h2>4. Teste, preço e cancelamento</h2>
      <ul>
        <li>
          O teste grátis dura {r.testeDias} dias a partir do cadastro e não pede cartão. No fim do teste, as
          automações pausam até tu assinar. Nada é cobrado sem tu assinar.
        </li>
        <li>
          A assinatura custa {emReais(r.precoMensalCentavos)} por mês, no cartão (Mercado Pago) ou no Pix
          Automático (Asaas), e renova todo mês até tu cancelar.
        </li>
        <li>
          Tu cancela quando quiser, sem multa. O acesso segue até o fim do mês já pago; não devolvemos mês
          parcial, salvo o que a lei garantir (por exemplo, o arrependimento em até 7 dias da primeira contratação).
        </li>
        <li>Mudança de preço é avisada por e-mail com pelo menos 30 dias de antecedência.</li>
      </ul>

      <h2>5. Teus dados</h2>
      <p>
        Como tratamos os teus dados e os de quem comenta nos teus posts está na{" "}
        <Link href="/privacidade">política de privacidade</Link>. Pra apagar tudo, veja{" "}
        <Link href="/exclusao-de-dados">exclusão de dados</Link>.
      </p>

      <h2>6. Encerramento</h2>
      <p>
        Tu pode excluir a conta a qualquer momento pelo painel. A {PRODUTO.empresa} pode encerrar contas que
        descumprirem estes termos ou as regras da Meta, ou encerrar o serviço avisando com 30 dias de antecedência.
      </p>

      <h2>7. Responsabilidade</h2>
      <p>
        Na medida que a lei permite, a responsabilidade da {PRODUTO.empresa} por qualquer dano fica limitada ao
        que tu pagou nos últimos 3 meses.
      </p>

      <h2>8. Foro</h2>
      <p>
        Fica eleito o foro da comarca de Lajeado/RS, ressalvado o direito do consumidor de escolher o do seu
        domicílio.
      </p>
    </PaginaTexto>
  );
}
