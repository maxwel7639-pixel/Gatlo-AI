# Gatlo AI · plano por fases

> Nome do produto: **Gatlo AI** (`lib/config.ts`, `PRODUTO.nome`). Repositório: github.com/maxwel7639-pixel/Gatlo-AI. As variáveis internas seguem com o prefixo `GATILHO_` (ninguém vê).

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
  - Testado num Postgres local (PGlite) imitando os papéis do Supabase: a migration aplica inteira; um usuário logado não cria automação na conta de outro, não muda código/dono, não lê token nem regras, não edita assinatura, não chama as funções do servidor; o anon não lê nada; a 51ª automação é barrada; teste vencido vira `liberada = false`; o mesmo pagamento não credita duas vezes e valor abaixo do preço não libera.
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

A mesma lógica do robô do @maxwel_dev (`mxdigital-crm/supabase/functions/instagram-responde-n8n`), só que **multi-conta**: tabelas do Gatlo AI, token por conta, fila e pausa por conta.

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

### Decisões do C1 (cartão), 18/10/2026

- **Preço travado por assinatura.** O preapproval do MP cobra todo mês o valor fixado na hora da assinatura. Quando o checkout nasce, `guardar_preapproval` grava o id e o preço da época em `assinaturas`; `registrar_pagamento` (migration 0005) aceita pagamento >= o MENOR entre `regras.preco_mensal_centavos` e esse valor guardado (só se o preapproval do pagamento for o guardado). Reajuste de preço vale só para assinatura nova; quem já assinou segue pagando o valor da época, sem cair em `valor_divergente`. Sem valor guardado, vale o preço atual. Um link de checkout ainda pendente também guarda o preço do dia em que nasceu.
- **Alerta, não silêncio.** `registrar_pagamento` devolve texto (`liberado`, `repetido`, `valor_divergente`, `sem_usuario`). Os dois últimos são dinheiro cobrado sem liberar nada e o MP não reenvia (a rota responde 200): saem em `console.error` com `ALERTA valor_divergente` ou `ALERTA cobranca_orfa`, no log da Vercel. **Pendência de produção:** ligar um aviso de verdade (e-mail ou WhatsApp para o Maxwel) a esses dois alertas, ou olhar o log todo dia até lá.
- **Conta excluída com cobrança viva.** Excluir a conta ainda NÃO cancela o preapproval no MP (cancelar é o C3). O webhook já não entra em 500 eterno: o pagamento é guardado sem dono (`pagamentos.user_id` nulo), o alerta `cobranca_orfa` sai uma vez e a rota responde 200. **Bloqueia produção real:** o C3 tem que cancelar o preapproval no MP antes de `deleteUser`.
- **Nunca dois preapprovals vivos.** Antes de abrir outro checkout, `lib/mp-checkout.ts` consulta o MP: autorizado ou pausado recusa; pendente devolve o mesmo link; cancelado deixa criar outro (a chave de idempotência inclui o id anterior). Sem conseguir consultar o MP, não cria (falha fechada).
- **Estorno e chargeback (C3).** O C1 só confere `currency_id = BRL` e `transaction_amount_refunded = 0` antes de creditar. Revogar o período de quem pediu estorno ou chargeback depois de pago (a tabela já tem o status `estornado`) é do C3, junto com `marcar_assinatura`.
- **Cancelar (C3).** A tela diz onde cancelar ("direto no Mercado Pago, em Assinaturas"). O webhook ainda ignora o aviso de `preapproval` cancelado: o banco segue `ativa` até o período e a carência acabarem. Botão e tratamento do cancelamento: C3.
- **Endereço da API.** O preapproval é criado em `POST /preapproval` (como no Fisga em produção); o rascunho usava `/v1/payments/preapproval`, que não existe no MP.

### Decisões do C2 (Pix Automático, Asaas), 18/10/2026

Fontes lidas em docs.asaas.com (18/10/2026): `/docs/pix-automatico`, `/docs/pix-automatico-implementacao`, `/docs/fluxos-de-webhook`, `/docs/eventos-para-pix-autom%C3%A1tico`, `/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook`, `/docs/autenticação-1`, `/reference/criar-uma-autorizacao-pix-automatico`, `/reference/recuperar-uma-unica-autorizacao-pix-automatico`, `/reference/recuperar-uma-unica-cobranca`, `/reference/criar-novo-cliente`, `/reference/recuperar-um-unico-cliente`.

