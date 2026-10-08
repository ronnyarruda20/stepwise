---
titulo: "Stepwise — a prova de nivelamento"
id: pessoal-stepwise-prova
projeto: pessoal
tipo: referencia
status: vivo
rag: incluir
precedencia: 60
atualizado: 2026-10-08
verificado_em: 2026-10-08
fonte_de_verdade_para: [prova-de-nivelamento-stepwise]
nao_usar_para: [copy, preco-publico]
substituido_por: null
tags: [stepwise, ia, prompt]
resumo: >
  Desenho da prova de nivelamento do Stepwise: ~10 min falando, aquecimento + escada adaptativa CEFR que começa em A2 (passou sobe, duas quedas fixam o teto, desce para conferir), escuta no nível do teto e nota final = mediana de 3 correções independentes do Sonnet 5.5 somada a medidas sem IA (palavras por minuto, pausas, hesitações). Prova às cegas, variante de perguntas por reprova, alerta de divergência escada × avaliador, ajuste contínuo pelas conversas (3 sinais iguais sugerem refazer) e o que falta para confiar na nota (calibração com gente de nível conhecido).
---

# Stepwise — a prova de nivelamento

> Como a IA mede o nível de inglês falado. Código em `worker/regras.js` (escada, medidas, nota),
> `worker/tarefas.js` (perguntas e critérios) e `worker/ia.js` (juiz e avaliador). Provas em
> `scripts/teste-regras.mjs`. Estado e riscos em [`00-estado.md`](00-estado.md).

## 1. O formato

Uns **10 minutos, tudo falando**, em quatro partes:

1. **Aquecimento** (não conta): nome e de onde é.
2. **Escada adaptativa.** Começa em **A2**. Cada resposta é julgada contra o critério do nível da pergunta:
   - **passou** → a próxima pergunta é do nível de cima;
   - **caiu uma vez** → outra pergunta do mesmo nível;
   - **caiu duas vezes** → se nunca passou no nível de baixo, desce para conferir; senão, o **teto** é o
     maior nível em que passou;
   - passou em C1 → teto C1 (C2 não se mede numa conversa curta);
   - trava de segurança: no máximo 8 perguntas.
3. **Escuta:** a IA fala um trecho do nível do teto e faz uma pergunta. Na tela o texto fica escondido.
4. **Nota final** (seção 3).

Caminhos medidos no teste: uma aluna A2 faz 3 perguntas da escada, e uma B2 faz 5. Somando o aquecimento e a
escuta, são de 5 a 7 falas.

**Às cegas:** durante a prova ninguém corrige e o app não mostra o veredito. A IA só reage ao conteúdo (*"Oh, a
nurse — that's a demanding job!"*), como numa prova de verdade.

**Variante:** a pergunta escolhida em cada nível muda conforme o número de provas que o perfil já fez, para
que refazer a prova não vire decorar as mesmas perguntas.

## 2. O juiz de cada resposta (Haiku 4.5)

Recebe o nível, a pergunta, o critério do nível, a transcrição e as medidas da fala. Devolve `passou`, um
motivo em português (fica no banco, não aparece para a aluna) e a reação em inglês. Na dúvida, reprova: a
pergunta seguinte confirma.

Os critérios são **paráfrases nossas** dos descritores do CEFR para produção oral, não o texto oficial do
Conselho da Europa. Ficam em `worker/tarefas.js`, e trocar um critério é editar uma linha.

## 3. A nota final

**Duas medidas independentes:**

- **Sem IA**, tiradas do tempo de cada palavra que o Whisper devolve: palavras por resposta, palavras por
  minuto, pausas longas (> 1,2 s) e hesitações (*um, uh, é…*).
- **Com IA:** o Sonnet 5.5 corrige a prova inteira **3 vezes, em paralelo e de forma independente**, com uma
  rubrica fixa. Cada rodada dá um nível por dimensão (vocabulário, gramática, fluência, compreensão) e um geral.

**A nota é a mediana das 3**, dimensão por dimensão. Com 2 rodadas válidas fica a menor das duas, para não
promover por empate; com menos de 2, a prova volta para "tentar de novo" e as respostas ficam salvas. O texto
(as 3 prioridades e o resumo) vem da rodada cuja nota geral é a mediana.

**Por que 3 e mediana:** o placar das 30 perguntas do robô do 48 oscilou de 26 a 29 entre rodadas iguais
(29/09/2026). Uma prova que dá A2 hoje e B1 amanhã para a mesma pessoa acaba com a confiança no app.

**Sinal de alerta:** se a escada e o avaliador discordam em 2 níveis ou mais, o resultado vale, mas a tela
sugere refazer a prova em alguns dias (`divergente`). O `espalhamento` entre as 3 rodadas fica guardado para
a calibração.

## 4. Ajuste contínuo

- Cada conversa termina com um relatório que diz se ela foi **acima**, **no** ou **abaixo** do nível.
  Três seguidas para o mesmo lado → o perfil sugere refazer a prova.
- O nível também pode ser **ajustado à mão** no perfil (fica no histórico como `manual`).
- Os **erros da conversa** (no máximo 2 por fala, só os que importam) vão para o banco e voltam na conversa
  seguinte: os 5 mais repetidos entram no prompt, e o parceiro cria chance de praticar justamente aquilo.

## 5. O que falta para confiar na nota

1. **Calibrar:** 3–5 pessoas de nível conhecido. O que se mede é se a nota bate e qual o espalhamento.
2. **Testar a transcrição com sotaque brasileiro de verdade**, porque o Whisper limpa erros (ver o
   `00-estado` §5).
3. **Ver se as perguntas funcionam com a Maria:** se alguma confunde ou trava, trocar o texto em
   `tarefas.js`.
