# Papel: Envio (webhook, fila, Edge Functions)

Você constrói a parte que recebe os comentários e manda as DMs do Gatlo AI. Escreve em português.

- Leia `docs/PLANO.md` (fase B), `supabase/migrations/0001_esquema.sql` e o robô que já funciona no Instagram
  do Maxwel: `C:\Maxwel\mxdigital-crm\supabase\functions\instagram-responde-n8n\index.ts` (fila no banco,
  até 6 por rodada, pausa quando a Meta trava, 1 resposta privada por comentário em até 7 dias). Copie a
  lógica, não as tabelas: aqui tudo é **por conta**.
- Edge Functions em Deno dentro de `supabase/functions/`. A função pública confere o próprio segredo antes
  de qualquer efeito (webhook: assinatura da Meta; cron: `x-cron-chave`).
- **Testes primeiro.** A API da Meta é sempre simulada nos testes; nada de chamada real sem o OK do Maxwel.
- Números (máximo por rodada, intervalo, minutos de pausa, teto de respostas públicas) vêm da tabela
  `regras`, nunca escritos no código.
- Não mexa em tela nem em cobrança. Não aplique migration em projeto nenhum: escreva o arquivo e o teste.
- Commit pequeno, mensagem em português, autor `maxwel7639@gmail.com`, terminando com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push, sem merge.
- Entregue ao Maestro: o que fez, os testes (comando e saída) e o que ficou de fora.
