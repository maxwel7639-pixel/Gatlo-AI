import type { PerfilInstagram, Post } from "./tipos";

/**
 * MODO DEMONSTRAÇÃO: um perfil e posts INVENTADOS (o "Café da Serra" não
 * existe). As miniaturas são SVG gerado aqui mesmo, em /demo/miniatura/<n>.
 * Nada disso fala com a Meta.
 */

export function perfilDemo(userId: string): PerfilInstagram {
  return {
    // id único por cadastro (a coluna é unique): dois testes não brigam
    igUserId: `demo-${userId}`,
    igAppId: null,
    username: "cafe.da.serra",
    nome: "Café da Serra",
    fotoUrl: "/demo/avatar",
    tipoConta: "BUSINESS",
    seguidores: 12840,
  };
}

/** Os temas das miniaturas (o SVG em app/demo/miniatura usa a mesma lista). */
export const POSTS_DEMO = [
  { titulo: "Bolo de cenoura da vó", tipo: "IMAGE", produto: "FEED", legenda: "O bolo de cenoura que a vó fazia aos domingos ☕ Comenta RECEITA que eu te mando o passo a passo na DM!" },
  { titulo: "Cappuccino gelado em 3 passos", tipo: "VIDEO", produto: "REELS", legenda: "Cappuccino gelado sem máquina, só com o que tu tem em casa. Comenta GELADO e recebe a receita completa 🧊" },
  { titulo: "Cardápio de inverno", tipo: "CAROUSEL_ALBUM", produto: "FEED", legenda: "Chegou o cardápio de inverno! Arrasta pro lado e comenta CARDAPIO pra receber o link com os preços." },
  { titulo: "Bastidores da torra", tipo: "VIDEO", produto: "REELS", legenda: "Como a gente torra o café aqui na serra, do grão verde até a xícara." },
  { titulo: "Kit presente", tipo: "IMAGE", produto: "FEED", legenda: "Kit presente com café, caneca e biscoito artesanal 🎁 Comenta KIT que eu te mando o link pra encomendar." },
  { titulo: "Latte art em 30 segundos", tipo: "VIDEO", produto: "REELS", legenda: "Desenhando um coração no leite em 30 segundos. Salva pra treinar depois!" },
  { titulo: "Pão de queijo + café", tipo: "IMAGE", produto: "FEED", legenda: "Combo da tarde: pão de queijo quentinho + café coado. Só hoje, das 15h às 17h." },
  { titulo: "Como escolher o grão", tipo: "CAROUSEL_ALBUM", produto: "FEED", legenda: "Arábica, robusta, torra clara ou escura? Comenta GUIA e recebe o guia completo em PDF." },
  { titulo: "Torta de limão", tipo: "IMAGE", produto: "FEED", legenda: "A torta de limão voltou! Comenta TORTA pra reservar a tua fatia pelo link." },
  { titulo: "Cliente do mês", tipo: "IMAGE", produto: "FEED", legenda: "Obrigado, Dona Lurdes, por 10 anos tomando café com a gente 💛" },
  { titulo: "Horário de feriado", tipo: "IMAGE", produto: "FEED", legenda: "Feriado: abrimos das 8h às 14h. Bom descanso pra todo mundo!" },
  { titulo: "Sorteio de aniversário", tipo: "VIDEO", produto: "REELS", legenda: "5 anos de Café da Serra! Comenta SORTEIO e recebe o link com as regras." },
] as const;

/** Número "aleatório" fixo por post, pras métricas não mudarem a cada visita. */
function semente(n: number, sal: number): number {
  const x = Math.sin(n * 9301 + sal * 49297) * 233280;
  return x - Math.floor(x);
}

export function postsDemo(): Post[] {
  const agora = Date.now();
  return POSTS_DEMO.map((p, i) => {
    const alcance = Math.round(1800 + semente(i, 1) * 14000);
    const reel = p.produto === "REELS";
    return {
      id: `demo_post_${i + 1}`,
      legenda: p.legenda,
      tipo: p.tipo,
      produto: p.produto,
      miniatura: `/demo/miniatura/${i + 1}?v=2`,
      permalink: null,
      // um post a cada ~2 dias, o mais novo primeiro
      publicadoEm: new Date(agora - (i * 2 + 0.3) * 86400_000).toISOString(),
      comentarios: Math.round(12 + semente(i, 2) * 380),
      curtidas: Math.round(alcance * (0.05 + semente(i, 3) * 0.08)),
      // o post mais antigo fica sem métricas, pra tela mostrar esse caso
      metricas:
        i === POSTS_DEMO.length - 1
          ? null
          : {
              alcance,
              visualizacoes: Math.round(alcance * (reel ? 2.4 : 1.5)),
              salvamentos: Math.round(alcance * (0.01 + semente(i, 4) * 0.04)),
              compartilhamentos: Math.round(alcance * (0.004 + semente(i, 5) * 0.02)),
            },
    };
  });
}