- **Fluxo (jornada 3, modo `SUBSCRIPTION`).** O servidor cria o cliente (`POST /v3/customers`, com `externalReference = assinatura|<user id>`) e a autorização (`POST /v3/pix/automatic/authorizations`, mensal, `value` = preço de `regras`, QR Code imediato do 1º pagamento com o mesmo preço). O usuário paga o QR no app do banco, o que também autoriza o débito dos meses seguintes; o Asaas gera as cobranças mensais sozinho. A tela mostra o QR e o copia e cola; cancelar é no app do banco.
- **Quem credita é a cobrança paga**, não o aviso de autorização: `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` (os dois podem chegar para a mesma cobrança; o `registrar_pagamento` barra o repetido pelo id dela). Os eventos `PIX_AUTOMATIC_RECURRING_*` são ignorados por enquanto (tratar autorização cancelada e instrução recusada é C3).
- **Webhook.** Token no cabeçalho `asaas-access-token`, conferido em tempo constante (SHA-256 dos dois, comparação sem sair no 1º byte) antes de qualquer efeito; sem `ASAAS_WEBHOOK_TOKEN` configurado = 401 para tudo. Depois consulta a cobrança (`GET /v3/payments/{id}`: precisa estar `RECEIVED`/`CONFIRMED`, `PIX`, sem devolução), o cliente (dono, pela referência que nós gravamos) e a autorização guardada (`GET /v3/pix/automatic/authorizations/{id}`). Não existe no Asaas um campo da cobrança que diga "veio da autorização X" documentado; a amarra é: o `customerId` da autorização guardada tem que ser o cliente que pagou e, nas cobranças mensais, a `subscription` da cobrança tem que ser a `subscriptionId` da autorização. Se não bater (ou a guardada não existir), o `registrar_pagamento` recebe `null` e guarda o pagamento como `preapproval_divergente` com ALERTA, sem liberar. 404 do Asaas ao consultar vira "ignorado" (200) para não travar a fila (o Asaas pausa a fila depois de 15 falhas seguidas); falha de rede ou do banco vira 500 e ele reenvia.
- **Preço travado** igual ao cartão: `guardar_autorizacao_asaas` (migration 0006) grava cliente, autorização e o preço da época; o `registrar_pagamento` da 0005 serve sem mudar (compara `gateway` e id).
- **Nunca duas cobranças vivas, nem entre os gateways.** O Pix recusa se há cartão do MP não cancelado; o cartão recusa se há Pix `CREATED` ou `ACTIVE`; 2º clique com Pix `CREATED` devolve o mesmo QR. Trocar de um para o outro exige concluir ou cancelar o primeiro (cancelar o preapproval pendente pelo app é C3).
- **CPF/CNPJ.** O Asaas exige `cpfCnpj` para criar o cliente. O formulário pede, o servidor valida os dígitos e manda ao Asaas; **não é guardado** (a política de privacidade diz isso).
- **Ambiente.** `ASAAS_AMBIENTE=producao` aponta para `api.asaas.com`; qualquer outro valor (inclusive vazio) fica no sandbox. Sem rede real em nenhum teste.
- **Não verificável sem o Asaas real (precisa de OK do Maxwel):** o formato exato dos campos que usamos da cobrança e do cliente (lidos da referência, não de resposta real), se o `payload`/`encodedImage` vêm na resposta da criação e na consulta com a autorização `CREATED`, se a cobrança do 1º pagamento (QR imediato) chega com `PAYMENT_RECEIVED` e traz `customer`, se a cobrança mensal traz `subscription` igual à `subscriptionId` da autorização, e a elegibilidade da conta ao Pix Automático.

### Decisões do C3 (cancelar e estornar), 20/10/2026

