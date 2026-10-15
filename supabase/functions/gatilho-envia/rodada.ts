import { ehLimite, foiRecusa, type Meta, textoDoErro } from "./meta.ts";
import { decifrarToken } from "./token.ts";

/**
 * Uma rodada do envio (o que o pg_cron dispara de 3 em 3 min): para cada conta, tira
 * comentários da fila e manda a DM (resposta privada) e, se a automação pede, a resposta
 * pública. Tudo que a rodada precisa do mundo de fora passa por `Banco` (em produção,
 * banco_supabase.ts; nos testes, um Postgres de verdade) e por `Meta` (nos testes, falsa).
 *
 * Nenhum número de negócio mora aqui: máximo por rodada, intervalo, minutos de pausa e
 * teto de respostas vêm da tabela `regras`.
 */

export interface Regras {
  envioMaxPorRodada: number;
  envioIntervaloSegundos: number;
  envioPausaDirectMin: number;
  envioPausaRespostaMin: number;
  respostasPublicasMax24h: number;
  filaJanelaDias: number;
}

export interface ContaEnvio {
  id: string;
  user_id: string;
  ig_user_id: string;
}

export interface Pausa {
  direct_ate: string | null;
  resposta_ate: string | null;
}

export interface TokenGuardado {
  token_cifrado: string;
  expira_em: string | null;
}

export interface AutomacaoEnvio {
  id: string;
  codigo: string;
  mensagem_dm: string;
  link_titulo: string;
  resposta_publica: string | null;
  ativa: boolean;
}

export interface ItemFila {
  id: string;
  comment_id: string;
  /** quantas vezes alguém já reservou este comentário (0 = ninguém mexeu) */
  dm_tentativas: number;
  /** null = a automação foi apagada */
  automacao: AutomacaoEnvio | null;
}

export interface Banco {
  /** Lê a tabela `regras`. Regra faltando é erro (nunca um número inventado). */
  regras(): Promise<Regras>;
  /** Contas com status "conectada" e demonstracao = false. */
  contasConectadas(): Promise<ContaEnvio[]>;
  /** assinatura_situacao(user_id).liberada; sem assinatura = false. */
  assinaturaLiberada(userId: string): Promise<boolean>;
  pausa(contaId: string): Promise<Pausa>;
  token(contaId: string): Promise<TokenGuardado | null>;
  /**
   * A fila da conta: dm_em nulo, dm_erro nulo, recebido_em depois de `desde`, por
   * recebido_em, no máximo `limite`, e SEM reserva em voo: dm_reservado_em nulo (ninguém
   * reservou, ou a reserva foi devolvida) ou mais velho que `presaAntes` (a rodada que
   * reservou morreu). Reserva mais nova que `presaAntes` é de uma rodada ainda trabalhando
   * e ninguém pega. Comentário de automação DESLIGADA não entra (fica guardado e não ocupa
   * vaga); o de automação apagada entra, com `automacao: null`.
   */
  fila(contaId: string, desde: Date, limite: number, presaAntes: Date): Promise<ItemFila[]>;
  /**
   * RESERVA atômica: dm_tentativas passa de `lido` para `lido + 1` e dm_reservado_em recebe
   * `quando`, só se a linha ainda tem dm_em e dm_erro nulos e dm_tentativas = `lido`. false =
   * outra rodada levou. É a única trava contra a mesma DM sair duas vezes.
   */
  reservar(comentarioId: string, lido: number, quando: Date): Promise<boolean>;
  /**
   * Devolve a reserva (a Meta mandou esperar): dm_tentativas volta de `reservado` para
   * `reservado - 1` e dm_reservado_em zera.
   */
  liberarReserva(comentarioId: string, reservado: number): Promise<void>;
  /** dm_em = agora e igsid, só se dm_em ainda é nulo. */
  marcarDmOk(comentarioId: string, igsid: string | null, quando: Date): Promise<void>;
  /** dm_erro, só se dm_em ainda é nulo. */
  marcarDmErro(comentarioId: string, erro: string): Promise<void>;
  marcarRespostaOk(comentarioId: string, quando: Date): Promise<void>;
  marcarRespostaErro(comentarioId: string, erro: string): Promise<void>;
  /** Quantas respostas públicas a conta mandou desde `desde` (resposta_em). */
  respostasPublicasDesde(contaId: string, desde: Date): Promise<number>;
  /** envio_pausa.direct_ate (sem mexer em resposta_ate) e o motivo. */
  pausarDirect(contaId: string, ate: Date, motivo: string): Promise<void>;
  /** envio_pausa.resposta_ate (sem mexer em direct_ate) e o motivo. */
  pausarResposta(contaId: string, ate: Date, motivo: string): Promise<void>;
}

