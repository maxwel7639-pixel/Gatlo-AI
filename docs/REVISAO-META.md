# Revisão do app na Meta (ponto D3)

Tudo que o Maxwel precisa para enviar o app do Gatlo para a revisão da Meta: checklist, roteiro do vídeo, textos das permissões e instruções para o revisor.

O que o app faz, para não prometer demais: a pessoa conecta o Instagram profissional dela, escolhe um post e uma palavra. Quando alguém comenta essa palavra, o app manda **uma DM** para quem comentou, com um botão de link (uma por comentário). Opcionalmente responde o comentário em público. **O app não posta nada, não curte, não segue, não lê DMs e não manda mensagem a quem não comentou.**

---

## (a) Checklist antes de enviar

- [ ] App em modo **Live** (não Desenvolvimento).
- [ ] Verificação da empresa (CNPJ) concluída no Business Manager.
- [ ] URL da política de privacidade: `https://gatlo.mxdigital.ia.br/privacidade`
- [ ] URL dos termos: `https://gatlo.mxdigital.ia.br/termos`
- [ ] URL de exclusão de dados (instruções): `https://gatlo.mxdigital.ia.br/exclusao-de-dados`
- [ ] Redirect OAuth válido: `https://gatlo.mxdigital.ia.br/api/instagram/callback`
- [ ] URL de desautorizar (deauthorize): `https://gatlo.mxdigital.ia.br/api/instagram/desautorizar`
- [ ] URL de pedido de exclusão (data deletion request): `https://gatlo.mxdigital.ia.br/api/instagram/exclusao`
- [ ] Ícone do app (1024x1024) e categoria preenchidos.
- [ ] Testadores adicionados (a conta Instagram de teste e a conta que vai comentar), aceitos nos dois lados.
- [ ] Webhook do Instagram apontando para `https://mkhfikiniyiowxohznzc.supabase.co/functions/v1/gatilho-webhook`, com o token de verificação igual ao `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, **campo `comments`** assinado.
- [ ] Conta de teste do Gatlo criada (ver seção d) e funcionando.
- [ ] Vídeo gravado (seção b), um por permissão ou um só mostrando todas, com legenda em inglês.
- [ ] Testar o fluxo inteiro no site publicado antes de gravar.

---

## (b) Roteiro do vídeo (screencast)

Grave a tela no site publicado (`https://gatlo.mxdigital.ia.br`), em 1080p, sem cortes no meio do fluxo. Use contas de teste. Coloque a legenda em inglês na tela em cada cena.

| # | O que fazer | Legenda (inglês) |
|---|---|---|
| 1 | Abrir a página inicial e clicar em criar conta. | "Gatlo is a web app that sends a Direct Message to people who comment a keyword on your Instagram post." |
| 2 | Cadastrar com e-mail e senha e entrar no painel. | "We sign up with email and password and land on the dashboard." |
| 3 | Em Conta, clicar em Conectar Instagram. | "The user connects their professional Instagram account." |
| 4 | **Tela de consentimento da Meta**: deixar na tela, sem pressa, mostrando as permissões pedidas. Clicar em Permitir. | "Instagram's consent screen lists the permissions the app requests. The user approves." |
| 5 | Voltar ao painel com a conta conectada (nome de usuário aparecendo). | "The account is connected. We show only the username." |
| 6 | Abrir Posts: a grade com os posts reais da conta (e as métricas, se a permissão de insights for mantida). | "The app lists the user's own posts so they can pick one." |
| 7 | Criar automação: escolher um post, digitar a palavra (ex.: `quero`), escrever a mensagem da DM, o título do botão e o link. Opcional: texto da resposta pública. Salvar e ligar. | "The user chooses a post, a keyword, the DM text and the button link, then turns the automation on." |
| 8 | Em outro aparelho/conta (a conta testadora), comentar `quero` no post escolhido. | "From a different account, we comment the keyword on that post." |
| 9 | Mostrar a DM chegando na conta que comentou, com a mensagem e o botão. | "The commenter receives one Direct Message with a button. The message is sent only because they commented the keyword." |
| 10 | Mostrar a resposta pública no comentário (se ligada). | "The app also replies publicly to that comment." |
| 11 | Na conta que comentou, tocar no botão. | "The commenter taps the button and opens the link." |
| 12 | Voltar ao painel: mostrar o número de comentários, DMs e **cliques** contado na automação. | "The dashboard shows comments, messages sent and link clicks." |
| 13 | Em Conta, clicar em Desconectar Instagram. | "The user can disconnect at any time. The access token is deleted right away." |
| 14 | Mostrar o pedido de exclusão de dados (botão de excluir conta no painel e a página `/exclusao-de-dados`). | "The user can ask to delete all their data, and there is a public data deletion page." |

