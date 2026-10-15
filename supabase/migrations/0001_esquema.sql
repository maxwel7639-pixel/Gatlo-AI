-- ============================================================================
-- Gatilho · esquema da fase A
--
-- Projeto Supabase PRÓPRIO (nada a ver com o banco do CRM: lição da análise de
-- segurança do Fisga, 14/10/2026). Nada aqui foi aplicado ainda.
--
-- REGRAS DE SEGURANÇA DESTE ARQUIVO (e de qualquer migration nova):
--  1. Toda tabela com RLS ligada. Política só "o dono lê o que é dele"; nenhuma
--     política `using (true)`.
--  2. anon não lê nem grava NADA. authenticated recebe só o mínimo, coluna por
--     coluna onde há escrita (o usuário nunca edita campo sensível: status de
--     assinatura, código do link, dono da linha, token).
--  3. Nenhuma função executável por anon. As SECURITY DEFINER são chamadas só
--     pelo servidor (service role) ou por gatilho do banco, e cada uma revoga o
--     execute do PUBLIC, do anon e do authenticated. A única liberada pro
--     authenticated (numeros_automacoes) é SECURITY INVOKER: o RLS vale nela.
--  4. O token do Instagram fica numa tabela sem acesso nenhum pela API pública
--     e CIFRADO (a chave só existe na variável GATILHO_CHAVE_TOKENS do servidor).
-- ============================================================================

-- O Supabase dá execute em toda função nova do schema public para anon e
-- authenticated, e acesso total a toda tabela nova. Aqui isso deixa de ser o
-- padrão: o que for liberado é liberado de propósito, linha a linha.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;


-- ============================================================================
-- 1. REGRAS: a lista única do que decide dinheiro e limite
--
-- Preço, teste, carência e os freios da fila de envio. O cadastro (trial_ate),
-- a situação da assinatura e o registro de pagamento leem daqui; o servidor
-- (lib/regras.ts) e o robô da fase B também. Mudou o preço? É aqui.
-- ============================================================================
create table public.regras (
  chave     text primary key,
  valor     numeric not null,
  descricao text not null
);
alter table public.regras enable row level security;
revoke all on public.regras from anon, authenticated;

insert into public.regras (chave, valor, descricao) values
  ('preco_mensal_centavos',       9790, 'Preço da assinatura mensal em centavos (R$ 97,90).'),
  ('teste_dias',                     7, 'Dias de teste grátis, contados do cadastro. Sem cartão.'),
  ('carencia_dias',                  3, 'Dias depois do fim do período pago em que a automação ainda roda, enquanto a renovação compensa.'),
  ('envio_max_por_rodada',           6, 'Quantas DMs o robô manda por conta a cada rodada de 3 min (~120 por hora).'),
  ('envio_intervalo_segundos',       5, 'Pausa entre uma DM e outra da mesma conta.'),
  ('envio_pausa_direct_min',       180, 'Quando a Meta recusa a DM por volume, a conta para de mandar DM por este tempo.'),
  ('envio_pausa_resposta_min',      45, 'Quando a Meta recusa a resposta pública por volume, a conta para de responder por este tempo.'),
  ('respostas_publicas_max_24h',   200, 'Acima disso em 24 h, a conta só manda a DM (sem resposta pública), pra gastar metade das ações.'),
  ('janela_resposta_privada_dias',   7, 'Regra da Meta: resposta privada só até 7 dias depois do comentário.'),
  ('fila_janela_dias',               6, 'Quanto tempo um comentário espera na fila (1 dia de folga antes do limite da Meta).');

-- Lê uma regra. Sem a regra, ERRO (e não um valor inventado): é melhor o
-- cadastro falhar alto do que criar um teste de duração errada.
create or replace function public.regra(p_chave text)
returns numeric
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v numeric;
begin
  select valor into v from public.regras where chave = p_chave;
  if v is null then
    raise exception 'regra % não existe na tabela regras', p_chave;
  end if;
  return v;
end;
$$;
revoke execute on function public.regra(text) from public, anon, authenticated;


