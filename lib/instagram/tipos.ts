export type PerfilInstagram = {
  /** id da conta profissional (campo user_id de /me): o que chega no webhook. */
  igUserId: string;
  /** id do app pra esse usuário (campo id de /me). */
  igAppId: string | null;
  username: string;
  nome: string | null;
  fotoUrl: string | null;
  tipoConta: string | null;
  seguidores: number | null;
};

export type Metricas = {
  alcance: number | null;
  visualizacoes: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
};

export type Post = {
  id: string;
  legenda: string;
  /** IMAGE, VIDEO ou CAROUSEL_ALBUM */
  tipo: string;
  /** FEED, REELS ou STORY */
  produto: string | null;
  miniatura: string | null;
  permalink: string | null;
  publicadoEm: string;
  comentarios: number | null;
  curtidas: number | null;
  /** null = a Meta não informou (sem permissão, post antigo, álbum...). */
  metricas: Metricas | null;
};

/** Um comentário de um post da conta (e as respostas dele, um nível só, como no Instagram). */
export type Comentario = {
  id: string;
  texto: string;
  username: string | null;
  /** id de quem comentou (from.id); igual ao igUserId da conta = comentário da própria conta. */
  autorId: string | null;
  publicadoEm: string;
  oculto: boolean;
  respostas: Comentario[];
};