export interface DependenciasRodada {
  banco: Banco;
  /** Uma Meta para esse token (a rodada decifra o token de cada conta). */
  meta: (token: string) => Meta;
  chaveTokens: CryptoKey;
  /** GATILHO_SITE_URL, sem barra no fim */
  siteUrl: string;
  /** Espera de verdade em produção; os testes não esperam. */
  esperar: (ms: number) => Promise<void>;
  /** Date.now() em produção */
  agora: () => number;
  /**
   * Constante de infraestrutura (não é regra de negócio): passou disto, a rodada não
   * começa envio novo e o resto fica na fila. Tem que ser menor que os 3 min do cron.
   */
  orcamentoMs: number;
  /** Quantas contas ao mesmo tempo */
  contasEmParalelo: number;
  /**
   * Constante de infraestrutura: reserva mais velha que isto é de uma rodada que morreu. Tem
   * que ser bem maior que a rodada mais longa possível (orçamento + chamadas à Meta, ~2,5 min).
   */
  recuperacaoMs: number;
  /** Math.random em produção; os testes passam um sorteio com semente. */
  sortear: () => number;
}

export type ResumoRodada = {
  /** contas conectadas olhadas */
  contas: number;
  /** DMs que a Meta aceitou */
  enviadas: number;
  /** DMs marcadas com dm_erro */
  erros: number;
  /** respostas públicas que a Meta aceitou */
  respostas: number;
  /** contas que a Meta mandou esperar nesta rodada */
  pausadas: number;
  /** contas puladas: assinatura, pausa, sem token ou token vencido/ilegível */
  puladas: number;
  /** comentários que outra rodada reservou primeiro */
  concorrencia: number;
  /** contas cuja leitura/escrita no banco falhou (o erro vai para o log) */
  falhas: number;
  /** a rodada parou de começar envios por causa do orçamento de tempo */
  orcamento: boolean;
};

const DIA_MS = 24 * 60 * 60 * 1000;

/** Fisher-Yates sobre uma cópia; `sortear` devolve um número em [0, 1). */
function embaralhar<T>(lista: T[], sortear: () => number): T[] {
  const r = [...lista];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(sortear() * (i + 1)));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export async function rodar(d: DependenciasRodada): Promise<ResumoRodada> {
  const comeco = d.agora();
  const regras = await d.banco.regras();
  // a ordem das contas muda a cada rodada: com o orçamento de tempo estourando, as mesmas
  // contas (as últimas por id) não ficam sempre de fora
  const contas = embaralhar(await d.banco.contasConectadas(), d.sortear);
  const resumo: ResumoRodada = {
    contas: contas.length,
    enviadas: 0,
    erros: 0,
    respostas: 0,
    pausadas: 0,
    puladas: 0,
    concorrencia: 0,
    falhas: 0,
    orcamento: false,
  };

  // poucas contas por vez: cada trabalhador pega a próxima da lista quando termina a sua
  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < contas.length) {
      const conta = contas[proxima++];
      if (d.agora() - comeco >= d.orcamentoMs) {
        resumo.orcamento = true;
        return;
      }
      try {
        await rodarConta(conta, d, regras, comeco, resumo);
      } catch (e) {
        resumo.falhas++;
        // só o id da conta e a mensagem do erro: nada de comentário, texto ou token
        console.error(`[gatilho-envia] conta ${conta.id}:`, e instanceof Error ? e.message : e);
      }
    }
  };
  const n = Math.max(1, Math.min(d.contasEmParalelo, contas.length));
  await Promise.all(Array.from({ length: n }, trabalhador));
  return resumo;
}

/** Tenta de novo uma escrita que vem DEPOIS de a Meta aceitar a mensagem: perder a marca deixaria a linha reservada para sempre. */
async function anotar(d: DependenciasRodada, escrita: () => Promise<void>): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await escrita();
    } catch (e) {
      if (tentativa >= 3) throw e;
      await d.esperar(500 * tentativa);
    }
  }
}