-- ============================================================================
-- 2. Carimbo de "atualizado em"
-- ============================================================================
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
revoke execute on function public.tocar_atualizado_em() from public, anon, authenticated;


-- ============================================================================
-- 3. PERFIS
-- ============================================================================
create table public.perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text check (char_length(nome) <= 80),
  criado_em timestamptz not null default now()
);
alter table public.perfis enable row level security;
revoke all on public.perfis from anon, authenticated;
grant select on public.perfis to authenticated;
-- Pela tela, o usuário só muda o nome. Mais nada.
grant update (nome) on public.perfis to authenticated;

create policy perfis_dono_le on public.perfis
  for select to authenticated using (id = (select auth.uid()));
create policy perfis_dono_edita on public.perfis
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));


-- ============================================================================
-- 4. ASSINATURAS e PAGAMENTOS
--
-- O usuário só LÊ. Quem grava é o banco (cadastro) e o servidor, depois de
-- conferir o pagamento na API do gateway (fase C).
-- ============================================================================
create table public.assinaturas (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  status                text not null default 'trial'
                        check (status in ('trial', 'ativa', 'vencida', 'cancelada')),
  trial_ate             timestamptz not null,
  gateway               text check (gateway in ('mercadopago', 'asaas')),
  gateway_assinatura_id text,
  gateway_cliente_id    text,
  valor_centavos        int check (valor_centavos >= 0),
  -- até quando está pago (cada pagamento aprovado empurra 1 mês)
  periodo_ate           timestamptz,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  unique (gateway, gateway_assinatura_id)
);
alter table public.assinaturas enable row level security;
revoke all on public.assinaturas from anon, authenticated;
grant select on public.assinaturas to authenticated;
create policy assinaturas_dono_le on public.assinaturas
  for select to authenticated using (user_id = (select auth.uid()));
create trigger assinaturas_atualizado_em before update on public.assinaturas
  for each row execute function public.tocar_atualizado_em();

create table public.pagamentos (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) on delete set null,
  gateway              text not null check (gateway in ('mercadopago', 'asaas')),
  gateway_pagamento_id text not null,
  status               text not null check (status in ('aprovado', 'valor_divergente', 'estornado')),
  valor_centavos       int not null check (valor_centavos >= 0),
  pago_em              timestamptz,
  criado_em            timestamptz not null default now(),
  -- IDEMPOTÊNCIA: o gateway reenvia a mesma notificação várias vezes; o mesmo
  -- pagamento nunca credita duas vezes.
  unique (gateway, gateway_pagamento_id)
);
alter table public.pagamentos enable row level security;
revoke all on public.pagamentos from anon, authenticated;
grant select on public.pagamentos to authenticated;
create policy pagamentos_dono_le on public.pagamentos
  for select to authenticated using (user_id = (select auth.uid()));
create index pagamentos_user_idx on public.pagamentos (user_id, criado_em desc);


-- ============================================================================
-- 5. CADASTRO: perfil + 7 dias de teste, junto com a criação da conta
--
-- Gatilho do banco (e não o app) porque a conta pode nascer pela porta direta
-- do Supabase Auth, sem passar pelo app. O teste é sempre cadastro + teste_dias.
-- ============================================================================
create or replace function public.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'nome', '')), 80), ''));

  insert into public.assinaturas (user_id, status, trial_ate)
  values (new.id, 'trial', new.created_at + make_interval(days => public.regra('teste_dias')::int));

  return new;
end;
$$;
revoke execute on function public.ao_criar_usuario() from public, anon, authenticated;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();


