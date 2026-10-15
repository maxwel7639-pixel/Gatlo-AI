import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  Automacao,
  Comentario,
  ContaInstagram,
  Pausa,
  StatusAssinatura,
} from "../dados/tipos";

/**
 * BANCO LOCAL DE DEMONSTRAÇÃO.
 *
 * Existe só pra o painel funcionar sem Supabase (o projeto ainda não foi
 * criado). Guarda tudo num arquivo JSON em .gatilho-demo/banco.json, que está
 * no .gitignore. Apaga o arquivo e começa do zero.
 *
 * Onde não dá pra gravar arquivo (Vercel), fica só na memória do servidor e
 * some quando ele reinicia. Nunca é usado com Supabase configurado (lib/env.ts).
 */

export type UsuarioLocal = {
  id: string;
  email: string;
  nome: string | null;
  senhaHash: string;
  criadoEm: string;
};

export type BancoLocal = {
  segredo: string;
  usuarios: UsuarioLocal[];
  contas: (ContaInstagram & { userId: string })[];
  automacoes: (Automacao & { userId: string })[];
  comentarios: (Comentario & { userId: string; contaId: string })[];
  cliques: {
    automacaoId: string;
    userId: string;
    comentarioId: string | null;
    visitante: string;
    clicadoEm: string;
  }[];
  assinaturas: {
    userId: string;
    status: StatusAssinatura;
    trialAte: string;
    periodoAte: string | null;
  }[];
  pausas: (Pausa & { contaId: string })[];
  taxa: Record<string, { contador: number; inicio: number }>;
  /** Links de troca de senha (no lugar do e-mail, que a demonstração não manda). */
  trocasDeSenha: { codigo: string; userId: string; ate: number }[];
};

const PASTA = path.join(process.cwd(), ".gatilho-demo");
const ARQUIVO = path.join(PASTA, "banco.json");

type Memoria = { banco: BancoLocal; lidoEm: number; semDisco: boolean };
const global = globalThis as unknown as { __gatilhoBancoLocal?: Memoria };

function vazio(): BancoLocal {
  return {
    segredo: process.env.GATILHO_DEMO_SEGREDO || randomBytes(32).toString("base64url"),
    usuarios: [],
    contas: [],
    automacoes: [],
    comentarios: [],
    cliques: [],
    assinaturas: [],
    pausas: [],
    taxa: {},
    trocasDeSenha: [],
  };
}

function mtime(): number {
  try {
    return fs.statSync(ARQUIVO).mtimeMs;
  } catch {
    return 0;
  }
}

/** Lê o banco (do disco, se outro processo do Next gravou depois da gente). */
export function ler(): BancoLocal {
  const mem = global.__gatilhoBancoLocal;
  if (mem && (mem.semDisco || mtime() <= mem.lidoEm)) return mem.banco;

  let banco = vazio();
  try {
    const bruto = fs.readFileSync(ARQUIVO, "utf8");
    banco = { ...banco, ...(JSON.parse(bruto) as Partial<BancoLocal>) };
  } catch {
    // arquivo não existe ainda (primeira vez) ou quebrado: começa vazio
  }
  global.__gatilhoBancoLocal = { banco, lidoEm: mtime(), semDisco: mem?.semDisco ?? false };
  return banco;
}

/**
 * Muda o banco e grava. Tudo síncrono de propósito: no Node uma função
 * síncrona não é interrompida no meio, então duas requisições não se atropelam.
 */
export function mudar<T>(fn: (banco: BancoLocal) => T): T {
  const banco = ler();
  const resultado = fn(banco);
  const mem = global.__gatilhoBancoLocal!;
  if (!mem.semDisco) {
    try {
      fs.mkdirSync(PASTA, { recursive: true });
      const temp = `${ARQUIVO}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(banco, null, 1));
      fs.renameSync(temp, ARQUIVO);
      mem.lidoEm = mtime();
    } catch {
      mem.semDisco = true; // disco só de leitura: segue na memória
    }
  }
  return resultado;
}

export const novoId = () => randomUUID();
export const agoraIso = () => new Date().toISOString();
