# Como montar a obra do Gatlo AI no Maestri

1. Abra o Maestri e crie um workspace novo chamado **gatilho**.
2. **Diretório do workspace: `C:\Maxwel\gatilho`.** Sem diretório, o `maestri floor` recusa (se já criou
   sem, arrume pelo menu da barra lateral → Editar workspace).
3. Crie um terminal de agente (Claude Code) nesse workspace, com o modelo mais forte (Opus).
4. Ligue o Maestro nesse terminal: selecione o terminal → ✏️ na barra → aba **Detalhes** → **Maestro** →
   Salvar. Não edite o `workspace.json` na mão.
5. No terminal do Maestro, cole:
   > Leia `docs/agentes/MAESTRO.md` e comece pelo primeiro ponto aberto de `docs/agentes/PONTOS.md`.
6. O Maestro cria um floor (worktree em `C:\Maxwel\worktrees`) por recruta. Recrutas em modelo leve
   (Sonnet); o revisor pode ser Sonnet também.
7. Os pontos com **[OK do Maxwel]** param e esperam você dizer "pode".

**Antes do B4 e do D1 a D3** você precisa ter feito a lista "O que o MAXWEL precisa fazer" do
`docs/PLANO.md` (app da Meta, Supabase novo, subdomínio, Asaas, Mercado Pago).
