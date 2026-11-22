# Gatlo AI · mapa do código

Base: `main` em 442906b (19/11/2026). Next.js 16 + Supabase. Referências `arquivo:linha`.
Marcação das regras: **[visto]** = confirmado no código; **[inferido]** = deduzido, não está escrito.

## 1. O que cada parte faz

- `app/(conta)/` e `lib/auth/`: cadastro, login, recuperar senha. `proxy.ts` renova a sessão e protege `/painel`.
- `app/painel/`: posts, automações (criar, editar, detalhe), conta/assinatura. Lê o banco com a sessão do usuário (`lib/dados/supabase.ts:11`).
- `app/api/instagram/`: OAuth (`conectar`, `callback`), `desautorizar` e `exclusao` (avisos da Meta).
- `app/api/cron/renovar-tokens` (Vercel, 1x/dia, `vercel.json`): renova token longo e reinscreve as contas no webhook.
- `app/api/mercadopago-webhook`, `asaas-webhook`: cobrança; `lib/mp-*.ts`, `lib/asaas*.ts`, `lib/cancelar*.ts`, `lib/registrar-pagamento.ts`.
- `app/l/[codigo]/route.ts`: link curto da DM; conta o clique e redireciona (302).
- `lib/instagram/meta.ts`: cliente Graph do servidor Next. `moderacao.ts`: botões manuais da tela "Comentários do post" (comentar, responder, DM, ocultar, apagar), não roda sozinho.
- `lib/palavras.ts`: casamento de palavra-chave (cópia idêntica em `supabase/functions/_shared/palavras.ts`; teste falha se divergir).
- `lib/regras.ts`, `lib/config.ts`, `lib/env.ts`: leitura da tabela `regras`, nome do produto, modo demonstração (`lib/instagram/demo.ts`, `lib/local/`, `lib/dados/simulacao.ts`).
- `components/`: `landing/` e `marketing/` (site público), `painel/` (telas), `ui.tsx`, `previa-celular.tsx`.
- `supabase/functions/gatilho-webhook`: recebe comentário da Meta e põe na fila.
- `supabase/functions/gatilho-envia`: a cada 3 min lê comentários (reserva), monta a fila e manda DM + resposta pública.
- `supabase/functions/_shared/comentario.ts`: filtro e insert comuns às duas portas de entrada.
- `supabase/migrations/0001..0008`: esquema, reserva, regras, limpeza, cobrança, Pix, cancelar. `supabase/agendador.sql`: pg_cron + pg_net (aplicado à mão, fora das migrations).
- `docs/PLANO.md` (fases A-D), `docs/REVISAO-META.md` (reenvio à Meta), `docs/agentes/` (papéis dos agentes).

## 2. Fluxo do comentário até a DM

1. **Conexão**: `callback/route.ts:46-62` guarda token cifrado e inscreve a conta (`/me/subscribed_apps`, só `comments`, `lib/instagram/meta.ts:162`).
2. **Webhook** (`gatilho-webhook/manipulador.ts`): GET confere `hub.verify_token` (:52-66); POST lê corpo cru até 1 MB, confere HMAC `X-Hub-Signature-256` (:80), responde 200 na hora e processa depois (:93-105).
3. **Triagem** (`processar.ts:56-125`): só `field = "comments"`; conta `conectada` e `demonstracao = false`; ignora comentário da própria conta e resposta (`_shared/comentario.ts:34`); escolhe automação (do post antes de "qualquer post", mais antiga primeiro, `:39-51`); `insert ... on conflict (comment_id) do nothing` (`:84-95`).
4. **Reserva do webhook** (sem webhook Live/acesso avançado): `gatilho-envia/consulta.ts` lê `/me/media` e `/<post>/comments` e insere na MESMA fila. Máx. 5 posts por rodada em rodízio (`0003`), pula comentário já respondido pela conta (:64-66) e automação criada depois do comentário (:113-114).
5. **Agendador**: `agendador.sql:63-77` chama `gatilho-envia` a cada 3 min com `x-cron-chave` lida do Vault; a função confere a chave em tempo constante (`manipulador.ts:47-55`).
6. **Rodada** (`rodada.ts:178-415`), por conta (3 em paralelo, orçamento de 100 s, ordem embaralhada): assinatura liberada? (:245) → pausa de DM vencida? (:251) → token (decifra, pula se vencido, :260-271) → leitura de reserva → fila (`dm_em` e `dm_erro` nulos, dentro de `fila_janela_dias`, máx. `envio_max_por_rodada`, sem reserva em voo; automação desligada fica guardada) → para cada item: intervalo de `envio_intervalo_segundos` (:345), reserva atômica (:356), `enviarBotao` (template button com link `/l/<codigo>?c=<id>`), se a Meta recusar (4xx, não limite) manda texto + link (:370, `meta.ts:44`).
7. **Resultado**: ok grava `dm_em` e `igsid` (:390); erro de limite devolve a reserva, grava `envio_pausa.direct_ate` e para a conta (:376-383); outro erro grava `dm_erro` (:384). Resposta pública só se a DM saiu, sem pausa de resposta e abaixo de `respostas_publicas_max_24h` (:394-396); limite nela só pausa as respostas (:405-409).
8. **Clique** (`l/[codigo]/route.ts`): ignora robô de prévia (:53), no máx. 3 cliques/10 min por visitante (:57), grava `cliques` sem IP, redireciona sempre, mesmo com a automação pausada.
9. **Limpeza**: `limpar_dados_antigos()` diária apaga comentários/cliques com mais de 90 dias (`0004:42-63`).

