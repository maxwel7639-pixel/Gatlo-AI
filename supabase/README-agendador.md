# Agendador do Gatilho (pg_cron + pg_net) e a limpeza

Dois trabalhos do banco, criados por `supabase/agendador.sql`:

| Trabalho | Quando | O que faz |
|---|---|---|
| `gatilho-envia-3min` | a cada 3 minutos | `POST` na Edge Function `gatilho-envia` (a rodada de DMs), com a chave no cabeçalho `x-cron-chave` |
| `gatilho-limpeza-diaria` | 1x por dia (04:00 UTC = 01:00 em São Paulo) | `select public.limpar_dados_antigos()` — apaga comentários, cliques e janelas de taxa antigos (`0004_limpeza.sql`) |

O fuso é o do `pg_cron` (UTC, o padrão do Supabase).

## Por que fora de `migrations/`

O endereço da função e a chave do cron saem do **Vault** e só existem depois que o
Maxwel cria o projeto e os segredos. Por isso o agendador não é uma migration: ele é
aplicado à mão, no SQL editor do painel, **depois** de:

1. as migrations `0001_esquema.sql` .. `0004_limpeza.sql` aplicadas;
2. as extensões `pg_cron`, `pg_net` e o **Vault** habilitadas (`Database → Extensions`);
3. os dois segredos do Vault criados (abaixo).

Sem as extensões, `supabase/agendador.sql` **falha com mensagem clara** em vez de
criar um trabalho pela metade. Nada disto foi aplicado ainda: depende do OK do Maxwel
(pontos D1/D2).

## Segredos no Vault (nunca em arquivo, no chat ou no repositório)

O trabalho do `pg_cron` lê os dois valores na hora em que roda, pelo NOME:

| Segredo (nome) | Valor |
|---|---|
| `gatilho_envia_url` | endereço completo da função `gatilho-envia` (`https://<ref>.supabase.co/functions/v1/gatilho-envia`) |
| `gatilho_cron_chave` | o **MESMO** valor do secret `GATILHO_CRON_CHAVE` da função (`supabase secrets set ...`) |

Criar pelo painel do Supabase (`Project Settings → Vault`) ou, no SQL editor (o valor
é digitado por quem aplica, não fica no repositório):

```sql
select vault.create_secret('...endereço da função...', 'gatilho_envia_url');
select vault.create_secret('...mesma chave da função...',   'gatilho_cron_chave');
```

O `gatilho-envia` confere o `x-cron-chave` **em tempo constante, antes de qualquer
efeito**: sem ele (ou errado) responde `401`; se o secret `GATILHO_CRON_CHAVE` da
função não existir, responde `503`. Trocar a chave = atualizar os dois (o segredo do
Vault e o secret da função) — nunca só um.

## Limpeza (promessa da política de privacidade)

`0004_limpeza.sql` traz a função `public.limpar_dados_antigos()` (SECURITY DEFINER,
revogada de `public`, `anon`, `authenticated` e `service_role` — quem chama é o
`pg_cron`, como dono) e o prazo na tabela `regras`:

| Regra | Padrão | O que é |
|---|---|---|
| `limpeza_dias` | 90 | dias que comentários e cliques ficam guardados |
| `limpeza_taxa_horas` | 24 | horas que uma janela da trava de taxa fica guardada |

Mudar o prazo é um `update public.regras set valor = 60 where chave = 'limpeza_dias'`:
sem deploy e sem tocar em código. A limpeza apaga **só o que passou do prazo**; o
clique cai pela própria data (`clicado_em`), nunca por tabela arrastada. A conferência
de privilégios e do prazo está no fim de `0004_limpeza.sql`.