Dica: se o revisor tiver de ver cada permissão sendo usada, as cenas 4 (consentimento), 6 (posts), 8 a 10 (comentário, DM, resposta) e 12 (métricas) cobrem todas.

---

## (c) Texto de cada permissão

Cole o texto em inglês no campo "How will your app use this permission". A linha em português é só para você entender.

### instagram_business_basic

Português: o app lê o perfil e a lista de posts da pessoa para ela escolher em qual post vale a automação.

```
Gatlo lets an Instagram professional account owner pick one of their own posts and set a keyword that triggers an automatic Direct Message. We use instagram_business_basic to read the account's username and profile, and to list the account's own media (post id, caption, thumbnail, permalink) so the user can choose which post the automation applies to. We show this only to the account owner inside their dashboard. We do not read or store media from other accounts.
```

### instagram_business_manage_comments

Português: o app recebe os comentários dos posts da pessoa, vê se tem a palavra e responde o comentário em público (se a pessoa ligar essa opção).

```
Gatlo uses instagram_business_manage_comments to receive comments on the posts of the connected account (through the "comments" webhook field, and by reading the comments of the owner's recent posts as a fallback) and check whether a comment contains the keyword the account owner configured. When the owner enables it, we also post a public reply to that same comment (for example "Check your DMs!"). We only act on comments of posts covered by an automation the owner created (one chosen post, or all of their posts), we only reply to comments that matched the keyword, and we never create, edit or delete the owner's posts or other people's comments.
```

### instagram_business_manage_messages

Português: o app manda uma DM, com um botão de link, para quem comentou a palavra. Uma por comentário.

```
Gatlo uses instagram_business_manage_messages to send one private reply (Direct Message) to a person who commented the configured keyword on the account owner's post. The message contains the text written by the account owner and a button with a link. We send it only as a reply to that specific comment (the comment id), at most one message per comment, and never to people who did not comment. We do not read, list or store the account's inbox or conversations, and we do not send bulk or unsolicited messages.
```

### instagram_business_manage_insights (só se mantida)

Português: o app mostra alcance, visualizações, salvamentos e compartilhamentos de cada post na grade de posts. É a única coisa que usa essa permissão.

```
Gatlo uses instagram_business_manage_insights only to show the account owner basic performance numbers for each of their own posts (reach, views, saves and shares) next to the post list in their dashboard, so they can decide which post to automate. The data is read for the owner's own media only, shown only to the owner, and not used for advertising, profiling or sold to third parties.
```

---

## (d) Instruções de teste para o revisor da Meta

Cole no campo "Notes for reviewer / Testing instructions".

```
Test account for Gatlo
URL: https://gatlo.mxdigital.ia.br
Email: ____________________   (Maxwel preenche)
Password: ____________________   (Maxwel preenche)

The test account is already linked to an Instagram professional (Business/Creator) test account. If you prefer to connect your own, go to Account > Connect Instagram.

Steps:
1. Open https://gatlo.mxdigital.ia.br and log in with the credentials above.
2. Go to "Posts". You will see the posts of the connected Instagram account (instagram_business_basic; metrics come from instagram_business_manage_insights).
3. Go to "Automations" > "New automation". Pick a post, type the keyword "quero", write the message text, the button title and a link. Save and turn it on.
4. From another Instagram account (a tester of the app), comment "quero" on that post.
5. Shortly after, that account receives one Direct Message with the text and a button (instagram_business_manage_messages). If the public reply option is on, the comment also gets a public reply (instagram_business_manage_comments).
6. Tap the button. Back in the dashboard, "Clicks" for that automation increases by one.
7. To disconnect: Account > Disconnect Instagram. To request deletion of data: use the delete account option in Account, or the page https://gatlo.mxdigital.ia.br/exclusao-de-dados.

Notes: the app only sends a message to people who commented the keyword, one per comment. It does not publish posts, like, follow, or read the inbox.
```

Antes de enviar: o Maxwel cria a conta de teste no Gatlo, conecta o Instagram de teste e confere que o passo 5 funciona de verdade. Troque os dois campos em branco pelo e-mail e senha.

---

## Vale tirar o insights da 1ª revisão?

Vale, na minha opinião. Cada permissão extra é mais um texto, mais uma cena no vídeo e mais um motivo para a Meta recusar e fazer você refazer tudo; e o insights só enfeita a grade de posts: o produto (comentário vira DM) funciona sem ele. Com `INSTAGRAM_SEM_METRICAS=1` o app pede só três permissões, a revisão fica mais curta e mais fácil de aprovar. Depois de aprovado, você pede o insights numa segunda rodada, já com o app no ar e com clientes usando. Antes de ligar a variável, confira que a grade de posts abre bem sem métricas (a tela mostra só comentários e curtidas, segundo o código).
