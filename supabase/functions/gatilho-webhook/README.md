# gatilho-webhook

Edge Function pública (Deno) que recebe os avisos de comentário da Meta e põe na fila (`comentarios`) o que casa com uma automação ligada. Não manda DM: quem manda é a `gatilho-envia` (B2).

`verify_jwt` está desligado em `supabase/config.toml` (a Meta não manda JWT). O que protege a função é o segredo da própria Meta, conferido antes de qualquer efeito.

## O que ela faz

- **GET** `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`: devolve o `challenge` se o token for igual a `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (comparação em tempo constante); senão `403`.
- **POST**: lê o corpo **cru**, confere `X-Hub-Signature-256` (HMAC-SHA256 com `INSTAGRAM_APP_SECRET`, tempo constante). Errada ou ausente: `401`, sem tocar no banco. Certa: responde `200` na hora e processa em `EdgeRuntime.waitUntil` (sem `EdgeRuntime`, como nos testes, espera terminar).
- Para cada `entry` (`entry.id` = `contas_instagram.ig_user_id`) e cada `change` com `field = "comments"`:
  1. conta com `status = 'conectada'` e `demonstracao = false`; senão ignora;
  2. ignora comentário da própria conta (`value.from.id == entry.id`) e resposta a comentário (`value.parent_id`);
  3. automações `ativa` da conta: primeiro as do post (`media_id = value.media.id`), depois as de qualquer post; dentro de cada grupo, a mais antiga primeiro; vale a primeira cuja palavra bater (`palavraQueBateu`);
  4. `insert into comentarios … on conflict (comment_id) do nothing`.
- A Meta não manda a data do comentário no webhook; `comentado_em` recebe o `entry.time` (momento do aviso).

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.ts` | só liga tudo e chama `Deno.serve` |
| `manipulador.ts` | HTTP: GET, assinatura, 200 imediato |
| `processar.ts` | a lógica do corpo, atrás da interface `Banco` |
| `banco_supabase.ts` | a `Banco` de produção (service role, supabase-js) |
| `seguranca.ts` | HMAC e comparação em tempo constante |
| `../_shared/palavras.ts` | cópia **idêntica** de `lib/palavras.ts` (um teste falha se divergirem) |
| `../_testes/pg.ts` | Postgres de verdade (PGlite) com a `0001_esquema.sql` inteira |

## Variáveis (secrets da função)

`INSTAGRAM_APP_SECRET`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase injeta sozinho. Sem `INSTAGRAM_APP_SECRET` (ou o token, no GET) a função devolve `503` em vez de aceitar sem conferir.

## Testes

```
npm run teste:funcoes
```

Roda `deno` pelo `npx` (nada instalado global), com `--allow-read --allow-env` e **sem** `--allow-net`: os testes não chamam a Meta nem o Supabase. Os segredos são sorteados a cada execução.

## Deploy (não feito; precisa do OK do Maxwel)

```
supabase functions deploy gatilho-webhook --project-ref <ref>
```

No app da Meta (Webhooks → Instagram): URL de retorno `https://<ref>.supabase.co/functions/v1/gatilho-webhook`, token de verificação igual a `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, campo `comments`. A conta é inscrita no fim do login (`app/api/instagram/callback`).

## Limites conhecidos

- Se o banco cair no meio do processamento, a Meta já recebeu `200` e não reenvia; o comentário só volta pela consulta de reserva (B2b). O erro vai pro log (só o id do comentário, nunca o texto).
- A Meta só manda webhook de comentários com o app em **Live**, acesso avançado e conta pública (ver `docs/PLANO.md`).