-- ============================================================================
-- 6. A SITUAÇÃO DA ASSINATURA: o único lugar que decide se a automação roda
--
-- Usada pelo painel (via servidor) e pelo robô da fase B. "liberada" = pode
-- mandar DM. Teste vencido aparece como 'vencida' mesmo antes de um cron
-- trocar o status na tabela.
-- ============================================================================
create or replace function public.assinatura_situacao(p_user_id uuid)
returns table (
  status         text,
  liberada       boolean,
  trial_ate      timestamptz,
  periodo_ate    timestamptz,
  dias_restantes int
)
language sql stable
security definer
set search_path = public
as $$
  select
    case
      when a.status = 'trial' and a.trial_ate <= now() then 'vencida'
      when a.status = 'ativa' and (a.periodo_ate is null
        or a.periodo_ate + make_interval(days => public.regra('carencia_dias')::int) <= now()) then 'vencida'
      else a.status
    end,
    case
      when a.status = 'trial' then a.trial_ate > now()
      when a.status = 'ativa' then a.periodo_ate is not null
        and a.periodo_ate + make_interval(days => public.regra('carencia_dias')::int) > now()
      else false
    end,
    a.trial_ate,
    a.periodo_ate,
    greatest(0, ceil(extract(epoch from (
      case when a.status = 'trial' then a.trial_ate else coalesce(a.periodo_ate, now()) end
    ) - now()) / 86400))::int
  from public.assinaturas a
  where a.user_id = p_user_id;
$$;
revoke execute on function public.assinatura_situacao(uuid) from public, anon, authenticated;


-- ============================================================================
-- 7. REGISTRAR PAGAMENTO APROVADO (fase C chama; a regra já mora aqui)
--
-- O servidor só chama depois de conferir o pagamento NA API do gateway (o
-- corpo do webhook nunca é fonte de verdade). Aqui:
--  - idempotência pelo unique (gateway, gateway_pagamento_id);
--  - valor abaixo do preço da tabela regras não libera nada;
--  - cada pagamento aprovado empurra o período em 1 mês.
-- Devolve true quando liberou agora; false quando já tinha registrado ou o
-- valor não bateu.
-- ============================================================================
create or replace function public.registrar_pagamento(
  p_gateway               text,
  p_gateway_pagamento_id  text,
  p_user_id               uuid,
  p_valor_centavos        int,
  p_gateway_assinatura_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preco  int := public.regra('preco_mensal_centavos')::int;
  v_status text := case when p_valor_centavos >= v_preco then 'aprovado' else 'valor_divergente' end;
  v_id     uuid;
begin
  insert into public.pagamentos (gateway, gateway_pagamento_id, user_id, status, valor_centavos, pago_em)
  values (p_gateway, p_gateway_pagamento_id, p_user_id, v_status, p_valor_centavos, now())
  on conflict (gateway, gateway_pagamento_id) do nothing
  returning id into v_id;

  if v_id is null or v_status <> 'aprovado' then
    return false;
  end if;

  update public.assinaturas
  set status = 'ativa',
      gateway = p_gateway,
      gateway_assinatura_id = coalesce(p_gateway_assinatura_id, gateway_assinatura_id),
      valor_centavos = p_valor_centavos,
      periodo_ate = greatest(coalesce(periodo_ate, now()), now()) + interval '1 month'
  where user_id = p_user_id;

  return found;
end;
$$;
revoke execute on function public.registrar_pagamento(text, text, uuid, int, text)
  from public, anon, authenticated;


-- ============================================================================
-- 8. CONTAS DO INSTAGRAM e TOKENS
-- ============================================================================
create table public.contas_instagram (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- id da conta profissional (o "user_id" de /me): é o que chega no webhook
  ig_user_id    text not null,
  -- id do app para esse usuário (o "id" de /me): o que a Meta manda nos avisos
  -- de desautorização e de exclusão de dados
  ig_app_id     text,
  username      text not null,
  nome          text,
  foto_url      text,
  tipo_conta    text,
  seguidores    int,
  -- conta fictícia do modo demonstração: o robô ignora
  demonstracao  boolean not null default false,
  status        text not null default 'conectada'
                check (status in ('conectada', 'expirada', 'desconectada')),
  conectada_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- uma conta do Instagram num cadastro só (dois clientes não automatizam a mesma)
  unique (ig_user_id),
  -- fase A: um Instagram por cadastro
  unique (user_id)
);
alter table public.contas_instagram enable row level security;
revoke all on public.contas_instagram from anon, authenticated;
grant select on public.contas_instagram to authenticated;
create policy contas_dono_le on public.contas_instagram
  for select to authenticated using (user_id = (select auth.uid()));
create trigger contas_atualizado_em before update on public.contas_instagram
  for each row execute function public.tocar_atualizado_em();

-- SÓ o servidor (service role) lê e grava. Sem política nenhuma, de propósito:
-- com RLS ligada e sem política, a API pública não vê nem uma linha.
create table public.tokens_instagram (
  conta_id      uuid primary key references public.contas_instagram(id) on delete cascade,
  token_cifrado text not null,          -- "v1.<iv>.<cifra>" (lib/cripto.ts)
  expira_em     timestamptz,
  renovado_em   timestamptz,
  escopos       text[] not null default '{}',
  atualizado_em timestamptz not null default now()
);
alter table public.tokens_instagram enable row level security;
revoke all on public.tokens_instagram from anon, authenticated;
create trigger tokens_atualizado_em before update on public.tokens_instagram
  for each row execute function public.tocar_atualizado_em();
create index tokens_expira_idx on public.tokens_instagram (expira_em);


-- ============================================================================
-- 9. AUTOMAÇÕES
-- ============================================================================
create table public.automacoes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conta_id        uuid not null references public.contas_instagram(id) on delete cascade,
  nome            text not null check (char_length(nome) between 1 and 80),
  -- post específico (media_id) ou qualquer post da conta
  qualquer_post   boolean not null default false,
  media_id        text,
  -- retrato do post na hora de escolher, pra mostrar sem chamar a Meta
  media_permalink text,
  media_miniatura text,
  media_legenda   text check (char_length(media_legenda) <= 300),
  -- maiúscula e acento não contam (lib/palavras.ts)
  palavras        text[] not null
                  check (cardinality(palavras) between 1 and 10),
  -- 640 é o limite do texto do modelo de botão da Meta
  mensagem_dm     text not null check (char_length(mensagem_dm) between 1 and 640),
  link_url        text not null
                  check (link_url ~* '^https?://[^\s]+$' and char_length(link_url) <= 2000),
  link_titulo     text not null check (char_length(link_titulo) between 1 and 20),
  -- resposta pública opcional no comentário ("te mandei na DM!")
  resposta_publica text check (char_length(resposta_publica) <= 300),
  ativa           boolean not null default true,
  -- o código do link curto /l/<codigo>; o banco sorteia, ninguém escolhe
  codigo          text not null unique
                  default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  check (qualquer_post or media_id is not null)
);
alter table public.automacoes enable row level security;
revoke all on public.automacoes from anon, authenticated;
grant select, delete on public.automacoes to authenticated;
-- coluna por coluna: user_id, codigo e as datas o usuário não escolhe
grant insert (conta_id, nome, qualquer_post, media_id, media_permalink, media_miniatura,
              media_legenda, palavras, mensagem_dm, link_url, link_titulo,
              resposta_publica, ativa)
  on public.automacoes to authenticated;
