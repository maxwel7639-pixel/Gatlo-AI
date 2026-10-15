import { POSTS_DEMO } from "@/lib/instagram/demo";

/**
 * Miniatura FICTÍCIA de post, desenhada aqui (SVG): o modo demonstração não
 * depende de imagem de fora nem de banco de imagens.
 */

const PALETAS = [
  ["#3b1f0e", "#c8773a", "#f6d6a8"],
  ["#0b2545", "#3a7bd5", "#cfe3ff"],
  ["#2d1b3d", "#8e5bd6", "#ead9ff"],
  ["#1d2b1f", "#5b8c4a", "#dcefc9"],
  ["#3d0f1f", "#d6456b", "#ffd5df"],
  ["#10262b", "#2fa3a3", "#c9f1ee"],
] as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Quebra o título em linhas de até ~13 letras. */
function linhas(titulo: string): string[] {
  const saida: string[] = [];
  let atual = "";
  for (const palavra of titulo.split(" ")) {
    if ((atual + " " + palavra).trim().length > 13 && atual) {
      saida.push(atual);
      atual = palavra;
    } else atual = (atual + " " + palavra).trim();
  }
  if (atual) saida.push(atual);
  return saida.slice(0, 4);
}

export async function GET(_req: Request, ctx: { params: Promise<{ n: string }> }) {
  const n = Math.max(1, Math.min(POSTS_DEMO.length, Number((await ctx.params).n) || 1));
  const post = POSTS_DEMO[n - 1];
  const [escuro, medio, claro] = PALETAS[(n - 1) % PALETAS.length];
  const texto = linhas(post.titulo);
  const reel = post.produto === "REELS";
  const inicioY = 250 - texto.length * 26;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" width="400" height="500">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${medio}"/><stop offset="1" stop-color="${escuro}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="500" fill="url(#g)"/>
  <circle cx="${330 - (n % 3) * 40}" cy="${90 + (n % 4) * 20}" r="${70 + (n % 3) * 18}" fill="${claro}" opacity="0.16"/>
  <circle cx="${60 + (n % 2) * 40}" cy="430" r="110" fill="${escuro}" opacity="0.35"/>
  <rect x="34" y="${inicioY - 46}" width="${reel ? 74 : 92}" height="26" rx="13" fill="${claro}" opacity="0.92"/>
  <text x="${reel ? 71 : 80}" y="${inicioY - 28}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="${escuro}">${reel ? "REELS" : "CAFÉ DA SERRA"}</text>
  ${texto
    .map(
      (l, i) =>
        `<text x="34" y="${inicioY + i * 52}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="800" fill="#ffffff" letter-spacing="-1">${esc(l)}</text>`,
    )
    .join("\n  ")}
  <text x="34" y="462" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="${claro}" opacity="0.85">@cafe.da.serra · demonstração</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
      // SVG servido sozinho não roda script nenhum
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
