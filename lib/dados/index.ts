import "server-only";
import { faltaConfigurarBanco, usaSupabase, AVISO_SEM_CONFIGURACAO } from "../env";
import { repositorioSupabase } from "./supabase";
import { repositorioLocal } from "./local";
import type { Repositorio } from "./repositorio";

/** O banco certo pro modo em que o app está (lib/env.ts). */
export function repo(): Repositorio {
  if (faltaConfigurarBanco) throw new Error(AVISO_SEM_CONFIGURACAO);
  return usaSupabase ? repositorioSupabase : repositorioLocal;
}

export type { Repositorio } from "./repositorio";
