# Gatlo AI

SaaS da MX Digital: o cliente conecta o Instagram dele, escolhe um post (ou qualquer post), define a
palavra-chave e a mensagem com link, e **quem comentar a palavra recebe o link na DM**, numa fila que
respeita o limite do Instagram.

> "Gatlo AI" é nome provisório. Pra trocar, muda `PRODUTO.nome` em `lib/config.ts`: telas, títulos e
> páginas legais leem daí.

Fases e o que falta: [`docs/PLANO.md`](docs/PLANO.md).

---

## Abrir em modo demonstração (sem Supabase e sem app da Meta)

```bash
npm install
npm run dev
```

Abre **http://localhost:3000** e:

1. **Teste 7 dias grátis** → cria uma conta qualquer (fica só no teu computador, em `.gatilho-demo/`).
2. **Conectar perfil fictício** → conecta o "Café da Serra" (perfil e posts inventados).
3. **Posts** → escolhe um post → **Criar automação** (palavra, mensagem, link; a prévia mostra como chega no celular).
4. No detalhe da automação, **Simular comentários** mostra a fila, as DMs, os erros e os cliques.

Nada nesse modo fala com a Meta. Pra começar do zero, apaga a pasta `.gatilho-demo/`.

### Os modos

| Variáveis preenchidas | Banco e login | Instagram |
|---|---|---|
| nenhuma (`npm run dev`) | arquivo local `.gatilho-demo/banco.json` | fictício |
| Supabase | Supabase | fictício (até ter o app da Meta) |
| Supabase + `INSTAGRAM_APP_ID/SECRET` | Supabase | de verdade |
| qualquer uma + `GATILHO_DEMO=1` | (como acima) | fictício |

Em produção (`npm run build && npm start`) sem Supabase, o app só sobe com `GATILHO_DEMO=1`; sem isso,
avisa que falta configurar (uma variável apagada por engano não vira "cadastro que some").

---

## Comandos

| Comando | O quê |
|---|---|
| `npm run dev` | servidor de desenvolvimento (http://localhost:3000) |
| `npm run build` | build de produção |
| `npm run lint` | ESLint |
| `npm run tipos` | `tsc --noEmit` |

Stack: Next.js 16.4 (App Router, `proxy.ts`), React 19, Tailwind 4, `@supabase/ssr`. Fonte Figtree,
identidade MX (azul `#1E50F0`, texto `#7FA6FF`, fundo `#07090C`), tema escuro.

---

## Estrutura

```
app/
  page.tsx                    início (o que faz, o que NÃO faz, a fila, preço)
  (conta)/                    entrar, cadastro, recuperar-senha, nova-senha
  painel/                     visão geral, posts, automacoes (nova, [id], [id]/editar), conta
  termos, privacidade, exclusao-de-dados
  l/[codigo]/route.ts         link curto da DM: conta o clique e redireciona
  api/instagram/conectar      início do login do Instagram (state em cookie)
  api/instagram/callback      volta do login: troca code → token curto → token longo (cifrado)
  api/instagram/desautorizar  aviso da Meta: removeu o app
  api/instagram/exclusao      aviso da Meta: pedido de exclusão de dados
  api/cron/renovar-tokens     cron diário da Vercel (vercel.json)
  auth/confirmar              links de e-mail do Supabase
  demo/                       miniaturas e foto em SVG do modo demonstração
lib/
  config.ts                   NOME do produto e endereço do site
  env.ts                      qual modo está ligado
  regras.ts                   lê a tabela `regras` (preço, teste, freios da fila)
  dados/                      repositório: Supabase e banco local, mesmo contrato
  instagram/                  API da Meta, perfil fictício, avisos da Meta
  auth/                       sessão e ações de login/cadastro/senha
  palavras.ts                 palavra-chave sem acento/maiúscula (a mesma regra vai pro robô)
  cripto.ts                   cifra AES-256-GCM do token (formato compatível com WebCrypto)
  taxa.ts                     trava de taxa (no banco)
supabase/migrations/0001_esquema.sql
docs/PLANO.md
```

---

## Segurança (o que já está garantido)

- **Token do Instagram** nunca vai pro navegador: tabela `tokens_instagram` sem nenhuma permissão pra
  `anon`/`authenticated`, cifrado no servidor com `GATILHO_CHAVE_TOKENS`, lido só com a service role.
- **RLS por dono** em todas as tabelas, sem `using (true)`. O usuário só escreve em `automacoes` (coluna
  por coluna) e no próprio nome. Status de assinatura, código do link e dono da linha, ninguém edita.
- **Nenhuma função SECURITY DEFINER executável por anon/authenticated**; a migration também tira o
  `execute` padrão do Supabase das funções novas. A conferência está no fim do arquivo SQL.
- **Regras de dinheiro numa lista só** (tabela `regras`), lidas pelo banco e pelo servidor; o navegador
  nunca manda preço nem prazo.
- **Trava de taxa** no banco (login, cadastro, senha, conectar, salvar automação, clique).
- **Cabeçalhos**: CSP (script e conexão só do próprio site), `frame-ancestors 'none'`, HSTS, nosniff,
  referrer e permissions policy. Sem otimizador de imagem do Next.
- Login do Instagram com `state` aleatório em cookie httpOnly, amarrado ao usuário logado.
- Avisos da Meta e cron só com assinatura/segredo conferidos (comparação em tempo constante).
- `npm audit` acusa 5 falhas "altas" só no ESLint (`braces` dentro do `eslint-config-next`), ferramenta
  de desenvolvimento: não vai pro site.

---

## Ligando o Supabase (quando o projeto existir)

1. Criar um projeto **novo** (região São Paulo) e rodar `supabase/migrations/0001` a `0008`, **em ordem**, no SQL
   Editor (ou `supabase db push`). Rodar as consultas de conferência do fim de cada arquivo.
2. Preencher `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.
3. **Authentication → Providers → Email**: confirmação de e-mail ligada, senha mínima 8, proteção de senha
   vazada ligada. **URL Configuration**: Site URL = `NEXT_PUBLIC_SITE_URL`.
4. **Authentication → Email Templates** (os links apontam direto pro app, como no Fisga):
   - Confirm signup: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=signup`
   - Reset password: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery`

## Ligando o Instagram de verdade

Passo a passo do app da Meta (redirect URI, URLs de desautorização e exclusão, testadores, revisão):
seção **"O que o MAXWEL precisa fazer"** do [`docs/PLANO.md`](docs/PLANO.md). Depois, preencher
`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `GATILHO_CHAVE_TOKENS` e `NEXT_PUBLIC_SITE_URL` (a Meta só
aceita redirect em `https`, então o teste real é no endereço publicado).
