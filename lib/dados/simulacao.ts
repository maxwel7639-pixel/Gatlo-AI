import { randomUUID } from "node:crypto";
import type { Automacao } from "./tipos";

/**
 * Comentários FICTÍCIOS pro modo demonstração: dá pra ver a tela de detalhe
 * com fila, DMs e cliques sem ter o app da Meta. Nada disso vai pro Instagram.
 */

const PESSOAS = [
  "ana.luiza.rs", "brunocosta", "carol_doces", "dudapereira", "edu.fitness",
  "fefa.martins", "gabi.arquiteta", "henrique.lajeado", "isa_makeup", "joao.pedro.s",
  "ka.oliveira", "lucas.barista", "mari.viaja", "nanda.store", "otavio.photo",
  "paulinha_rs", "rafa.dev", "sofia.loja", "tati.nails", "vini.musico",
];

const MOLDES = ["{p}", "{P}!", "{p} por favor 🙏", "Quero! {p}", "{P} {P}", "{p} 😍", "me manda, {p}"];

export type ComentarioSimulado = {
  id: string;
  commentId: string;
  autorUsername: string;
  autorIgId: string;
  texto: string;
  palavra: string;
  mediaId: string;
  recebidoEm: string;
  dmEm: string | null;
  dmErro: string | null;
  respostaEm: string | null;
  clicou: boolean;
};

function sortear<T>(lista: readonly T[]): T {
  return lista[Math.floor(Math.random() * lista.length)];
}

export function gerarComentarios(a: Automacao, quantos = 6): ComentarioSimulado[] {
  const agora = Date.now();
  const saida: ComentarioSimulado[] = [];
  for (let i = 0; i < quantos; i++) {
    const palavra = sortear(a.palavras);
    const recebido = agora - Math.floor(Math.random() * 6 * 3600_000);
    // ~70% já recebeu, ~20% na fila, ~10% a Meta recusou
    const sorte = Math.random();
    const recebeu = sorte < 0.7;
    const erro = sorte >= 0.9;
    const dmEm = recebeu ? new Date(recebido + (1 + Math.random() * 9) * 60_000).toISOString() : null;
    saida.push({
      id: randomUUID(),
      commentId: `demo_${randomUUID()}`,
      autorUsername: sortear(PESSOAS),
      autorIgId: `demo_${Math.floor(Math.random() * 1e9)}`,
      texto: sortear(MOLDES)
        .replaceAll("{p}", palavra.toLowerCase())
        .replaceAll("{P}", palavra.toUpperCase()),
      palavra,
      mediaId: a.mediaId ?? "demo_post_1",
      recebidoEm: new Date(Math.min(recebido, agora)).toISOString(),
      dmEm: dmEm && Date.parse(dmEm) > agora ? new Date(agora).toISOString() : dmEm,
      dmErro: erro ? "A Meta recusou a mensagem (o comentário pode ter sido apagado)." : null,
      respostaEm: recebeu && a.respostaPublica ? dmEm : null,
      clicou: recebeu && Math.random() < 0.45,
    });
  }
  return saida;
}
