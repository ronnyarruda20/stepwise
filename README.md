---
titulo: "Stepwise"
id: pessoal-stepwise-readme
projeto: pessoal
tipo: referencia
status: vivo
rag: incluir
precedencia: 60
atualizado: 2026-10-09
verificado_em: 2026-10-09
fonte_de_verdade_para: []
nao_usar_para: [copy, estado-atual, preco-publico]
substituido_por: null
tags: [stepwise, worker, cloudflare, ia]
resumo: >
  README de CÓDIGO do Stepwise (nome provisório do Ronny, 08/10/2026): app de conversação em inglês com IA para brasileiros — prova de nivelamento por voz (CEFR) e conversa com correção que lembra os erros de cada perfil; PWA para iPhone, Worker Cloudflare + D1 na conta da Growth (não é o VPS), IA de texto pela API da DeepSeek direto desde 09/10 (antes Claude; nunca o 9router) e voz pelo Workers AI (Whisper e Aura-2). Como rodar no PC, as suítes de prova em modo falso (59 regras + 45 da ligação com a IA + 51 ponta a ponta + 10 do login aberto), a sonda da IA de verdade e a ordem para ir ao ar. Não decide nada — aponta o docs/00-estado.md.
---

# Stepwise

Conversação em inglês com IA, para brasileiros: **prova de nivelamento por voz** (escala CEFR) e **conversa com
correção** que lembra os erros de cada pessoa. App de navegador (PWA) pensado para o iPhone. Worker Cloudflare +
D1 na conta da Growth Tech, IA de texto pela API da DeepSeek (desde 09/10/2026; antes Claude) e voz pelo Workers AI.

- Estado, decisões, riscos e os botões do Ronny: [`docs/00-estado.md`](docs/00-estado.md)
- Como a prova mede o nível: [`docs/01-prova-de-nivelamento.md`](docs/01-prova-de-nivelamento.md)

## Rodar no PC

```bash
npm install
cp .dev.vars.exemplo .dev.vars   # e preencha a DEEPSEEK_API_KEY no seu terminal
npm run db:local
npm run worker:dev               # http://localhost:8810 → "Entrar (modo local)"
```

O microfone funciona em `localhost`. No celular, só com HTTPS, ou seja, depois do deploy.
Com `IA_FALSA=1` no `.dev.vars` nada sai da máquina: as respostas são fixas.

## Testar

```bash
npm run teste          # regras (59) + ligação com a IA (45) + ponta a ponta (51) + login aberto (10), em modo falso
npm run sonda:ia       # uma chamada de verdade a cada função da IA, com a chave do .dev.vars (frações de centavo)
```

O `teste:rota` sobe o próprio `wrangler dev` na porta 8811, com banco em `.wrangler/teste`, e derruba pela raiz
da árvore no fim. Rode **uma suíte por vez**.

## Ir ao ar

Na ordem do `docs/00-estado.md` §4: chave da DeepSeek → `wrangler d1 create stepwise` (trocar o id no
`wrangler.jsonc`) → `npm run db:remoto` → `wrangler secret put` (4 segredos) → redirect URI no Google →
`npm run deploy`.

## Mapa

| Arquivo | O quê |
|---|---|
| `worker/index.js` | rotas da API, sessão, limite diário |
| `worker/regras.js` | escada da prova, medidas de fluência, nota final (puro, testado) |
| `worker/tarefas.js` | perguntas da prova, critérios por nível, temas de conversa |
| `worker/ia.js` | DeepSeek: juiz, avaliador, parceiro de conversa, relatório, conferência do schema (+ modo falso) |
| `worker/voz.js` | Workers AI: Whisper (ouvir) e Aura-2 (falar) |
| `worker/sessao.js` | login Google + cookie assinado (copiado do Bola Alta) |
| `public/` | o app: `app.js` (telas), `gravador.js` (WAV 16 kHz no iPhone e no Chrome) |
| `migrations/` | banco D1 |
| `scripts/` | as suítes de prova e a sonda da IA |
