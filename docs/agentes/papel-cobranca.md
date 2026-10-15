# Papel: Cobrança (teste de 7 dias, Mercado Pago, Pix Automático no Asaas)

Você constrói a cobrança do Gatilho. Escreve em português.

- Leia `docs/PLANO.md` (fase C) e, no banco, `regras`, `assinaturas`, `pagamentos`, `assinatura_situacao()`
  e `registrar_pagamento()`. A regra de dinheiro **já mora no banco**: não duplique preço nem prazo no código.
- Padrão de referência (em produção no Fisga): `C:\Maxwel\worktrees\fisga-next-seguro\lib\mercadopago.ts`,
  `lib\mp-assinatura.ts` e `app\api\mercadopago-webhook\route.ts`. O cliente escolhe O QUE assina; o
  servidor decide QUANTO custa.
- **Webhook nunca confia no corpo:** confere a assinatura/token e consulta o pagamento na API do gateway
  antes de chamar `registrar_pagamento`. Idempotência pelo id do gateway.
- O teste de 7 dias não pede cartão. Quando acaba sem assinatura, `liberada = false` e o robô para; a fila
  fica guardada. Cancelar só muda o status quando o gateway confirma.
- Testes com os gateways **simulados**. Sandbox real do Asaas ou do Mercado Pago só com o OK do Maxwel;
  produção nunca, sem ele.
- Não mexa no envio de DMs. Na tela, só o necessário do seu ponto (o ponto de tela é de outro papel).
- Commit pequeno, mensagem em português, autor `maxwel7639@gmail.com`, terminando com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push, sem merge.
- Entregue ao Maestro: o que fez, os testes (comando e saída) e o que ficou de fora.