- **O status só muda por aviso do gateway, conferido na API.** O botão "Cancelar assinatura" (`cancelarAssinatura` em `lib/acoes.ts`, miolo em `lib/cancelar.ts`) só pede o cancelamento ao gateway: MP `PUT /preapproval/{id}` com `cancelled`; Asaas `DELETE /pix/automatic/authorizations/{id}` e `DELETE /subscriptions/{id}` (cancelar a autorização não garante que o Asaas pare de gerar a cobrança mensal; a referência não diz). O id cancelado é o guardado no banco, nunca o do navegador, e o clique **não grava nada**. Quem muda o banco é o webhook: `preapproval` (MP) ou `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED/REFUSED` (Asaas) → o corpo vale só como pista de id → consulta a API → só se ela diz `cancelled` / `CANCELLED` ou `REFUSED` → `marcar_assinatura`.
- **`marcar_assinatura(user, status, gateway, id)`** (migration 0007; SECURITY DEFINER, `search_path`, revogada de public, anon e authenticated; só service role). Só aceita `cancelada`. Só vale se o gateway e o id forem os **guardados** do usuário (`null` nunca confere): aviso de outro preapproval ou de outra autorização nunca muda o status (devolve `nao_guardada`, com log). Só passa de `ativa` para `cancelada`: quem está no teste (checkout pendente cancelado, autorização recusada antes de pagar) continua no teste com os dias que tem. Repetir devolve `repetida`.
- **Cancelado mantém o acesso até o fim do período pago.** Decisão: sim. `assinatura_situacao` (redefinida na 0007) dá `liberada = periodo_ate > now()` para `cancelada`, **sem a carência de 3 dias** (a carência é para pagamento atrasado; quem cancelou não está atrasado). O painel mostra "Assinatura cancelada" e "Paga até …". Cancelar não reembolsa.
- **Estorno e chargeback (decisão do Maxwel, rodada de correções).** Estorno **total** de um pagamento que nós creditamos (MP `refunded` ou `charged_back`, ou tudo devolvido; Asaas `REFUNDED` ou `CHARGEBACK_*`, sempre conferido na API) faz duas coisas: (1) `estornar_pagamento(gateway, id)` (0007) vira o pagamento `aprovado` em `estornado` (o ferrolho é o próprio status: o reenvio devolve `repetido` e não tira outro mês) e tira do `periodo_ate` o mês que ele deu; se não sobra período, a assinatura vira `estornado` (novo valor do check de `assinaturas.status`) e o robô para; se sobra de outros pagamentos, segue `ativa` com ele a menos; (2) **cancela a assinatura guardada no gateway** (`cancelarDoUsuario`, o mesmo miolo do botão). Se o cancelamento falhar, a rota responde 500 e o gateway reenvia; no reenvio o `estornar_pagamento` devolve `repetido` e a rota **tenta cancelar de novo** (`ja_cancelado` encerra), então um estorno nunca deixa o gateway cobrando. Pagamento que nunca creditamos → `desconhecido`: não tira nada e não cancela nada. **Só cancela a assinatura DO pagamento (migration 0008, achado A do R2):** `pagamentos.gateway_assinatura_id` guarda de qual preapproval/autorização o pagamento veio; `estornar_pagamento` compara com a guardada agora e, se for outra, devolve `estornado_antiga`/`repetido_antiga`: tira o mês, **não** cancela a atual e o webhook solta `ALERTA estorno_de_assinatura_antiga`. Id nulo (linha anterior à 0008) cancela a atual, como antes. **Devolução parcial** depois do crédito **não tira nada** e não cancela: só `console.error("ALERTA devolucao_parcial ...")` (MP: `approved` com valor devolvido menor que o pago; Asaas: cobrança ainda paga com lista `refunds`). Antes do crédito continua como no C1: pagamento com devolução não credita. O estorno de um pagamento não cria assinatura nova: se o gateway cobrar de novo depois (não deveria, foi cancelado), o pagamento novo volta a liberar.
- **Excluir conta (bloqueava produção).** `cancelarEApagar` (`lib/cancelar-servidor.ts`) cancela no gateway **antes** do `deleteUser`; se o cancelamento falhar, a conta **não** é apagada (falha fechada) e o usuário recebe a mensagem. Já cancelado no gateway conta como sucesso. Quem nunca abriu checkout apaga direto. O aviso de cancelamento que chega depois para a conta apagada cai em `sem_usuario` (200). Preapproval que **nem existe mais no MP (404)** conta como `ja_cancelado` (como o Asaas já fazia com `ouNaoExiste`), senão a conta ficava presa para sempre; erro de rede ou 5xx continua falhando fechado, e a mensagem manda tentar de novo ou escrever pro suporte.
- **Botão com o gateway já cancelado.** Se a API já diz que a assinatura está cancelada (cancelaram direto no gateway, ou o aviso se perdeu e não vem mais), o botão chama `marcar_assinatura` com o id guardado (`cancelarPeloBotao`): é a mesma regra de só mudar com a verdade do gateway, e `marcar_assinatura` ainda só move `ativa` para `cancelada` e só para o id guardado. O texto avisa que já estava cancelado no gateway e que o acesso segue até o fim do período pago. 404 do MP ou da autorização do Asaas conta como cancelado.
- **Pagamento depois de cancelar.** `registrar_pagamento` (redefinida na 0007) dá o mês mas **mantém `cancelada`**: a cobrança que já estava a caminho quando o cliente cancelou não ressuscita a assinatura. Quem assina de novo volta a `ativa`: `guardar_preapproval` e `guardar_autorizacao_asaas` (redefinidas na 0007) desfazem o `cancelada` ao abrir o checkout novo (com período pago sobrando vira `ativa`, sem período vira `vencida` até o 1º pagamento).
- **Tipos de aviso do MP.** O de assinatura chega como `preapproval` ou `subscription_preapproval` (a documentação do MP usa os dois nomes); os dois são tratados. Tipo de chargeback próprio do MP (`topic_chargebacks_wh`) **não** é tratado: confiamos na mudança de status do `payment` (`charged_back`). Disputa em andamento (`in_mediation`) não revoga.
- **Tela.** Só o botão (aparece com assinatura `ativa`, fora da demonstração), o aviso "pedido enviado, aguarda o gateway" (ou "já estava cancelada no gateway"), o texto do cartão (saiu "cancela no Mercado Pago") e o rótulo "Pagamento estornado". O botão reaproveita `classeBotao`, `Aviso` e o padrão do `AssinarCartao`; as skills frontend-design e ui-ux-pro-max foram carregadas antes de mexer em qualquer texto de tela.
- **Não verificável sem gateway real (precisa de OK do Maxwel):** se o `PUT` do MP aceita `cancelled` em preapproval `pending` e se o aviso chega com o tipo e o `data.id` esperados; o corpo exato do aviso `REFUSED` do Asaas (a página não traz exemplo; usamos `authorization.id` como no `CANCELLED`); se `DELETE` da autorização leva o `subscriptionId` junto ou se o `DELETE /subscriptions` é mesmo necessário; os status de devolução reais de uma cobrança Pix estornada; se o MP manda `payment` ao estornar e ao perder chargeback.
- **Fora do C3:** cancelar um checkout/QR **pendente** (usuário ainda no teste, que quer trocar de cartão para Pix) continua sem botão: o botão só aparece com assinatura `ativa` (C4 decide a tela dos estados); ligar um aviso de verdade aos `ALERTA`/estornos do log.

