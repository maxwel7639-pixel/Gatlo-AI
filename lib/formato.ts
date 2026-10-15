/** Formatação em português, num lugar só. */

const FUSO = "America/Sao_Paulo";

export function numero(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  if (n >= 10_000) {
    return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return n.toLocaleString("pt-BR");
}

export function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: FUSO }).replace(".", "");
}

export function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO,
  });
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias" */
export function haQuanto(iso: string, agora = Date.now()): string {
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** Primeiro dia do mês corrente (horário de Brasília), em ISO. */
export function inicioDoMes(agora = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit" }).format(agora);
  // 00:00 em Brasília = 03:00 UTC
  return new Date(`${partes}-01T03:00:00.000Z`).toISOString();
}

export function nomeDoMes(agora = new Date()): string {
  return agora.toLocaleDateString("pt-BR", { month: "long", timeZone: FUSO });
}

export function plural(n: number, um: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? um : varios}`;
}

/** Legenda num pedaço só: primeira linha, até N caracteres. */
export function legendaCurta(texto: string, max = 90): string {
  const linha = texto.split("\n")[0].trim();
  return linha.length > max ? `${linha.slice(0, max - 1).trimEnd()}…` : linha || "Sem legenda";
}

/** A data ainda não chegou? (pausa da Meta, prazo do teste…) */
export function noFuturo(iso: string | null | undefined): iso is string {
  return Boolean(iso && Date.parse(iso) > Date.now());
}