async function rodarConta(
  conta: ContaEnvio,
  d: DependenciasRodada,
  regras: Regras,
  comeco: number,
  resumo: ResumoRodada,
): Promise<void> {
  const { banco } = d;
  const estourou = () => d.agora() - comeco >= d.orcamentoMs;

  // 1. teste vencido / sem pagar: a automação pausa e a fila fica guardada
  if (!(await banco.assinaturaLiberada(conta.user_id))) {
    resumo.puladas++;
    return;
  }

  // 2. a Meta mandou esperar
  const pausa = await banco.pausa(conta.id);
  if (pausa.direct_ate && Date.parse(pausa.direct_ate) > d.agora()) {
    resumo.puladas++;
    return;
  }

  // 3. a fila
  const desde = new Date(d.agora() - regras.filaJanelaDias * DIA_MS);
  const fila = await banco.fila(conta.id, desde, regras.envioMaxPorRodada, new Date(d.agora() - d.recuperacaoMs));
  if (fila.length === 0) return;

  // 4. o token (só se há o que enviar). Sem token ou vencido: pula sem marcar erro em ninguém.
  const guardado = await banco.token(conta.id);
  if (!guardado || (guardado.expira_em && Date.parse(guardado.expira_em) <= d.agora())) {
    resumo.puladas++;
    return;
  }
  let token: string;
  try {
    token = await decifrarToken(guardado.token_cifrado, d.chaveTokens);
  } catch {
    console.error(`[gatilho-envia] conta ${conta.id}: token ilegível (chave trocada ou dado corrompido)`);
    resumo.puladas++;
    return;
  }
  const meta = d.meta(token);

  let respostas24h: number | null = null; // só lê se alguém precisar
  let respostaAte = pausa.resposta_ate ? Date.parse(pausa.resposta_ate) : 0;
  let chamouMeta = false;

  for (const item of fila) {
    if (estourou()) {
      resumo.orcamento = true;
      return;
    }

    const automacao = item.automacao;
    if (!automacao) {
      // a automação foi apagada: não há mensagem para mandar
      await anotar(d, () => banco.marcarDmErro(item.id, "automação apagada"));
      resumo.erros++;
      continue;
    }
    // desligada: não envia e deixa na fila (se religar dentro da janela, sai)
    if (!automacao.ativa) continue;

    // reserva presa que já foi recuperada uma vez e prendeu de novo: desiste, sem falar com a Meta
    if (item.dm_tentativas >= 2) {
      await anotar(d, () => banco.marcarDmErro(item.id, "rodada interrompida"));
      resumo.erros++;
      continue;
    }

    // o intervalo entre uma DM e outra da mesma conta
    if (chamouMeta) {
      await d.esperar(regras.envioIntervaloSegundos * 1000);
      if (estourou()) {
        resumo.orcamento = true;
        return;
      }
    }

    // RESERVA antes de falar com a Meta; quem não conseguir a linha pula.
    // Uma linha com dm_tentativas = 1 que chega aqui é reserva presa (a rodada anterior morreu):
    // reenviar é seguro porque a Meta só aceita UMA resposta privada por comentário. Se a DM
    // tinha saído, a Meta recusa esta e a linha vira dm_erro, sem DM dupla para a pessoa.
    if (!(await banco.reservar(item.id, item.dm_tentativas, new Date(d.agora())))) {
      resumo.concorrencia++;
      continue;
    }
    const reservado = item.dm_tentativas + 1;

    const link = `${d.siteUrl}/l/${automacao.codigo}?c=${item.id}`;
    chamouMeta = true;
    let r = await meta.enviarBotao(conta.ig_user_id, item.comment_id, {
      texto: automacao.mensagem_dm,
      titulo: automacao.link_titulo,
      url: link,
    });
    // a Meta recusou o botão (e não foi por volume): manda como texto, com o link no fim
    if (!r.ok && foiRecusa(r.erro)) {
      r = await meta.enviarTexto(conta.ig_user_id, item.comment_id, `${automacao.mensagem_dm}\n\n${link}`);
    }

    if (!r.ok) {
      const motivo = textoDoErro(r.erro);
      if (ehLimite(r.erro)) {
        // não é erro da pessoa: ela segue na fila e a conta para até a pausa acabar
        await anotar(d, () => banco.liberarReserva(item.id, reservado));
        const ate = new Date(d.agora() + regras.envioPausaDirectMin * 60_000);
        await anotar(d, () => banco.pausarDirect(conta.id, ate, motivo));
        resumo.pausadas++;
        return;
      }
      await anotar(d, () => banco.marcarDmErro(item.id, motivo));
      resumo.erros++;
      continue;
    }

    const igsid = r.recipient_id;
    await anotar(d, () => banco.marcarDmOk(item.id, igsid, new Date(d.agora())));
    resumo.enviadas++;

    // resposta pública: só se a DM saiu, a conta não está em pausa de resposta e há folga no teto
    if (!automacao.resposta_publica || respostaAte > d.agora()) continue;
    respostas24h ??= await banco.respostasPublicasDesde(conta.id, new Date(d.agora() - DIA_MS));
    if (respostas24h >= regras.respostasPublicasMax24h) continue;

    const rr = await meta.responderComentario(item.comment_id, automacao.resposta_publica);
    if (rr.ok) {
      respostas24h++;
      resumo.respostas++;
      await anotar(d, () => banco.marcarRespostaOk(item.id, new Date(d.agora())));
    } else {
      const motivo = textoDoErro(rr.erro);
      if (ehLimite(rr.erro)) {
        // a DM já saiu e fica marcada; só as respostas esperam
        const ate = new Date(d.agora() + regras.envioPausaRespostaMin * 60_000);
        respostaAte = ate.getTime();
        await anotar(d, () => banco.pausarResposta(conta.id, ate, motivo));
      } else {
        await anotar(d, () => banco.marcarRespostaErro(item.id, motivo));
      }
    }
  }
}