### Decisões do C4 (tela /painel/conta), 20/10/2026

- **Um texto por estado, lido da situação do banco.** `components/painel/assinatura.tsx` (`visaoDaAssinatura`) só LÊ `assinatura_situacao`; não decide acesso. Cada estado diz três coisas numa grade: **Robô** (liberado ou pausado), **até quando** (`Teste até`, `Paga até`, `Acesso até`, `Terminou em`, `Venceu em`) e **próximo passo**. "Teste acabou" e "vencida" chegam os dois como `vencida`; o que separa é nunca ter pago (`periodoAte` nulo), sem mexer em lib nem banco.
- **Assinar de novo nos dois gateways** para `cancelada` (com ou sem período), `estornado` e `vencida` (botões "Assinar de novo no cartão" e "Assinar de novo no Pix"). Teste ativo e teste acabou seguem com "Assinar". Com `ativa` não abre checkout (como antes).
- **Cancelar fora do `ativa`.** Reaproveita `cancelarAssinatura` (id guardado, só pede ao gateway; nada de banco ou webhook). Aparece num bloco recolhido ("Ainda aparece cobrança no teu cartão ou no teu Pix?") para `vencida` com cobrança viva, e ("Abriu o checkout ou o QR e quer trocar de cartão para Pix?") para quem está no teste ou com o teste acabado. Recolhido de propósito: a maioria não tem nada aberto, e sem cobrança o clique devolve "Não achei assinatura pra cancelar". `ativa` mantém o botão à vista. Para `cancelada` e `estornado` não há botão (o C3 já cancelou no gateway).
- **Mensagens da ação.** As duas respostas de `cancelarAssinatura` diziam "aparece como cancelada" e "acesso segue até o fim do período pago", o que é falso para teste pendente e para vencida. Agora dizem só que o pedido saiu (ou que já estava cancelado) e mandam recarregar a página.
- **Demonstração.** Os botões aparecem também no modo demonstração, com uma linha avisando que não cobram nada; as ações já recusam sem Supabase. Antes sumiam, e nenhum estado dava para conferir na tela.
- **Texto honesto.** "Próxima cobrança por volta de" (a data real é do gateway); nada de promessa de entrega, de bloqueio ou de número de vendas.
- **Fora do C4:** o cartão do rodapé da barra lateral (`components/painel/nav.tsx`) diz "O teste acabou. Assina pra voltar." também para assinatura vencida; texto de outro componente, não mexi. Estado "ativa dentro da tolerância" tem texto próprio mas não foi fotografado.

---

## Fase D · publicar