## 3. Tabelas principais (quem escreve / quem lê)

| Tabela | Escreve | Lê |
|---|---|---|
| `regras` (preço, teste, freios) | só manualmente (service role) | funções SQL, `gatilho-envia`, `lib/regras.ts` |
| `perfis` | trigger de cadastro; usuário só `nome` | dono |
| `assinaturas` | trigger de cadastro; funções SQL de cobrança (`registrar_pagamento`, `marcar_assinatura`, `guardar_*`) | dono; `assinatura_situacao()` |
| `pagamentos` | `registrar_pagamento`/`estornar_pagamento` (webhooks MP/Asaas) | dono |
| `contas_instagram` | servidor no callback; cron de renovação | dono; `gatilho-*` (service role) |
| `tokens_instagram` | servidor (cifrado, AES-GCM) | só service role (sem política) |
| `automacoes` | usuário (insert/update coluna a coluna, delete) | dono; `gatilho-*`; `/l/` |
| `comentarios` (a fila) | `gatilho-webhook` e `gatilho-envia` (service role) | dono; `gatilho-envia` |
| `envio_pausa` | `gatilho-envia` | dono; `gatilho-envia` |
| `cliques` | `/l/<codigo>` (servidor) | dono; `numeros_automacoes()` |
| `limite_taxa` | `consumir_taxa()` (login, cadastro, cliques) | só funções |
| `pedidos_exclusao` | servidor (aviso de exclusão da Meta) | página `/exclusao-de-dados` |

## 4. Regras que nunca podem quebrar

1. **Webhook só age depois de assinatura válida** (HMAC do corpo cru, tempo constante); sem segredo configurado = 503. **[visto]** `gatilho-webhook/manipulador.ts:70-82`; `gatilho-envia` idem com `x-cron-chave` (`:47-55`).
2. **Um comentário nunca vira dois**: `comment_id` unique + `on conflict do nothing`. **[visto]** `0001:441`, `_shared/comentario.ts:89`.
3. **Uma DM por comentário**: reserva atômica (`dm_tentativas`, `dm_reservado_em`) antes de chamar a Meta; reserva presa só é refeita uma vez, depois vira `dm_erro`. **[visto]** `banco_supabase.ts:176-188`, `rodada.ts:337,356`, `0002`.
4. **Rede/timeout/5xx nunca reenvia como texto**: só recusa 4xx que não seja limite cai no texto (senão poderia sair DM dupla). **[visto]** `meta.ts:44-46`.
5. **Pausa por conta, não global**: limite da Meta (códigos 4, 17, 32, 613, 80002, HTTP 429, textos "limit how often" etc.) para só aquela conta por `envio_pausa_direct_min` (180) e devolve o comentário à fila sem marcar erro. Respostas públicas têm pausa própria (45 min) e teto de 200/24 h. **[visto]** `meta.ts:26-31`, `rodada.ts:376-383,394-409`, `0001:51-55`.
6. **Janela de resposta privada da Meta = 7 dias**; a fila usa 6 (1 dia de folga) e o código recusa regra de fila >= janela. **[visto]** `0001:56-57`, `banco_supabase.ts:71`. A "janela de 24h" do DM comum não aparece no código: só existe resposta privada ao comentário (1 por comentário, regra da Meta citada em `0002:18`) **[inferido]** que a Meta aplica o resto.
7. **Números de freio vêm da tabela `regras`, com piso e teto** (ex.: máx. 30 DMs/rodada, 1-60 s de intervalo); regra ausente ou fora do limite faz a rodada ERRAR, nunca usa valor inventado. **[visto]** `banco_supabase.ts:29-37,61-78`, `0001:61-76`.
8. **Teste de 7 dias sem cartão; depois a automação pausa e a fila fica guardada**. `assinatura_situacao().liberada` é o único juiz (teste vigente, ou `ativa` até `periodo_ate` + 3 dias de carência; `cancelada` até o fim do período pago, sem carência). **[visto]** `0001:173-235`, `rodada.ts:245`, `0007` (redefine a função), `PLANO.md` C3.
9. **Cobrança**: o corpo do webhook nunca é fonte de verdade (consulta a API do gateway); pagamento idempotente por `(gateway, id)`; valor abaixo do preço (ou do preço travado da assinatura) não libera. **[visto]** `0001:157,264`, `mercadopago-webhook/route.ts:12-15`, `0005`/`0008` (via PLANO.md C1-C3).
10. **RLS em toda tabela, dono só lê o que é dele**; anon sem nada; escrita do usuário só em `automacoes` (colunas listadas) e `perfis.nome`; funções SECURITY DEFINER revogadas de anon/authenticated; `tokens_instagram` sem política. **[visto]** `0001:1-19,99-114,346-403,326-340`.
11. **Token do Instagram sempre cifrado** (`GATILHO_CHAVE_TOKENS`); nunca em log; token vencido pula a conta sem marcar erro. **[visto]** `rodada.ts:260-271`, `0001:328-335`.
12. **Contas de demonstração e desconectadas nunca entram na rodada**. **[visto]** `banco_supabase.ts:86-87`, `processar.ts` (`acharContaConectada`).
13. **Comentário da própria conta e respostas a comentários nunca disparam** (evita laço). **[visto]** `_shared/comentario.ts:34-36`.
14. **Palavra inteira, sem acento/maiúscula**; mesma função na prévia do painel e no robô. **[visto]** `lib/palavras.ts:31-47`.
15. **Limites de conteúdo**: mensagem 640, título do botão 20, 10 palavras, 50 automações por cadastro. **[visto]** `0001:359-364,417`, `automacao-validar.ts:8-16`.
16. **Link curto sempre redireciona** (quem recebeu a DM não cai em link quebrado), sem guardar IP, só http/https. **[visto]** `l/[codigo]/route.ts:7-17,43-50`.
17. **Dados com prazo**: comentários e cliques apagados em 90 dias (promessa da política de privacidade); prazo > janela da fila. **[visto]** `0004:42-49`.
18. **Excluir conta cancela a cobrança no gateway antes; se falhar, não apaga**. **[visto]** `PLANO.md` C3 (`lib/cancelar-servidor.ts`, não relido linha a linha).
19. **Edge Functions rodam com service role (passam por cima do RLS)**: todo filtro por conta/usuário tem de ser escrito à mão. **[visto]** `banco_supabase.ts:41-45`.
20. **Cota de leitura da Meta (~200 chamadas/h/conta)**: reserva faz no máx. 1+5 leituras por rodada. **[visto]** `0003:9-17`.

