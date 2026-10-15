# Gatilho · plano por fases

> O nome "Gatilho" é provisório. Pra trocar: `lib/config.ts` (`PRODUTO.nome`).

| Fase | O quê | Situação |
|---|---|---|
| **A** | Esquema do banco, cadastro/login, conectar Instagram, painel (posts, automações com prévia, números), páginas da Meta, modo demonstração | **feita** (14/10/2026) |
| **B** | Receber os comentários (webhook + consulta de reserva) e mandar as DMs com fila e pausa **por conta** | a fazer |
| **C** | Cobrança: teste de 7 dias sem cartão → no fim pausa até assinar (cartão no Mercado Pago ou Pix Automático no Asaas) | a fazer (regras já no banco) |
| **D** | Publicar: Vercel, subdomínio, Supabase de produção, revisão do app na Meta | a fazer |

---

## Fase A · o que ficou pronto

- **Banco** (`supabase/migrations/0001_esquema.sql`, ainda NÃO aplicado): `regras` (a lista única de preço, teste, carência e freios da fila), `perfis`, `assinaturas`, `pagamentos` (idempotência por gateway + id), `contas_instagram`, `tokens_instagram` (sem acesso pela API pública, token cifrado), `automacoes`, `comentarios` (a fila; `comment_id` único), `envio_pausa` (por conta), `cliques`, `limite_taxa`, `pedidos_exclusao`.
  - RLS em todas; o dono só lê o que é dele; nenhuma política `using (true)`.
  - Escrita do usuário só em `automacoes` (coluna por coluna) e no `nome` do perfil. Status de assinatura, código do link, dono da linha e token: ninguém mexe pela API.
  - Funções SECURITY DEFINER (`regra`, `assinatura_situacao`, `registrar_pagamento`, `consumir_taxa`, o gatilho do cadastro) revogadas do PUBLIC, anon e authenticated. A única liberada pro authenticated é `numeros_automacoes`, que é SECURITY INVOKER (o RLS vale).
  - O cadastro cria perfil + assinatura `trial` com `trial_ate = cadastro + teste_dias` num gatilho do banco (vale mesmo pra conta criada pela porta direta do Supabase Auth).
- **Login**: e-mail e senha (mínimo 8), recuperar senha, trava de taxa no banco (login por e-mail e por IP, cadastro e recuperação por IP), proxy do Next 16 renovando a sessão e protegendo `/painel`, cada página e ação conferindo o usuário de novo no servidor.
- **Instagram**: login oficial (`instagram.com/oauth/authorize`, state em cookie httpOnly amarrado ao usuário), troca do code, token longo (`ig_exchange_token`), renovação diária pelo cron da Vercel (`refresh_access_token`), desconectar, e os avisos da Meta (desautorizar e exclusão de dados) com o `signed_request` conferido.
- **Painel**: visão geral (perfil, dias de teste, automações ligadas, números do mês), posts (miniatura, legenda, data, comentários, curtidas e as métricas quando a Meta dá), criar/editar automação (post ou qualquer post, palavras com aviso de acento/maiúscula e teste de comentário, mensagem, link, botão, resposta pública, prévia no celular), detalhe (comentaram, receberam, fila, não entregues, cliques e a lista), conta (Instagram, assinatura, excluir conta).
- **Link curto** `/l/<codigo>?c=<comentário>`: conta o clique (sem guardar IP, sem contar robô de prévia) e redireciona.
- **Páginas**: início (o que faz, o que NÃO faz, a fila, preço), termos, privacidade, exclusão de dados (com status do pedido da Meta).
- **Modo demonstração**: sem variáveis, tudo roda local com perfil e posts inventados e o botão "Simular comentários".

### Achado na documentação da Meta (decidir)

As métricas do post (alcance, visualizações, salvamentos, compartilhamentos) exigem o escopo **`instagram_business_manage_insights`**, além dos três do produto. O código já pede esse escopo; com `INSTAGRAM_SEM_METRICAS=1` ele sai (uma permissão a menos na revisão, e a grade mostra só comentários e curtidas). `impressions` e `plays` foram aposentadas pela Meta; o código usa `reach`, `views`, `saved` e `shares`.

---

## Fase B · receber comentários e mandar as DMs (esboço)

A mesma lógica do robô do @maxwel_dev (`mxdigital-crm/supabase/functions/instagram-responde-n8n`), só que **multi-conta**: tabelas do Gatilho, token por conta, fila e pausa por conta.

### B1. Edge Function `gatilho-webhook` (pública, `verify_jwt` desligado)

