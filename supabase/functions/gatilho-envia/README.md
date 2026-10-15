# gatilho-envia

Edge Function pública (Deno) que manda as DMs do Gatlo AI. O agendador do banco (pg_cron, de 3 em 3 min; B3) chama com `POST` e o cabeçalho `x-cron-chave`. Ela tira comentários da fila (`comentarios`, abastecida pela `gatilho-webhook`) e manda a **resposta privada** pela API do Instagram, por conta, com fila, intervalo e pausa **por conta**.

`verify_jwt` está desligado em `supabase/config.toml` (o agendador não manda JWT). O que protege a função é a chave do cron, conferida em tempo constante **antes de qualquer efeito**: sem cliente de banco, sem leitura de token, sem chamada à Meta e sem nada no log.

## Respostas HTTP

| Caso | Resposta |
|---|---|
| método diferente de `POST` | `405` |
| `GATILHO_CRON_CHAVE` não configurado | `503 indisponível` (o detalhe vai só pro `console.error`) |
| `x-cron-chave` ausente ou errado | `401` |
| faltam `GATILHO_CHAVE_TOKENS` ou `GATILHO_SITE_URL` (ou a URL não começa com `http(s)://`) | `503 indisponível` |
| rodada concluída | `200` com os números (`contas`, `enviadas`, `erros`, `respostas`, `pausadas`, `puladas`, `concorrencia`, `falhas`, `orcamento`); nunca texto de comentário nem token |
| banco fora do ar, regra faltando | `500 falha na rodada` (o detalhe vai só pro log) |

## O que uma rodada faz

Contas `conectada` e `demonstracao = false`, **3 por vez**, em ordem **embaralhada a cada rodada** (com o orçamento de tempo estourando, as mesmas contas não ficam sempre de fora). Para cada uma, nesta ordem:

1. `assinatura_situacao(user_id).liberada = false` (teste acabou e não assinou) → pula; a fila fica guardada.
2. `envio_pausa.direct_ate` no futuro → pula.
3. **Fila**: `comentarios` da conta com `dm_em` e `dm_erro` nulos, **sem reserva em voo** (`dm_reservado_em` nulo, ou mais velho que 10 min: a rodada que reservou morreu), `recebido_em` dentro de `fila_janela_dias`, por `recebido_em`, no máximo `envio_max_por_rodada`. Comentário de automação **desligada** não entra na fila da rodada (fica guardado e não ocupa vaga; religou dentro da janela, sai).
4. **Token**: lê `tokens_instagram` e decifra com WebCrypto (`v1.<iv>.<cifra+tag>` de `lib/cripto.ts`; chave `GATILHO_CHAVE_TOKENS`). Sem token, token vencido (`expira_em` no passado) ou ilegível → pula a conta **sem marcar erro** em ninguém.
5. Para cada comentário, `envio_intervalo_segundos` depois do anterior:
   - se `dm_tentativas >= 2` (já recuperada uma vez e presa de novo) → `dm_erro = 'rodada interrompida'`, sem chamar a Meta;
   - **reserva** a linha no banco (abaixo);
   - manda a resposta privada com o **modelo de botão** (`<GATILHO_SITE_URL>/l/<automacoes.codigo>?c=<comentarios.id>`). Se a Meta **recusar** o botão (HTTP 4xx que não é de limite), manda de novo como texto: `"<mensagem_dm>\n\n<link>"`;
   - **limite** da Meta (códigos 4, 17, 32, 613, 80002, HTTP 429 ou texto "limit how often", "rate limit", "too many"...) → `envio_pausa.direct_ate = agora + envio_pausa_direct_min`, o motivo, **sem** `dm_erro`; a reserva é devolvida e a conta para nesta rodada (a pessoa segue na fila);
   - outro erro (inclusive o texto também recusado) → `dm_erro`;
   - deu certo → `dm_em` e `igsid = recipient_id`;
   - **resposta pública** (se a automação tem `resposta_publica` e a DM saiu): só se `envio_pausa.resposta_ate` não está no futuro e a conta tem menos de `respostas_publicas_max_24h` respostas nas últimas 24 h. Limite → `resposta_ate = agora + envio_pausa_resposta_min` (a DM continua marcada). Outro erro → `resposta_erro`.
6. Automação **apagada** (`automacao_id` nulo) → `dm_erro = 'automação apagada'`, sem chamar a Meta.

Todos os números (máximo por rodada, intervalo, minutos de pausa, teto de respostas, janela da fila) vêm da tabela `regras`; regra faltando derruba a rodada com erro, nunca vira um valor inventado. Só duas constantes vivem no código, por serem infraestrutura e não regra de negócio: o **orçamento de tempo da rodada** (100 s; passou, não começa envio novo e o resto fica na fila) as **3 contas em paralelo** e os **10 min** a partir dos quais uma reserva é considerada presa (bem acima da rodada mais longa possível, ~145 s). Cada chamada à Meta desiste em 15 s.

## A mesma DM nunca sai duas vezes

O cron pode sobrepor rodadas. Antes de falar com a Meta, a rodada **reserva** o comentário com um `UPDATE` só, atômico:

```sql
update comentarios set dm_tentativas = dm_tentativas + 1, dm_reservado_em = now()
where id = $1 and dm_tentativas = <valor lido> and dm_em is null and dm_erro is null
returning id
```

