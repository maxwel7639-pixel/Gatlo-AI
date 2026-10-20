/**
 * Os tipos que as telas usam. Valem para os dois bancos (Supabase e o local
 * de demonstração): as telas não sabem qual dos dois está por trás.
 */

export type Usuario = {
  id: string;
  email: string;
  nome: string | null;
};

export type StatusConta = "conectada" | "expirada" | "desconectada";

export type ContaInstagram = {
  id: string;
  igUserId: string;
  username: string;
  nome: string | null;
  fotoUrl: string | null;
  tipoConta: string | null;
  seguidores: number | null;
  demonstracao: boolean;
  status: StatusConta;
  conectadaEm: string;
};

/** O que o formulário de automação manda (o resto o servidor decide). */
export type DadosAutomacao = {
  nome: string;
  qualquerPost: boolean;
  mediaId: string | null;
  mediaPermalink: string | null;
  mediaMiniatura: string | null;
  mediaLegenda: string | null;
  palavras: string[];
  mensagemDm: string;
  linkUrl: string;
  linkTitulo: string;
  respostaPublica: string | null;
  ativa: boolean;
};

export type Automacao = DadosAutomacao & {
  id: string;
  contaId: string;
  codigo: string;
  criadaEm: string;
  atualizadaEm: string;
};

export type Comentario = {
  id: string;
  commentId: string;
  automacaoId: string | null;
  mediaId: string;
  autorUsername: string | null;
  texto: string | null;
  palavra: string | null;
  recebidoEm: string;
  dmEm: string | null;
  dmErro: string | null;
  respostaEm: string | null;
};

export type StatusAssinatura = "trial" | "ativa" | "vencida" | "cancelada" | "estornado";

/** A resposta de assinatura_situacao(): quem decide é o banco. */
export type Situacao = {
  status: StatusAssinatura;
  liberada: boolean;
  trialAte: string;
  periodoAte: string | null;
  diasRestantes: number;
};

export type Pausa = {
  directAte: string | null;
  respostaAte: string | null;
  motivo: string | null;
};

export type Numeros = {
  /** Comentários que bateram uma palavra. */
  comentarios: number;
  /** DMs que saíram. */
  dms: number;
  /** Esperando a vez (ainda dentro da janela de 7 dias da Meta). */
  naFila: number;
  /** A Meta recusou (comentário apagado, conta que não aceita mensagem...). */
  erros: number;
  /** Cliques no link curto. */
  cliques: number;
};

export type Clique = {
  automacaoId: string;
  userId: string;
  comentarioId: string | null;
  visitante: string;
};