- `GET`: confere `hub.verify_token` com `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` e devolve `hub.challenge`.
- `POST`: confere `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com `INSTAGRAM_APP_SECRET`, comparação em tempo constante; mesmo código do `instagram-entrada`). Responde 200 na hora e processa com `EdgeRuntime.waitUntil`.
- Para cada `entry` (`entry.id` = `contas_instagram.ig_user_id`) e cada `change` com `field = "comments"`:
  1. acha a conta (status `conectada`, `demonstracao = false`); ignora comentário da própria conta (`value.from.id == entry.id`) e resposta a comentário (`value.parent_id`);
  2. pega as automações ligadas da conta: primeiro as do post (`media_id = value.media.id`), depois as de "qualquer post";
  3. confere a palavra com **a mesma** `palavraQueBateu` de `lib/palavras.ts` (copiar o arquivo pra função; é TypeScript puro);
  4. `insert into comentarios (...) on conflict (comment_id) do nothing` com `user_id`, `conta_id`, `automacao_id`, `media_id`, autor, texto, palavra e `comentado_em`.
- Inscrever a conta no webhook no fim do callback do OAuth: `POST graph.instagram.com/me/subscribed_apps?subscribed_fields=comments` (marcado com "FASE B" em `app/api/instagram/callback/route.ts`).

**Atenção:** a Meta só manda webhook de comentários com o app em **Live** e **acesso avançado**, e só de **conta pública**. Até a revisão sair, o caminho é a **consulta de reserva** (B2b), como o robô do @maxwel_dev faz hoje.

### B2. Edge Function `gatilho-envia` (pg_cron de 3 em 3 min, cabeçalho `x-cron-chave`)

Por conta, em sequência (contas em paralelo, poucas por vez):

1. `assinatura_situacao(user_id).liberada = false` → pula (teste acabou e não assinou: **a automação pausa**, a fila fica guardada).
2. `envio_pausa.direct_ate > now()` → pula (a Meta mandou esperar).
3. Fila = `comentarios` da conta com `dm_em is null and dm_erro is null and recebido_em > now() - fila_janela_dias`, por `recebido_em`, no máximo `envio_max_por_rodada`.
4. Para cada um (com `envio_intervalo_segundos` entre um e outro):
   - lê e decifra o token (abaixo);
   - manda a **resposta privada** `POST graph.instagram.com/v23.0/<ig_user_id>/messages` com `recipient: { comment_id }` e o modelo de botão:
     ```json
     { "recipient": { "comment_id": "<id>" },
       "message": { "attachment": { "type": "template", "payload": {
         "template_type": "button", "text": "<mensagem_dm>",
         "buttons": [{ "type": "web_url", "url": "<SITE>/l/<codigo>?c=<comentarios.id>", "title": "<link_titulo>" }] } } } }
     ```
     A documentação da Meta mostra a resposta privada só com texto. Se a Meta recusar o modelo de botão (erro que não é de limite), manda de novo como texto: `"<mensagem_dm>\n\n<link curto>"`. Testar isso primeiro com uma conta testadora.
   - erro de **limite** (`ehLimite()` do robô: códigos 4, 17, 32, 613, 80002 ou "limit how often") → `envio_pausa.direct_ate = now() + envio_pausa_direct_min`, **não** marca erro, para a conta (a pessoa segue na fila);
   - outro erro → `dm_erro` (e `dm_tentativas + 1`);
   - deu certo → `dm_em`, `igsid = recipient_id`;
   - resposta pública (se a automação tiver e a DM saiu): só se `resposta_ate` não estiver no futuro e a conta tiver menos de `respostas_publicas_max_24h` respostas nas últimas 24 h. `POST /<comment_id>/replies` com `message`. Limite → `resposta_ate = now() + envio_pausa_resposta_min`.
5. Avisar o cliente da pausa (fase B pode mostrar só no painel, que já lê `envio_pausa`; e-mail depois).

**B2b. Consulta de reserva** (enquanto não há webhook): na mesma rodada, pra contas com automação ligada, ler `GET /me/media` (só posts dos últimos 7 dias ou com automação específica) e `GET /<media>/comments?fields=id,text,username,timestamp,from{id,username},replies{id}`; mesmo filtro e mesmo insert com `on conflict do nothing`. A Meta limita ~200 chamadas por hora por conta: no máximo 1 leitura por post a cada rodada.

**Token na Edge Function (Deno):**
```ts
// formato "v1.<iv>.<cifra+tag>" (lib/cripto.ts); a mesma GATILHO_CHAVE_TOKENS como secret
const [, iv, corpo] = token_cifrado.split(".");
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const chave = await crypto.subtle.importKey("raw", b64(Deno.env.get("GATILHO_CHAVE_TOKENS")!), "AES-GCM", false, ["decrypt"]);
const token = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(iv) }, chave, b64(corpo)));
```
(Testado em Node com WebCrypto: o formato decifra sem conversão.)

**Agendador:** `pg_cron` + `pg_net` chamando a função com a chave guardada no Vault (`vault.decrypted_secrets`), nunca escrita no SQL.

### B3. Limpeza (prometida na política de privacidade)

Cron diário: apagar `comentarios` e `cliques` com mais de 90 dias; apagar `limite_taxa` velho.

### B4. Testes da fase B

Conta testadora no app da Meta → automação real → comentar de outra conta → conferir DM, botão, clique contado, resposta pública, e forçar o limite (várias contas comentando) pra ver a pausa.

---

## Fase C · cobrança

Já está no banco: `regras.preco_mensal_centavos = 9790`, `teste_dias = 7`, `carencia_dias = 3`, `assinatura_situacao()` (quem decide se o robô roda) e `registrar_pagamento()` (idempotente, confere o valor contra a tabela `regras`, empurra o período em 1 mês).

1. **Teste de 7 dias sem cartão**: já funciona (gatilho do cadastro). No fim, `liberada = false` e o robô (fase B) não manda nada. O painel já mostra "teste acabou".
2. **Cartão (Mercado Pago, assinatura `preapproval`)**: copiar `lib/mercadopago.ts`, `lib/mp-assinatura.ts` e o padrão de `app/api/mercadopago-webhook` do Fisga. O cliente escolhe "assinar"; o **servidor** decide o preço lendo `regras`. O webhook nunca confia no corpo: consulta o pagamento na API do MP e chama `registrar_pagamento('mercadopago', <payment id>, <user>, <valor pago em centavos>, <preapproval id>)`.
3. **Pix Automático (Asaas)**: criar cliente + autorização de Pix Automático pela API do Asaas; webhook (token no cabeçalho `asaas-access-token`) → consultar a cobrança na API do Asaas → `registrar_pagamento('asaas', ...)`.
4. **Cancelar**: função nova `marcar_assinatura(user, status)` (SECURITY DEFINER, revogada do anon/authenticated) chamada pelos webhooks de cancelamento; botão "cancelar" no painel cancela no gateway (o status só muda quando o gateway confirma).
5. Botões em `/painel/conta` (hoje com o aviso "chega na próxima etapa").

---

## Fase D · publicar

1. Supabase de produção (região São Paulo) com a migration aplicada e a conferência do fim do arquivo rodada.
2. Vercel: projeto novo apontando pro repositório, variáveis do `.env.example`, `CRON_SECRET` (o cron diário de renovação já está no `vercel.json`).
3. Subdomínio (ex.: `gatilho.mxdigital.ia.br`) com CNAME pra Vercel e `NEXT_PUBLIC_SITE_URL` igual.
4. App da Meta em Live e **revisão do app**: acesso avançado em `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` (e `instagram_business_manage_insights`, se ficar com as métricas). Pede verificação da empresa (CNPJ) e um vídeo mostrando o fluxo inteiro funcionando (conectar, criar automação, comentar, receber a DM).
5. Até a revisão sair: cada cliente entra como **testador** do app (convite que ele aceita no Instagram), como no plano do produto.

---

## O que o MAXWEL precisa fazer / fornecer

1. **Decidir**: nome definitivo (troca em `lib/config.ts`), e-mail de suporte, e se mantém o escopo de métricas na revisão.
2. **Supabase**: criar um projeto NOVO (não o do CRM), aplicar `supabase/migrations/0001_esquema.sql`, e me passar URL, anon key e service role (pela Vercel, não por chat). No Auth: senha mínima 8, proteção de senha vazada ligada, confirmação de e-mail ligada, Site URL = o subdomínio, e os modelos de e-mail apontando pra `/auth/confirmar` (veja o README).
3. **App da Meta**: criar app (tipo Empresa) → produto Instagram → "API setup with Instagram login":
   - copiar **Instagram app ID** e **Instagram app secret**;
   - em "Business login settings": redirect `https://<subdominio>/api/instagram/callback`, deauthorize `https://<subdominio>/api/instagram/desautorizar`, data deletion `https://<subdominio>/api/instagram/exclusao`;
   - em Configurações básicas: política de privacidade `https://<subdominio>/privacidade`, termos `https://<subdominio>/termos`, exclusão de dados `https://<subdominio>/exclusao-de-dados`;
   - adicionar o @maxwel_dev (e os primeiros clientes) como **testadores do Instagram**;
   - iniciar a verificação da empresa (CNPJ) no Business Manager.
4. **Subdomínio** no DNS (CNAME pra Vercel).
5. **Asaas**: conta, chave de API (sandbox e produção) e Pix Automático habilitado.
6. **Mercado Pago**: credenciais de produção (de preferência uma aplicação só do Gatilho) e a assinatura secreta do webhook.
7. **Gerar** `GATILHO_CHAVE_TOKENS` e `CRON_SECRET` (comandos no `.env.example`) direto na Vercel.
