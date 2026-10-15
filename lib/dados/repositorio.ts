import type {
  Automacao,
  Clique,
  Comentario,
  ContaInstagram,
  DadosAutomacao,
  Numeros,
  Pausa,
  Situacao,
} from "./tipos";

/** O que o servidor guarda quando uma conta do Instagram é conectada. */
export type NovaConexao = {
  igUserId: string;
  igAppId: string | null;
  username: string;
  nome: string | null;
  fotoUrl: string | null;
  tipoConta: string | null;
  seguidores: number | null;
  demonstracao: boolean;
  /** Já cifrado (lib/cripto.ts). null no modo demonstração. */
  tokenCifrado: string | null;
  tokenExpiraEm: string | null;
  escopos: string[];
};

export type ResultadoConexao =
  | { ok: true; conta: ContaInstagram }
  | { ok: false; erro: string };

/**
 * Tudo que as telas pedem ao banco. Duas implementações com o mesmo contrato:
 * Supabase (de verdade) e o banco local de demonstração.
 *
 * Todo método que recebe `userId` só devolve/mexe no que é desse usuário.
 * Quem chama SEMPRE tirou o userId da sessão (exigirUsuario), nunca do
 * formulário.
 */
export type Repositorio = {
  contaInstagram(userId: string): Promise<ContaInstagram | null>;
  salvarConexao(userId: string, c: NovaConexao): Promise<ResultadoConexao>;
  desconectar(userId: string): Promise<void>;

  listarAutomacoes(userId: string): Promise<Automacao[]>;
  automacao(userId: string, id: string): Promise<Automacao | null>;
  criarAutomacao(userId: string, contaId: string, dados: DadosAutomacao): Promise<Automacao>;
  atualizarAutomacao(userId: string, id: string, dados: Partial<DadosAutomacao>): Promise<void>;
  excluirAutomacao(userId: string, id: string): Promise<void>;

  /** Números de tudo (ou de uma automação), desde uma data. */
  numeros(userId: string, filtro: { automacaoId?: string; desde?: string }): Promise<Numeros>;
  /** Números de todas as automações de uma vez (desde sempre), por id. */
  numerosPorAutomacao(userId: string): Promise<Record<string, Numeros>>;
  comentariosRecentes(userId: string, automacaoId: string, limite: number): Promise<Comentario[]>;

  situacao(userId: string): Promise<Situacao | null>;
  pausa(userId: string, contaId: string): Promise<Pausa | null>;

  /* link curto (rota pública: só o servidor chama) */
  destinoDoLink(codigo: string): Promise<{ automacaoId: string; userId: string; linkUrl: string } | null>;
  comentarioEhDaAutomacao(comentarioId: string, automacaoId: string): Promise<boolean>;
  registrarClique(c: Clique): Promise<void>;

  /* avisos da Meta (desautorizou o app / pediu exclusão de dados) */
  desconectarPorInstagram(ids: string[]): Promise<number>;
  apagarPorInstagram(ids: string[]): Promise<number>;

  /** Só no modo demonstração: cria comentários fictícios numa automação. */
  simularComentarios(userId: string, automacaoId: string): Promise<number>;
};