## 5. Onde cada novidade encaixa

Estado de produção (consultado em 19/11/2026 pelo Supabase `mkhfikiniyiowxohznzc`, só leitura): `gatilho-webhook` e `gatilho-envia` estão **ACTIVE** (v5), migrations 0001-0004 e 0006-0008 aplicadas (a lista não mostra `0005_cobranca`; conferir, a 0008 redefine `registrar_pagamento`). O pg_cron (`agendador.sql`) **não foi verificado**; `REVISAO-META.md:58-68` mostra o checklist da Meta (app Live, webhook) ainda desmarcado, então o webhook real pode não estar chegando e a leitura de reserva é o caminho provável.

| Novidade | Estado hoje | Onde encaixa / reaproveita |
|---|---|---|
| Fluxo de vários passos | não existe | Nova tabela de fluxos/passos + estado por conversa (chave `igsid`, já gravado em `comentarios.igsid`). Passo 1 = o envio atual (`rodada.ts`); passos seguintes precisam receber a resposta da pessoa (webhook `messages`). Reusa: `Meta.enviarTexto/Botao`, pausa por conta, reserva atômica, `regras`. |
| Gatilho por palavra no DM | não existe | `gatilho-webhook` só trata `field = "comments"` (`processar.ts:71`) e a inscrição pede só `comments` (`lib/instagram/meta.ts:162`). Falta inscrever `messages`, ramo novo em `processar.ts`, e permissão `instagram_business_manage_messages` (já pedida). Reusa `palavraQueBateu` e `escolherAutomacao`. Atenção: DM comum segue regra de janela de 24h da Meta, diferente da resposta privada [inferido]. |
| Resposta a story | não existe | Mesmo webhook `messages` (evento com `reply_to.story`); entra como outro tipo de gatilho na automação. Sem código hoje. |
| Captura de lead | parcial | Hoje só `comentarios` (autor, texto, `igsid`) e `cliques`. Falta tabela de leads (dono por RLS, prazo de limpeza em `regras`) e coletar campos no fluxo. Política de privacidade precisa cobrir. |
| Webhook de saída | não existe | Novo envio assinado (HMAC) a partir de `gatilho-envia` após `marcarDmOk`, com fila/tentativas próprias (reusar o padrão de reserva). Valida URL (só https) como `siteUrlValida` em `gatilho-envia/manipulador.ts:35`. |
| Reaproveitável pronto | ligado em produção (ver acima) | `gatilho-webhook` (porta de entrada, assinatura, 200 imediato), `gatilho-envia` (rodada, fila, freios, pausa), `_shared/comentario.ts`, `meta.ts` (botão/texto/resposta), `regras` com limites, `numeros_automacoes`, cobrança (`assinatura_situacao`). |
