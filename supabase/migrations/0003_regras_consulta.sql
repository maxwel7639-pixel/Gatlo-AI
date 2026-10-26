-- ============================================================================
-- 0003: regras da leitura de reserva (consulta de comentários na Meta)
--
-- Enquanto o app da Meta não está Live com acesso avançado, o webhook não recebe
-- nada. Então a rodada do envio (gatilho-envia, a cada 3 min) lê os comentários
-- direto na Meta, por conta, antes de montar a fila de DMs. Estes dois números
-- limitam o quanto ela lê.
--
-- A conta do limite da Meta (~200 chamadas por hora por conta):
--   o agendador roda de 3 em 3 min  = 20 rodadas por hora;
--   cada rodada faz, por conta, no máximo 1 + M leituras
--     (1 lista de posts recentes, só se há automação de "qualquer post",
--      + 1 leitura de comentários por post, até M posts);
--   com M = 5 são 6 leituras por rodada = 20 x 6 = 120 chamadas por hora, no pior caso.
--   Contas com poucos posts gastam menos (sem automação ativa, nada).
-- O envio de DM e de resposta pública tem o seu próprio teto (envio_max_por_rodada,
-- respostas_publicas_max_24h). Se a Meta começar a recusar por volume, a leitura da
-- conta para até a rodada seguinte e a pausa de DM continua valendo; mexa aqui (baixe
-- consulta_posts_por_rodada) sem precisar de deploy.
-- ============================================================================
insert into public.regras (chave, valor, descricao) values
  ('consulta_posts_recentes_dias', 7, 'A leitura de reserva só olha posts publicados nos últimos N dias (para automações de "qualquer post"). Posts de automação de post específico são sempre lidos.'),
  ('consulta_posts_por_rodada',    5, 'Quantos posts da mesma conta a leitura de reserva lê a cada rodada de 3 min (1 leitura por post). Se houver mais posts, entram em rodízio, uma posição por rodada.')
on conflict (chave) do nothing;
