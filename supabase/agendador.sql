-- ============================================================================
-- Gatilho — agendador do banco (pg_cron + pg_net) e limpeza diária
--
-- Este arquivo NÃO é uma migration: ele é aplicado no painel do Supabase (SQL
-- editor) DEPOIS de as migrations 0001..0004 estarem aplicadas e de os segredos
-- existirem no Vault. Ele depende do projeto (o endereço da função sai do Vault),
-- por isso vive fora de supabase/migrations/ e é aplicado à mão, uma vez.
--
-- O que ele cria (dois trabalhos do pg_cron):
--   1. gatilho-envia-3min     — a cada 3 min, POST em net.http_post na Edge
--      Function gatilho-envia (a rodada de DMs);
--   2. gatilho-limpeza-diaria — 1x por dia, chama public.limpar_dados_antigos()
--      (0004_limpeza.sql).
--
-- A CHAVE E O ENDEREÇO NÃO ESTÃO AQUI. O trabalho lê os dois do Vault na hora em
-- que roda (vault.decrypted_secrets). Crie os segredos antes, com ESTES NOMES:
--
--   gatilho_envia_url   → o endereço completo da função gatilho-envia
--   gatilho_cron_chave  → o MESMO valor do secret GATILHO_CRON_CHAVE da função
--
-- Os valores são criados pelo Maxwel no painel, nunca em arquivo, no chat ou no
-- repositório. Passo a passo em supabase/README-agendador.md.
--
-- POR QUE ESTE ARQUIVO GRITA SE FALTAR EXTENSÃO: pg_cron, pg_net e o Vault se
-- ligam no painel (Database → Extensions). Sem elas, o bloco abaixo falha com
-- uma mensagem clara em vez de criar um trabalho pela metade.
-- ============================================================================

do $checagem$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise exception 'Habilite pg_cron, pg_net e o Vault no projeto antes deste arquivo (veja supabase/README-agendador.md).';
  end if;
end
$checagem$;

-- Sem os dois segredos, o trabalho mandaria chave nula e tomaria 401 calado para
-- sempre. Melhor falhar agora, com o nome do que falta.
do $segredos$
declare
  faltando text;
begin
  select string_agg(nome, ', ')
    into faltando
    from (values ('gatilho_envia_url'), ('gatilho_cron_chave')) as s(nome)
   where not exists (select 1 from vault.decrypted_secrets v where v.name = s.nome);

  if faltando is not null then
    raise exception 'Faltam segredos no Vault: %. Crie os dois antes de agendar (veja supabase/README-agendador.md).', faltando;
  end if;
end
$segredos$;

-- Rodar de novo não duplica: derruba o trabalho de mesmo nome, se já existir.
select cron.unschedule(jobid)
  from cron.job
 where jobname in ('gatilho-envia-3min', 'gatilho-limpeza-diaria');

-- 1. A rodada de DMs, de 3 em 3 minutos. A chave entra no cabeçalho x-cron-chave
-- lida do Vault agora; o corpo vai vazio (a função não usa corpo).
select cron.schedule(
  'gatilho-envia-3min',
  '*/3 * * * *',
  $trabalho$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'gatilho_envia_url'),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'gatilho_cron_chave')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $trabalho$
);

-- 2. A limpeza, uma vez por dia (04:00 UTC = 01:00 em São Paulo).
select cron.schedule(
  'gatilho-limpeza-diaria',
  '0 4 * * *',
  $trabalho$
    select public.limpar_dados_antigos();
  $trabalho$
);


-- ============================================================================
-- CONFERÊNCIA depois de aplicar:
--
--   -- os dois trabalhos e quando rodam
--   select jobid, jobname, schedule, active from cron.job order by jobname;
--
--   -- as últimas execuções (status e retorno)
--   select jobid, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
--
--   -- o corpo de cada trabalho NÃO tem chave escrita: só o NOME do segredo
--   select jobname, command from cron.job order by jobname;
--     -- esperado: 'gatilho_cron_chave' aparece como nome dentro do select do
--     -- Vault; nenhuma chave literal e nenhum endereço escrito.
-- ============================================================================
