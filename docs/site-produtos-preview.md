# Prévia do site · 26/10/2026

Autorizado: páginas de produto/uso, efeitos e preview Vercel. Planos por último; produção somente depois da revisão do Maxwel.

Direção: editorial e demonstrativa, com a conversa como elemento principal. Figtree existente; fundo #e7e9ee, papel #f8f9fb, tinta #0b1020, azul Gatlo #1e50f0 e verde #d6f5df. Títulos grandes, conteúdo alinhado à esquerda e áreas de respiro. O azul marca a automação; o verde, a ação da pessoa. Não introduzir o rosa sugerido automaticamente pela pesquisa da skill, pois não corresponde à marca.

Estrutura: hero → história → exemplos selecionáveis → casos de uso → configuração em três passos → perguntas → convite. O celular conecta as etapas; não colocar animação diferente em cada cartão.

Rotas: /produto/instagram, /solucoes/materiais-gratuitos, /solucoes/catalogo e /solucoes/agendamentos. Canais ainda não implementados não são oferecidos como produtos. Preço existente e cobrança permanecem para uma tarefa posterior.

Reusar cabeçalho, antes/depois, faixas e tema. Criar um modelo de página para os três usos, uma conversa demonstrativa compartilhada e conteúdo tipado. A navegação deve levar a páginas reais. As imagens e mensagens são próprias; exemplos não enviam mensagens.

Verificar: build, lint, tipos; caminhos e CTAs; exemplos por clique e teclado; scroll reversível; 390/768/1440 px; redução de movimento. Depois: PR sem merge e preview Vercel.

Verificação realizada: `npm run build` (inclui TypeScript) e `npm run lint` passaram. Playwright conferiu as cinco rotas em 1440/768/390 px: HTTP 200, um h1 por página e nenhum overflow horizontal; menus desktop/mobile; três casos e quatro etapas; reinício; abas por teclado; FAQ; scroll reversível; redução de movimento e rota inválida 404. Nenhum `pageerror`. Scripts e capturas estão em `C:\Maxwel\gatlo-pesquisa-manychat-2026-10-26\previa-verificacao`.
