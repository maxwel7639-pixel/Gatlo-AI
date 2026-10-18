-- ============================================================================
-- 0004: limpeza dos dados antigos (promessa da política de privacidade)
--
-- O Gatilho guarda comentários e cliques por tempo limitado: passado o prazo,
-- eles não servem para mais nada (a fila só olha fila_janela_dias, 6 dias; a
-- resposta privada da Meta expira em 7) e a política de privacidade promete
-- apagar. Este arquivo traz a FUNÇÃO; quem a chama todo dia é o agendador
-- (supabase/agendador.sql), via pg_cron.
--
-- POR QUE A DIAS MORA NA TABELA `regras`: como preço, teste e os freios da fila,
-- o prazo é um número só. Mudar de 90 para 60 dias é um UPDATE em `regras`, sem
-- deploy e sem tocar em código.
--
-- SEGURANÇA: SECURITY DEFINER chamada só pelo agendador (postgres), revogada de
-- public, anon, authenticated e service_role — ninguém apaga nada pela API, nem
-- o servidor: quem limpa é o pg_cron, como dono. Sem política e sem grant novos:
-- as tabelas já têm RLS ligada e a limpeza não passa por RLS (roda como o dono).
-- search_path fixo, como manda a regra da casa.
-- ============================================================================

insert into public.regras (chave, valor, descricao) values
  ('limpeza_dias', 90, 'Dias que os comentários e os cliques ficam guardados antes de a limpeza apagar (o que a política de privacidade promete).'),
  ('limpeza_taxa_horas', 24, 'Horas que uma janela da trava de taxa fica guardada; passado isso, a limpeza apaga a linha.')
on conflict (chave) do nothing;

create or replace function public.limpar_dados_antigos()
returns table (comentarios_apagados int, cliques_apagados int, taxas_apagadas int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dias  int := public.regra('limpeza_dias')::int;
  v_horas int := public.regra('limpeza_taxa_horas')::int;
  c int;
  k int;
  t int;
begin
  -- Sem estes dois freios, um prazo 0 ou negativo apagaria a tabela inteira: a
  -- limpeza vem de `regras`, e regra errada tem que doer alto, não varrer o banco.
  if v_dias < 1 then
    raise exception 'regras.limpeza_dias tem que ser pelo menos 1 dia (veio %); limpeza nao apagou nada', v_dias;
  end if;
  if v_horas < 1 then
    raise exception 'regras.limpeza_taxa_horas tem que ser pelo menos 1 hora (veio %); limpeza nao apagou nada', v_horas;
  end if;

  -- Comentários mais velhos que o prazo. Apagar a linha leva junto o vínculo dos
  -- cliques (cliques.comentario_id é "on delete set null"); o clique em si só cai
  -- pela própria data, logo abaixo — nenhum clique sobrevive escondido.
  delete from public.comentarios
   where recebido_em < now() - make_interval(days => v_dias);
  get diagnostics c = row_count;

  delete from public.cliques
   where clicado_em < now() - make_interval(days => v_dias);
  get diagnostics k = row_count;

  -- Trava de taxa: a janela mais longa usada hoje é de segundos/minutos; 24 h é
  -- folga. (consumir_taxa já limpa de vez em quando; aqui é garantido.)
  delete from public.limite_taxa
   where janela_inicio < now() - make_interval(hours => v_horas);
  get diagnostics t = row_count;

  return query select c, k, t;
end;
$$;

revoke execute on function public.limpar_dados_antigos() from public, anon, authenticated, service_role;

comment on function public.limpar_dados_antigos() is
  'Apaga comentários, cliques e janelas de taxa mais velhos que o prazo. Roda uma vez por dia pelo agendador (supabase/agendador.sql). O prazo vem de regras.limpeza_dias.';


-- ============================================================================
-- CONFERÊNCIA depois de aplicar:
--
--   -- a função só é executável pelo dono (as três colunas têm que voltar FALSE)
--   select has_function_privilege('anon', 'public.limpar_dados_antigos()', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.limpar_dados_antigos()', 'execute') as logado,
--          has_function_privilege('service_role', 'public.limpar_dados_antigos()', 'execute') as servidor;
--
--   -- o prazo está na tabela regras
--   select valor from public.regras where chave = 'limpeza_dias';
-- ============================================================================
