/** Foto de perfil FICTÍCIA do modo demonstração (o "Café da Serra" não existe). */
export async function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8773a"/><stop offset="1" stop-color="#3b1f0e"/></linearGradient></defs>
  <rect width="120" height="120" fill="url(#g)"/>
  <path d="M36 52h40v18a20 20 0 0 1-20 20 20 20 0 0 1-20-20z" fill="#fff"/>
  <path d="M76 58h5a8 8 0 0 1 0 16h-6" fill="none" stroke="#fff" stroke-width="5"/>
  <path d="M48 30c-4 6 4 8 0 14M60 28c-4 6 4 8 0 14" fill="none" stroke="#f6d6a8" stroke-width="4" stroke-linecap="round"/>
</svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
      "content-security-policy": "default-src 'none'",
    },
  });
}