grant update (nome, qualquer_post, media_id, media_permalink, media_miniatura,
              media_legenda, palavras, mensagem_dm, link_url, link_titulo,
              resposta_publica, ativa)
  on public.automacoes to authenticated;

create policy automacoes_dono_le on public.automacoes
  for select to authenticated using (user_id = (select auth.uid()));
create policy automacoes_dono_cria on public.automacoes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.contas_instagram c
                where c.id = conta_id and c.user_id = (select auth.uid()))
  );
create policy automacoes_dono_edita on public.automacoes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy automacoes_dono_apaga on public.automacoes
  for delete to authenticated using (user_id = (select auth.uid()));

create trigger automacoes_atualizado_em before update on public.automacoes
  for each row execute function public.tocar_atualizado_em();

-- Freio contra abuso: até 50 automações por cadastro. Num gatilho, e não na
-- política de insert: política que consulta a própria tabela entra em
-- recursão infinita no Postgres.
create or replace function public.limite_automacoes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.automacoes where user_id = new.user_id) >= 50 then
    raise exception 'limite de 50 automações por cadastro' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.limite_automacoes() from public, anon, authenticated;
create trigger automacoes_limite before insert on public.automacoes
  for each row execute function public.limite_automacoes();
create index automacoes_user_idx on public.automacoes (user_id, criado_em desc);
create index automacoes_ativas_idx on public.automacoes (conta_id) where ativa;


