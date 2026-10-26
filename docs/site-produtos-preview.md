# Prévia do site · 26/10/2026

Autorizado: páginas de produto/uso, efeitos e preview Vercel. Planos por último; produção somente depois da revisão do Maxwel.

Direção: editorial e demonstrativa, com a conversa como elemento principal. Figtree existente; fundo #e7e9ee, papel #f8f9fb, tinta #0b1020, azul Gatlo #1e50f0 e verde #d6f5df. Títulos grandes, conteúdo alinhado à esquerda e áreas de respiro. O azul marca a automação; o verde, a ação da pessoa. Não introduzir o rosa sugerido automaticamente pela pesquisa da skill, pois não corresponde à marca.

Principal: preservar título, conteúdo, faixas, limites, preço e rodapé da produção como base. Hero com foto própria de outro criador e os balões animados; história com números atrás do celular; antes/depois ampliado; exemplos e FAQ. O antes/depois fica exclusivamente na principal, conforme confirmação do Maxwel.

Instagram: página própria acessada em Produto → Instagram. Hero tipográfico amplo sem o celular da principal; foto de uma criadora com recuo, parallax e checklist conforme o scroll; introdução; capítulos de recursos com mockup maior; painel lateral de exemplos com reprodução, pausa e seleção; usos, três passos, FAQ e convite. A foto é diferente da principal. As duas imagens são ilustrações originais geradas por IA, exportadas em WebP (~130 KB cada), e não são depoimentos ou clientes reais.

Rotas: /produto/instagram, /solucoes/materiais-gratuitos, /solucoes/catalogo e /solucoes/agendamentos. Canais ainda não implementados não são oferecidos como produtos. Preço existente e cobrança permanecem para uma tarefa posterior.

Reusar cabeçalho, antes/depois, faixas e tema. Criar um modelo de página para os três usos, uma conversa demonstrativa compartilhada e conteúdo tipado. A navegação deve levar a páginas reais. As imagens e mensagens são próprias; exemplos não enviam mensagens.

Verificar: build, lint, tipos; caminhos e CTAs; exemplos por clique e teclado; scroll reversível; 390/768/1440 px; redução de movimento. Depois: PR sem merge e preview Vercel.

Verificação realizada: `npm run build` (inclui TypeScript) e `npm run lint` passaram. Playwright conferiu as cinco rotas em 1920/1440/768/390/360 px: HTTP 200, um h1 por página e nenhum overflow horizontal; menus desktop/mobile; três casos e quatro etapas; reinício; abas por teclado; FAQ; scroll reversível; redução de movimento e rota inválida 404. Nenhum `pageerror`. A revisão adicional conferiu balões sem espaços excessivos, ausência do antes/depois no Instagram, ampliação dos cartões da principal, recuo real da foto, seleção lateral por teclado e resposta na conversa. Scripts e capturas estão em `C:\Maxwel\gatlo-pesquisa-manychat-2026-10-26\previa-revisao-hero`.
