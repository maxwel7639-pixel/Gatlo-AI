-- ============================================================================
-- Gatilho · reserva do envio (fase B2)
--
-- Nada aqui foi aplicado ainda. Vem depois da 0001_esquema.sql.
--
-- POR QUÊ: antes de falar com a Meta, a Edge Function `gatilho-envia` RESERVA o
-- comentário (dm_tentativas + 1, num UPDATE atômico) para que duas rodadas do cron
-- nunca mandem a mesma DM. Se a função morrer entre reservar e gravar o resultado,
-- a linha ficava com dm_tentativas > 0, sem dm_em e sem dm_erro, para sempre: nem
-- enviada nem com erro.
--
-- Esta coluna diz QUANDO a reserva foi feita. Com ela:
--  - reserva recente = rodada ainda em voo: ninguém mais pega a linha;
--  - reserva velha (muito mais que a rodada mais longa possível) = rodada que morreu:
--    a fila volta a oferecer a linha, uma vez (dm_tentativas = 1 -> 2). Presa de novo
--    (dm_tentativas >= 2), a função marca dm_erro 'rodada interrompida' e desiste.
--
-- Por que reenviar é seguro: a Meta só aceita UMA resposta privada por comentário. Se a
-- rodada morreu depois de a Meta aceitar a DM, a nova tentativa volta como erro (vira
-- dm_erro) e a pessoa não recebe a DM duas vezes.
--
-- Sem função nova, sem mudar grant nem política: a coluna herda os grants da tabela
-- (anon sem nada; authenticated só lê, e só as próprias linhas; service_role tudo).
-- Sem índice novo: a fila já usa comentarios_fila_idx (conta_id, recebido_em) parcial
-- em dm_em nulo e dm_erro nulo, e a condição nova só filtra dentro dessas linhas.
-- ============================================================================

alter table public.comentarios add column dm_reservado_em timestamptz;

comment on column public.comentarios.dm_reservado_em is
  'Quando o envio reservou a linha (junto com dm_tentativas + 1). Nulo = ninguém está enviando. Devolvido a nulo quando a Meta manda esperar.';