-- ============================================================================
-- 10. COMENTÁRIOS (a fila de envio)
--
-- Quem grava é o robô da fase B (service role): o webhook da Meta põe o
-- comentário aqui e o envio marca dm_em / dm_erro / resposta_em.
-- A TRAVA contra mandar duas vezes é o unique do comment_id.
-- Na fila = dm_em nulo, dm_erro nulo e recebido há menos de fila_janela_dias.
-- ============================================================================
create table public.comentarios (
  id              uuid primary key default gen_random_uuid(),
  comment_id      text not null unique,
  user_id         uuid not null references auth.users(id) on delete cascade,
  conta_id        uuid not null references public.contas_instagram(id) on delete cascade,
  automacao_id    uuid references public.automacoes(id) on delete set null,
  media_id        text not null,
  autor_ig_id     text,
  autor_username  text,
  texto           text check (char_length(texto) <= 2200),
  palavra         text,
  comentado_em    timestamptz,                       -- quando a pessoa comentou (Meta)
  recebido_em     timestamptz not null default now(), -- quando o Gatilho viu
  dm_em           timestamptz,
  dm_erro         text,
  dm_tentativas   int not null default 0,
  igsid           text,                              -- id da pessoa no direct (volta da Meta)
  resposta_em     timestamptz,
  resposta_erro   text
);
alter table public.comentarios enable row level security;
revoke all on public.comentarios from anon, authenticated;
grant select on public.comentarios to authenticated;
create policy comentarios_dono_le on public.comentarios
  for select to authenticated using (user_id = (select auth.uid()));
create index comentarios_automacao_idx on public.comentarios (automacao_id, recebido_em desc);
create index comentarios_user_idx on public.comentarios (user_id, recebido_em desc);
create index comentarios_fila_idx on public.comentarios (conta_id, recebido_em)
  where dm_em is null and dm_erro is null;