Quem não recebe a linha de volta pula. Duas peças trabalham juntas: o `UPDATE` condicional **e** o filtro de reserva em voo da fila (`dm_reservado_em` nulo ou velho), que esconde das outras rodadas um comentário cuja DM está em voo (sem o filtro, uma rodada que começa no meio da outra lê `dm_tentativas = 1`, reserva de novo e repete a DM; há teste para isso). `dm_em` e `dm_erro` só são gravados em linha que ainda tem `dm_em` nulo.

`dm_tentativas` é "quantas vezes a DM foi tentada": 1 depois de enviar ou de um erro comum. O limite da Meta devolve a reserva (`dm_tentativas` volta e `dm_reservado_em` zera).

### Reserva presa (a rodada morreu no meio)

Se a função morre entre reservar e gravar o resultado, a linha fica com `dm_tentativas = 1`, sem `dm_em` nem `dm_erro`. A migration `0002_reserva_envio.sql` (ainda **não aplicada**) acrescenta `comentarios.dm_reservado_em`, gravada no mesmo `UPDATE` da reserva. Com ela:

- reserva **mais nova** que 10 min = rodada ainda em voo: ninguém pega;
- reserva **mais velha** que 10 min = rodada morta: a fila oferece a linha de novo e ela é reservada com o mesmo `UPDATE` condicional (`dm_tentativas = lido`), então duas rodadas simultâneas continuam sem pegar a mesma linha (`dm_tentativas` 1 → 2);
- presa de novo (`dm_tentativas >= 2`) → `dm_erro = 'rodada interrompida'`, sem chamar a Meta.

**Por que reenviar é seguro:** a Meta só aceita **uma** resposta privada por comentário. Se a rodada morreu depois de a Meta aceitar a DM, a nova tentativa volta como erro e vira `dm_erro`: a pessoa não recebe a DM duas vezes. A resposta pública só acontece na rodada em que a DM saiu, então também não duplica.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.ts` | só liga tudo e chama `Deno.serve` |
| `manipulador.ts` | HTTP: método, chave do cron, secrets, resumo |
| `rodada.ts` | a lógica da rodada, atrás das interfaces `Banco` e `Meta` |
| `meta.ts` | chamadas à API do Instagram (`fetch` injetado), `ehLimite` |
| `token.ts` | decifra o token (WebCrypto) |
| `banco_supabase.ts` | a `Banco` de produção (service role, supabase-js) |
| `seguranca.ts` | comparação em tempo constante (cópia de `gatilho-webhook/seguranca.ts`) |
| `../_testes/pg_envia.ts` | a mesma `Banco` sobre o Postgres de verdade (PGlite com a `0001_esquema.sql` inteira) |

## Variáveis (secrets da função)

| Secret | Para quê |
|---|---|
| `GATILHO_CRON_CHAVE` | a chave que o agendador manda em `x-cron-chave` |
| `GATILHO_CHAVE_TOKENS` | a MESMA chave AES-256 (32 bytes em base64) do app, para decifrar os tokens |
| `GATILHO_SITE_URL` | base do link curto da DM (`https://...`, sem barra no fim) |
| `INSTAGRAM_GRAPH_VERSAO` | opcional; padrão `v23.0` |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase injeta sozinho.

## Testes

```
npm run teste:funcoes
```

Roda `deno` pelo `npx`, com `--allow-read --allow-env` e **sem** `--allow-net`: a Meta é um `fetch` injetado e o banco é um Postgres em memória; nada sai pra rede. As chaves são sorteadas a cada execução. `banco_supabase_test.ts` confere o pedido que a `Banco` de produção monta (inclusive as condições do `reservar`).

## Deploy (não feito; precisa do OK do Maxwel)

```
supabase functions deploy gatilho-envia --project-ref <ref>
supabase secrets set GATILHO_CRON_CHAVE=... GATILHO_SITE_URL=... --project-ref <ref>
```

O agendador (pg_cron + pg_net, com a chave no Vault) é o B3.

## Limites conhecidos

- **Rodada que morre no meio**: a reserva presa só volta à fila depois de 10 min e é recuperada **uma vez**; se prender de novo, o comentário vira `dm_erro 'rodada interrompida'`. Se a DM da rodada morta tinha saído, a pessoa recebeu a original e o painel mostra erro (a Meta recusa a segunda). Enquanto presa, a linha ainda conta como "na fila" no painel.
- **Erro de rede ou HTTP 5xx** na DM vira `dm_erro` sem reenvio como texto: a Meta pode ter entregue.
- Se o banco cair **depois** de a Meta aceitar a DM, a marca é tentada 3 vezes; se ainda assim falhar, a linha fica reservada (não repete) e o erro vai pro log.
- A resposta pública só é tentada na rodada em que a DM sai; se falhar por limite, aquele comentário não é respondido depois.
- Automação desligada **durante** uma rodada em andamento ainda pode enviar os comentários que a rodada já tirou da fila (alguns segundos).
- A pausa do cliente só aparece no painel (lê `envio_pausa`); o aviso por e-mail fica pra depois (`avisado_em` é zerado a cada pausa nova de DM para isso).
- Lê as contas conectadas de mil em mil e as embaralha a cada rodada; com muitas contas a rodada é limitada pelo orçamento de 100 s e o resto espera a próxima (por sorteio, sem favorecer ninguém, mas sem garantia de ordem).