1. Supabase de produção (região São Paulo) com a migration aplicada e a conferência do fim do arquivo rodada.
2. Vercel: projeto novo apontando pro repositório, variáveis do `.env.example`, `CRON_SECRET` (o cron diário de renovação já está no `vercel.json`).
3. Subdomínio (ex.: `gatilho.mxdigital.ia.br`) com CNAME pra Vercel e `NEXT_PUBLIC_SITE_URL` igual.
4. App da Meta em Live e **revisão do app**: acesso avançado em `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` (e `instagram_business_manage_insights`, se ficar com as métricas). Pede verificação da empresa (CNPJ) e um vídeo mostrando o fluxo inteiro funcionando (conectar, criar automação, comentar, receber a DM).
5. Até a revisão sair: cada cliente entra como **testador** do app (convite que ele aceita no Instagram), como no plano do produto.

---

## O que falta pra abrir pra clientes (26/10/2026)

**Já no ar:** site em https://gatlo.mxdigital.ia.br (Vercel, https e cabeçalhos ok); Supabase `gatlo-ai` com as
migrations 0001..0008; `gatilho-envia` rodando de 3 em 3 min (200) e a limpeza diária; segredos do app na Vercel.
**Mas o site no ar ainda é a `main` da fase A:** as fases B e C só entram com o merge do PR desta cadeia.

Na ordem (cada passo é do Maxwel, no painel de cada serviço; nenhuma chave passa pelo chat):

1. **Merge do PR do app na `main`** (depois do teu OK). O PR do site (#1) mexe no mesmo `app/page.tsx`: quem
   entrar por segundo resolve o conflito ficando com a versão do site (ela já diz "Pix Automático (Asaas)").
2. **Supabase → Authentication**
   - URL Configuration: Site URL = `https://gatlo.mxdigital.ia.br`; Redirect URLs: `https://gatlo.mxdigital.ia.br/**`.
   - Providers → Email: confirmação de e-mail ligada, senha mínima 8. (Proteção de senha vazada só existe no plano Pro.)
   - Email Templates: os dois links do README (`/auth/confirmar?token_hash=...`).
   - **SMTP próprio (obrigatório):** o e-mail padrão do Supabase só entrega pra quem é da equipe do projeto (e
     uns 2 por hora). Sem SMTP, cliente nenhum recebe a confirmação do cadastro nem o "esqueci a senha".
     Ex.: Resend (grátis até 3.000/mês): verificar o domínio `mxdigital.ia.br` (registros DNS no registro.br) e
     preencher em Authentication → SMTP Settings: host `smtp.resend.com`, porta `465`, usuário `resend`, senha =
     a chave do Resend, remetente `contato@mxdigital.ia.br`, nome `Gatlo AI`.
3. **Webhook do Instagram:** gerar um texto aleatório (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`),
   colocar como secret `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` em Supabase → Edge Functions → Secrets, e no app da Meta
   (Instagram → Webhooks) usar a URL `https://mkhfikiniyiowxohznzc.supabase.co/functions/v1/gatilho-webhook` com o
   mesmo texto, e assinar o campo `comments`. Hoje a função responde 503 justamente por falta desse secret.
4. **Mercado Pago (cartão):** na Vercel, `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET` (produção) e
   redeploy. No painel do MP → Webhooks: URL `https://gatlo.mxdigital.ia.br/api/mercadopago-webhook`, eventos
   "Pagamentos" e "Planos e assinaturas". Sem a chave E o segredo, o botão do cartão não aparece no painel.
5. **Asaas (Pix Automático): primeiro o sandbox.** Rodar um ciclo inteiro no sandbox (no localhost, com a chave
   do sandbox no `.env.local`): assinar, pagar o QR, conferir que a assinatura ativa e que a próxima cobrança vem
   para daqui a 1 mês (não hoje). Só depois: `ASAAS_API_KEY` (produção), `ASAAS_WEBHOOK_TOKEN` e
   `ASAAS_AMBIENTE=producao` na Vercel, e o webhook do Asaas apontando pra `https://gatlo.mxdigital.ia.br/api/asaas-webhook`.
   Sem a chave E o token do webhook, o botão do Pix não aparece; dá pra abrir só com o cartão.
6. **B4, teste real:** tua conta como testadora do app → automação de verdade → comentar de outra conta → DM com
   botão, clique contado, resposta pública.
7. **D3, revisão da Meta:** roteiro do vídeo e textos de cada permissão em [`docs/REVISAO-META.md`](REVISAO-META.md).
   Até a revisão sair, só contas **testadoras** conectam (o cliente aceita o convite no Instagram).