-- ============================================================================
-- 11. PAUSA DE ENVIO, POR CONTA
--
-- Quando a Meta recusa por volume, SÓ aquela conta pausa (o robô do @maxwel_dev
-- tinha uma pausa global; aqui cada cliente tem a sua).
-- ============================================================================
create table public.envio_pausa (
  conta_id      uuid primary key references public.contas_instagram(id) on delete cascade,
  direct_ate    timestamptz,
  resposta_ate  timestamptz,
  motivo        text check (char_length(motivo) <= 300),
  avisado_em    timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.envio_pausa enable row level security;
revoke all on public.envio_pausa from anon, authenticated;
grant select on public.envio_pausa to authenticated;
create policy envio_pausa_dono_le on public.envio_pausa
  for select to authenticated
  using (exists (select 1 from public.contas_instagram c
                 where c.id = conta_id and c.user_id = (select auth.uid())));
create trigger envio_pausa_atualizado_em before update on public.envio_pausa
  for each row execute function public.tocar_atualizado_em();


-- ============================================================================
-- 12. CLIQUES no link curto /l/<codigo>
--
-- Não guarda IP: só uma impressão com sal (pra contar clique único).
-- ============================================================================
create table public.cliques (
  id            bigint generated always as identity primary key,
  automacao_id  uuid not null references public.automacoes(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  comentario_id uuid references public.comentarios(id) on delete set null,
  visitante     text,
  clicado_em    timestamptz not null default now()
);
alter table public.cliques enable row level security;
revoke all on public.cliques from anon, authenticated;
grant select on public.cliques to authenticated;
create policy cliques_dono_le on public.cliques
  for select to authenticated using (user_id = (select auth.uid()));
create index cliques_automacao_idx on public.cliques (automacao_id, clicado_em desc);
create index cliques_user_idx on public.cliques (user_id, clicado_em desc);


-- ============================================================================
-- 12b. NÚMEROS DE CADA AUTOMAÇÃO, numa consulta só (a lista do painel)
--
-- SECURITY INVOKER: roda como quem chama, então o RLS vale e cada um só conta
-- o que é seu. Por isso é a única função liberada pro authenticated (e mesmo
-- assim não pro anon, que não enxergaria nada).
-- ============================================================================
create or replace function public.numeros_automacoes(p_fila_desde timestamptz)
returns table (
  automacao_id uuid,
  comentarios  bigint,
  dms          bigint,
  na_fila      bigint,
  erros        bigint,
  cliques      bigint
)
language sql stable
security invoker
set search_path = public
as $$
  select
    a.id,
    count(c.id),
    count(c.dm_em),
    count(c.id) filter (where c.dm_em is null and c.dm_erro is null and c.recebido_em >= p_fila_desde),
    count(c.dm_erro),
    (select count(*) from public.cliques k where k.automacao_id = a.id)
  from public.automacoes a
  left join public.comentarios c on c.automacao_id = a.id
  where a.user_id = (select auth.uid())
  group by a.id;
$$;
revoke execute on function public.numeros_automacoes(timestamptz) from public, anon;
grant execute on function public.numeros_automacoes(timestamptz) to authenticated;


-- ============================================================================
-- 13. TRAVA DE TAXA (mesmo desenho do Fisga)
--
-- RLS ligada e nenhuma política: ninguém zera o próprio contador pela API.
-- ============================================================================
create table public.limite_taxa (
  chave         text primary key,
  contador      int not null default 0,
  janela_inicio timestamptz not null default now()
);
alter table public.limite_taxa enable row level security;
revoke all on public.limite_taxa from anon, authenticated;
create index limite_taxa_janela_idx on public.limite_taxa (janela_inicio);

create or replace function public.consumir_taxa(
  p_chave           text,
  p_limite          int,
  p_janela_segundos int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contador int;
  v_inicio   timestamptz;
begin
  -- limpeza oportunista (~1% das chamadas), sem cron
  if random() < 0.01 then
    delete from public.limite_taxa where janela_inicio < now() - interval '1 day';
  end if;

  insert into public.limite_taxa (chave, contador, janela_inicio)
  values (p_chave, 0, now())
  on conflict (chave) do nothing;

  -- FOR UPDATE: sem trava, N requisições simultâneas leriam o mesmo contador
  select contador, janela_inicio into v_contador, v_inicio
  from public.limite_taxa where chave = p_chave
  for update;

  if now() - v_inicio > make_interval(secs => p_janela_segundos) then
    update public.limite_taxa set contador = 1, janela_inicio = now() where chave = p_chave;
    return true;
  end if;

  if v_contador >= p_limite then
    return false;
  end if;

  update public.limite_taxa set contador = v_contador + 1 where chave = p_chave;
  return true;
end;
$$;
revoke execute on function public.consumir_taxa(text, int, int) from public, anon, authenticated;


-- ============================================================================
-- 14. PEDIDOS DE EXCLUSÃO DE DADOS (aviso da Meta)
--
-- A Meta manda o pedido; o servidor apaga e devolve um código pra pessoa
-- acompanhar em /exclusao-de-dados?codigo=...
-- ============================================================================
create table public.pedidos_exclusao (
  codigo         text primary key,
  ig_app_id      text,
  recebido_em    timestamptz not null default now(),
  concluido_em   timestamptz,
  contas_apagadas int not null default 0
);
alter table public.pedidos_exclusao enable row level security;
revoke all on public.pedidos_exclusao from anon, authenticated;


-- ============================================================================
-- 15. A service role (servidor e Edge Functions) executa as funções do servidor
-- ============================================================================
grant execute on function
  public.regra(text),
  public.assinatura_situacao(uuid),
  public.registrar_pagamento(text, text, uuid, int, text),
  public.consumir_taxa(text, int, int)
to service_role;

-- ============================================================================
-- CONFERÊNCIA depois de aplicar:
--
--   -- função do public que o anon ou o authenticated consegue executar
--   -- (tem que voltar SÓ numeros_automacoes, e só pro authenticated)
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as logado
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and (has_function_privilege('anon', p.oid, 'execute')
--          or has_function_privilege('authenticated', p.oid, 'execute'));
--
--   -- tabela do public sem RLS (tem que voltar VAZIA)
--   select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
-- ============================================================================
