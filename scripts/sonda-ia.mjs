/* Sonda da IA de verdade: uma chamada a cada função de worker/ia.js contra a DeepSeek, com a chave do .dev.vars e
   os modelos do wrangler.jsonc. Mede tempo e tokens de cada uma. Custa frações de centavo. `npm run sonda:ia`.
   ⛔ Nunca imprime a chave. */

import { readFileSync } from "node:fs";
import { julgar, avaliarProva, conversar, relatorio } from "../worker/ia.js";

const vars = Object.fromEntries(
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const modelo = (nome) => (cfg.match(new RegExp(`"${nome}"\\s*:\\s*"([^"]+)"`)) || [])[1];
const env = { DEEPSEEK_API_KEY: vars.DEEPSEEK_API_KEY, MODELO_CONVERSA: modelo("MODELO_CONVERSA"), MODELO_AVALIACAO: modelo("MODELO_AVALIACAO") };
if (!env.DEEPSEEK_API_KEY) { console.log("falta DEEPSEEK_API_KEY no .dev.vars"); process.exit(1); }
console.log(`modelos: conversa ${env.MODELO_CONVERSA} · avaliação ${env.MODELO_AVALIACAO}\n`);

// Embrulha o fetch para medir cada chamada (inclusive as repetidas).
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const t0 = Date.now();
  const r = await fetchReal(url, init);
  const copia = await r.clone().json().catch(() => null);
  const u = (copia && copia.usage) || {};
  const pensou = (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
  console.log(`  ↳ HTTP ${r.status} em ${((Date.now() - t0) / 1000).toFixed(1)} s · entrada ${u.prompt_tokens ?? "?"} (cache ${u.prompt_cache_hit_tokens ?? 0}) · saída ${u.completion_tokens ?? "?"} (pensando ${pensou}) · fim ${copia && copia.choices ? copia.choices[0].finish_reason : "?"}`);
  return r;
};

let falhas = 0;
async function etapa(nome, fn, resumo) {
  console.log(nome);
  try {
    console.log("  = " + resumo(await fn()));
  } catch (e) {
    falhas++;
    console.log("  ✗ " + (e && e.message));
  }
}

const medidas = { palavras: 9, duracao_s: 4.2, ppm: 128, pausas_longas: 0, hesitacoes: 1 };
await etapa("juiz (B1)", () => julgar(env, {
  tarefa: { nivel: "B1", texto: "Tell me about a trip you really enjoyed. What happened?", criterio: "Narrates a past experience with connected sentences and past tenses." },
  resposta: "last year I go to Salvador with my husband and we eat a lot of acarajé and the beach was beautiful",
  medidas,
}), (d) => `passou=${d.passou} · ${d.motivo_pt} · "${d.reacao_en}"`);

await etapa("conversa (abertura)", () => conversar(env, { nome: "Maria", nivel: "A2", tema: "dia-a-dia", historico: [], errosRecorrentes: [] }),
  (d) => `"${d.resposta}"`);

await etapa("conversa (com erro típico)", () => conversar(env, {
  nome: "Maria", nivel: "A2", tema: "dia-a-dia",
  historico: [{ papel: "ia", texto: "Hi Maria! How old are you, if you don't mind me asking?" }, { papel: "aluno", texto: "I have 34 years and I am nurse in a hospital" }],
  errosRecorrentes: [],
}), (d) => `"${d.resposta}" · correções: ${d.correcoes.map((c) => `${c.errado} → ${c.certo} [${c.categoria}]`).join("; ") || "nenhuma"}`);

const fala = (nivel, tarefa, texto) => ({ tipo: "fala", nivel, tarefa, texto, medidas: { palavras: texto.split(" ").length, ppm: 110, pausas_longas: 1 } });
await etapa("avaliação final (1 rodada)", () => avaliarProva(env, {
  respostas: [
    fala("A2", "What do you usually do on weekends?", "on weekends I go to the church and I visit my mother, she lives near"),
    fala("B1", "Tell me about a trip you really enjoyed.", "last year I go to Salvador with my husband and we eat a lot of acarajé and the beach was beautiful"),
    fala("B1", "What would you change in your city?", "I think the traffic is very bad, people is always in hurry, I would put more bus"),
    { tipo: "escuta", nivel: "B1", tarefa: "Listening: why was the man late?", texto: "because the train was late", medidas: { palavras: 5, ppm: 100, pausas_longas: 0 } },
  ],
  escada: "B1", escutaPassou: true,
  medidas: { respostas: 3, palavras_por_resposta: 18, ppm_medio: 110, pausas_por_minuto: 2 },
}), (d) => `geral ${d.notas.geral} (voc ${d.notas.vocabulario} · gram ${d.notas.gramatica} · flu ${d.notas.fluencia} · comp ${d.notas.compreensao}) · prioridades: ${d.prioridades.map((p) => p.tema).join(" / ")}`);

await etapa("relatório da conversa", () => relatorio(env, {
  nivel: "A2",
  historico: [
    { papel: "ia", texto: "Hi Maria! What did you do yesterday?" },
    { papel: "aluno", texto: "yesterday I work all day in the hospital, I was very tired" },
    { papel: "ia", texto: "Oh, you worked all day! That sounds exhausting. What do you do to relax?" },
    { papel: "aluno", texto: "I watch series and I eat chocolate" },
  ],
  correcoes: [{ errado: "I work all day", certo: "I worked all day" }],
}), (d) => `sinal ${d.sinal} · ${d.resumo_pt}`);

console.log(falhas ? `\n${falhas} etapa(s) falharam` : "\ntodas as etapas responderam");
process.exit(falhas ? 1 : 0);
