# Pontos da obra (fases B, C e D)

Um ponto por vez, na ordem. O detalhe técnico de cada um está em `docs/PLANO.md`. **[OK do Maxwel]** = só
começa depois que ele disser "pode".

| # | Ponto | Papel | Pronto quando (a prova que o Maestro confere) |
|---|---|---|---|
| B1 | Edge Function `gatilho-webhook`: verificação do `hub.challenge`, assinatura `X-Hub-Signature-256`, filtro de palavra (mesma `palavraQueBateu` de `lib/palavras.ts`), insert com `on conflict (comment_id) do nothing`; inscrever a conta no webhook no fim do callback do OAuth | envio | Testes automatizados passando: assinatura errada → 401 sem tocar no banco; corpo de exemplo da Meta → 1 linha em `comentarios`; o mesmo corpo de novo → continua 1; comentário da própria conta e resposta a comentário ignorados; palavra com acento/maiúscula bate |
| B2 | Edge Function `gatilho-envia` (fila, intervalo, pausa **por conta**, resposta pública com teto de 24 h, botão com recaída para texto) | envio | Testes com a API da Meta simulada: envia e marca `dm_em`; erro de limite → `envio_pausa` preenchida, **sem** `dm_erro`, conta para; erro comum → `dm_erro`; botão recusado → reenvia como texto; `assinatura_situacao().liberada = false` → não envia nada; outra conta segue enviando enquanto uma está pausada |
| B2b | Consulta de reserva (ler comentários pela API enquanto não há webhook) | envio | Teste com API simulada: lê comentários novos, insere sem duplicar, respeita no máximo 1 leitura por post por rodada |
| B3 | Agendador (`pg_cron` + `pg_net`, chave no Vault) e limpeza de 90 dias | envio | SQL do agendador sem nenhuma chave escrita; teste da limpeza apagando só o que tem mais de 90 dias |
| R1 | Revisão de segurança da fase B | revisor | Relatório do revisor: nenhum achado alto aberto (funções, políticas, segredo, assinatura do webhook) |
| B4 | **[OK do Maxwel]** Teste real com conta testadora (precisa do app da Meta e do Supabase de desenvolvimento) | envio | Comentar de outra conta → DM chega com o botão (ou o texto), clique contado no painel, resposta pública aparece, e a pausa acontece ao forçar o limite |
| C1 | Assinatura no cartão (Mercado Pago `preapproval`): botão no painel, servidor decide o preço lendo `regras`, webhook consultando a API do MP → `registrar_pagamento` | cobrança | Testes com o MP simulado: webhook forjado não libera nada; pagamento aprovado libera e empurra o período 1 mês; o mesmo aviso duas vezes não credita dobrado; valor abaixo do preço não libera |
| C2 | Pix Automático (Asaas): autorização, webhook com token no cabeçalho, consulta da cobrança na API | cobrança | Os mesmos testes do C1 com o Asaas simulado; depois, com OK, um ciclo no sandbox do Asaas |
| C3 | Cancelar: `marcar_assinatura` (SECURITY DEFINER revogada do anon/authenticated) chamada pelos webhooks; botão "cancelar" que cancela no gateway | cobrança | Teste: cancelar no gateway → status muda só quando o gateway confirma; usuário não consegue mudar o status pela API |
| C4 | Tela `/painel/conta`: assinar (cartão ou Pix), situação do teste, próximo vencimento, cancelar | tela | Screenshots no celular e no computador (portal), em modo demonstração, com os estados: teste ativo, teste acabou, assinatura ativa, cancelada |
| R2 | Revisão de segurança da fase C | revisor | Relatório sem achado alto aberto |
| D1 | **[OK do Maxwel]** Supabase de produção: aplicar a migration e rodar a conferência do fim do arquivo | envio | Saída da conferência colada no Registro; verificador de segurança do Supabase sem erro |
| D2 | **[OK do Maxwel]** Vercel + subdomínio + variáveis; cron diário de renovação do token | tela | Site no ar no subdomínio; `/`, `/privacidade`, `/termos`, `/exclusao-de-dados` respondem 200; cabeçalhos de segurança presentes |
| D3 | **[OK do Maxwel]** Revisão do app na Meta: roteiro do vídeo do fluxo inteiro e os textos de cada permissão | revisor | Roteiro e textos prontos para o Maxwel enviar |

## Registro

| Data | Ponto | Branch | Prova |
|---|---|---|---|
| 14/10/2026 | Fase A | main (11 commits) | build, tsc e lint passando; fluxo completo testado no modo demonstração (celular e computador); migration testada num Postgres local imitando o Supabase |
| 15/10/2026 | B1 | b1-gatilho-webhook (8 commits) | `npm run teste:funcoes`: 38 passaram, 0 falharam (Postgres local com a migration 0001 inteira); `deno check` da função, tsc, lint e build passando (rodados pelo Maestro). Revisão do Vigia: 0 alto, 0 médio; 4 dos 5 baixos corrigidos. O 5º (inscrição que falha no callback só vai ao log) passa para o B2b |
| 15/10/2026 | B2 | b2-gatilho-envia (10 commits, sai da b1) | `npm run teste:funcoes`: 121 passaram, 0 falharam (Meta simulada, Postgres local com as migrations 0001 e 0002); `deno check` das duas funções, tsc e lint passando (rodados pelo Maestro). Além do plano: reserva atômica contra DM dupla com rodadas sobrepostas, recuperação da reserva presa (migration 0002, uma vez, depois de 10 min) e sorteio da ordem das contas. A 0002 tem que ser aplicada antes do deploy da função. Revisão de segurança: no R1 (fase B inteira) |
| 16/10/2026 | B3 | b3-agendador (3 commits, sai da b2b) | `npm run teste:funcoes`: 150 passaram, 0 falharam (14 novos: 7 da limpeza, num Postgres local aplicando as migrations 0001..0004; 7 do agendador, lendo e **executando** `supabase/agendador.sql` com pg_cron, pg_net e Vault falsos). SQL do agendador **sem chave e sem endereço escritos**: os dois saem de `vault.decrypted_secrets` na hora; faltando extensão ou segredo, o arquivo falha com aviso claro; rodar de novo não duplica. Limpeza apaga só comentários/cliques com mais de 90 dias (`regras.limpeza_dias`; taxa, 24 h), o clique cai pela própria data (não por arrasto do comentário) e prazo menor que 1 dia **recusa e não apaga nada**. A 0004 precisa ser aplicada e o `supabase/agendador.sql` rodado depois de D1/D2. **Aguarda revisão do Opus (mexe em banco e segredo).** |
