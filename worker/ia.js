/* A IA de texto do Stepwise: o juiz de cada resposta da prova, o avaliador final, o parceiro de conversa e o
   relatório. Tudo pela API da DeepSeek (formato OpenAI, `fetch` puro, sem SDK), no lugar da Anthropic desde
   09/10/2026, a pedido do Ronny (D14 no docs/00-estado.md).
   ⛔ Nunca pelo 9router: ele não é alcançável daqui e a chave dele é a da produção do 48 (docs/00-estado.md §3).

   Conversa e juiz: MODELO_CONVERSA (deepseek-flash) SEM pensamento. Na DeepSeek o pensamento vem LIGADO por
   padrão, e com ele o juiz (max_tokens 600) gastaria o teto pensando e voltaria cortado.
   Avaliação final e relatório: MODELO_AVALIACAO (deepseek-v4-pro) COM pensamento.

   A DeepSeek não garante schema: o modo JSON só garante JSON válido. Por isso o schema vai escrito no prompt e a
   resposta é conferida aqui (`conferir`); o que vier fora dele conta como falha e é pedido de novo.

   Com env.__iaFalsa (só em localhost, ver index.js) nada sai da máquina: respostas fixas para os testes. */

import { NIVEIS } from "./regras.js";

export class ErroIA extends Error {
  constructor(motivo, detalhe, repete = false) {
    super(motivo + (detalhe ? ": " + detalhe : ""));
    this.motivo = motivo;
    this.repete = repete; // vale tentar de novo (servidor ocupado, rede, resposta vazia ou fora do schema)
  }
}

const NIVEL = { type: "string", enum: NIVEIS };

/* ---------- chamada base ---------- */

const URL_IA = "https://api.deepseek.com/chat/completions";
const TENTATIVAS = 3; // a 1ª + 2 de novo, como o maxRetries: 2 do SDK da Anthropic de antes

async function json(env, { avaliacao, system, messages, schema, maxTokens }) {
  if (!env.DEEPSEEK_API_KEY) throw new ErroIA("sem_chave", "DEEPSEEK_API_KEY não configurada");
  const corpo = {
    model: avaliacao ? env.MODELO_AVALIACAO : env.MODELO_CONVERSA,
    messages: [{ role: "system", content: system + instrucaoJSON(schema) }, ...messages],
    response_format: { type: "json_object" },
    thinking: { type: avaliacao ? "enabled" : "disabled" },
    // Com pensamento, o raciocínio entra na conta do max_tokens: folga grande (só se paga o que for usado).
    max_tokens: maxTokens || (avaliacao ? 32000 : 2000),
  };
  const passo = env.__esperaIA ?? 1000;
  for (let i = 1; ; i++) {
    try {
      return await chamar(env, corpo, schema);
    } catch (e) {
      if (!(e instanceof ErroIA) || !e.repete || i >= TENTATIVAS) throw e;
      await new Promise((ok) => setTimeout(ok, passo * i));
    }
  }
}

async function chamar(env, corpo, schema) {
  let r;
  try {
    r = await fetch(URL_IA, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.DEEPSEEK_API_KEY },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(corpo.thinking.type === "enabled" ? 240000 : 60000),
    });
  } catch (e) {
    throw new ErroIA("rede", String(e && e.message), true);
  }
  if (!r.ok) {
    const detalhe = r.status + " " + (await r.text().catch(() => "")).slice(0, 200);
    if (r.status === 401) throw new ErroIA("chave_invalida", detalhe);
    if (r.status === 402) throw new ErroIA("sem_saldo", detalhe);
    if (r.status === 429 || r.status === 503) throw new ErroIA("limite", detalhe, true);
    throw new ErroIA("api", detalhe, r.status >= 500);
  }
  const d = await r.json();
  const escolha = d.choices && d.choices[0];
  const fim = escolha && escolha.finish_reason;
  if (fim === "length") throw new ErroIA("cortou", "max_tokens");
  if (fim === "content_filter") throw new ErroIA("recusou", "content_filter");
  if (fim === "insufficient_system_resource") throw new ErroIA("limite", fim, true);
  // A própria DeepSeek avisa que o modo JSON às vezes devolve conteúdo vazio.
  const texto = (escolha && escolha.message && escolha.message.content) || "";
  if (!texto.trim()) throw new ErroIA("vazia", fim, true);
  let dados;
  try {
    dados = JSON.parse(extrairJSON(texto));
  } catch {
    throw new ErroIA("json_invalido", texto.slice(0, 200), true);
  }
  const c = conferir(schema, dados);
  if (c.erro) throw new ErroIA("fora_do_schema", c.erro, true);
  return { dados: c.valor, uso: d.usage };
}

function instrucaoJSON(schema) {
  return `\n\nOutput format: reply with ONE json object and nothing else (no markdown fences, no comments). It must follow this JSON Schema: every property is required, no extra properties, and enum strings must be written exactly as listed.\n${JSON.stringify(schema)}`;
}

/* Tira as cercas de markdown e o que vier em volta do objeto. */
export function extrairJSON(texto) {
  const t = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const ini = t.indexOf("{"), fim = t.lastIndexOf("}");
  return ini >= 0 && fim > ini ? t.slice(ini, fim + 1) : t;
}

/* Confere `valor` contra o schema (o subconjunto usado aqui: object, array, string, boolean, enum). Devolve
   { valor } já consertado — enum com a caixa trocada vira o certo ("b1" → "B1"), propriedade a mais sai —
   ou { erro } com o caminho do primeiro problema. */
export function conferir(schema, valor, caminho = "$") {
  if (schema.type === "object") {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return { erro: caminho + " não é objeto" };
    const saida = {};
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (!(k in valor)) {
        if ((schema.required || []).includes(k)) return { erro: caminho + "." + k + " faltando" };
        continue;
      }
      const r = conferir(sub, valor[k], caminho + "." + k);
      if (r.erro) return r;
      saida[k] = r.valor;
    }
    return { valor: saida };
  }
  if (schema.type === "array") {
    if (!Array.isArray(valor)) return { erro: caminho + " não é lista" };
    const saida = [];
    for (let i = 0; i < valor.length; i++) {
      const r = conferir(schema.items, valor[i], `${caminho}[${i}]`);
      if (r.erro) return r;
      saida.push(r.valor);
    }
    return { valor: saida };
  }
  if (schema.type === "boolean") return typeof valor === "boolean" ? { valor } : { erro: caminho + " não é booleano" };
  if (schema.type === "string") {
    if (typeof valor !== "string") return { erro: caminho + " não é texto" };
    if (!schema.enum || schema.enum.includes(valor)) return { valor };
    const certo = schema.enum.find((x) => x.toLowerCase() === valor.trim().toLowerCase());
    return certo ? { valor: certo } : { erro: `${caminho} = "${valor.slice(0, 40)}" fora de ${schema.enum.join("|")}` };
  }
  return { valor };
}

function obj(props) {
  return { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
}

/* ---------- juiz de uma resposta da prova ---------- */

const SCHEMA_JUIZ = obj({
  passou: { type: "boolean" },
  motivo_pt: { type: "string" },
  reacao_en: { type: "string" },
});

export async function julgar(env, { tarefa, resposta, medidas }) {
  if (env.__iaFalsa) return falsoJulgar(resposta);
  const system = `You are the examiner in a spoken English placement test for Brazilian adults. You judge ONE answer against ONE criterion.

The answer is an automatic speech-to-text transcript: ignore punctuation and capitalisation, and remember the transcriber sometimes "cleans up" small errors. Judge the language the learner produced, not the content of their life.

Return:
- passou: true only if the answer meets the criterion for its level. A short or off-topic answer does not pass a level above A1. When in doubt between pass and fail, fail — the next task will confirm.
- motivo_pt: one short sentence in Brazilian Portuguese explaining the decision (for the teacher's log, not shown to the learner during the test).
- reacao_en: one short, warm, natural sentence reacting to WHAT they said (e.g. "Oh, a nurse — that's a demanding job!"). Never evaluate ("good", "correct", "well done") and never correct anything: this is a test.`;
  const conteudo = [
    `Level being tested: ${tarefa.nivel}`,
    `Task the learner heard: ${tarefa.texto}`,
    `Criterion: ${tarefa.criterio}`,
    `Speech measures: ${medidas.palavras} words, ${medidas.duracao_s}s, ${medidas.ppm} words/min, ${medidas.pausas_longas} long pauses, ${medidas.hesitacoes} hesitations`,
    `Learner's answer (transcript): """${resposta}"""`,
  ].join("\n");
  const { dados } = await json(env, { system, messages: [{ role: "user", content: conteudo }], schema: SCHEMA_JUIZ, maxTokens: 600 });
  return dados;
}

/* ---------- avaliação final da prova (rodada independente; o index roda 3 e tira a mediana) ---------- */

const SCHEMA_AVALIACAO = obj({
  notas: obj({ vocabulario: NIVEL, gramatica: NIVEL, fluencia: NIVEL, compreensao: NIVEL, geral: NIVEL }),
  prioridades: {
    type: "array",
    items: obj({ tema: { type: "string" }, exemplo_dela: { type: "string" }, como_dizer: { type: "string" }, dica: { type: "string" } }),
  },
  resumo: { type: "string" },
});

const RUBRICA = `CEFR levels for spoken production (paraphrased):
- pre-A1: cannot yet produce a simple understandable sentence; isolated words only.
- A1: very basic words and memorised phrases about self; simple sentences, many errors, long pauses.
- A2: short connected sentences on familiar topics (routine, family, past weekend); basic tenses recognisable; needs effort but is understood.
- B1: keeps going on familiar topics, narrates experiences, gives reasons and opinions simply; errors present but meaning clear.
- B2: develops arguments with supporting detail and nuance, uses linking words, good range; fairly fluent; errors rarely cause misunderstanding.
- C1: fluent and spontaneous on abstract/hypothetical topics, complex structures, precise vocabulary, rare errors.
- C2: near-native precision and ease (rarely demonstrable in a short test).`;

export async function avaliarProva(env, { respostas, escada, escutaPassou, medidas }) {
  if (env.__iaFalsa) return falsoAvaliar(escada);
  const system = `You are an experienced CEFR oral examiner assessing a Brazilian adult after a short adaptive speaking test. Be calibrated and consistent: the same performance must always get the same level.

${RUBRICA}

Rate each dimension separately from the evidence, then "geral" as your overall level (not an average — the level the learner can reliably sustain). Base everything on what the transcripts show; transcripts come from speech-to-text, so ignore punctuation and casing. "compreensao" weighs the listening item and whether answers addressed what was asked.

"prioridades": the 3 most useful things for THIS learner to work on next, most important first, typical for Portuguese speakers when relevant (e.g. "I have 30 years", "people is", missing subject "is raining", false friends). For each: "tema" (short, in Brazilian Portuguese), "exemplo_dela" (her actual words from the transcript, or "" if it is an absence), "como_dizer" (the natural English version), "dica" (one sentence in Brazilian Portuguese).

"resumo": 2–3 sentences in Brazilian Portuguese, encouraging and honest, addressed to the learner as "você", saying what she already does well and the next step. No scores inside the text.`;
  const linhas = respostas.map((r, i) =>
    [`#${i + 1} [${r.tipo === "escuta" ? "LISTENING" : "SPEAKING"} · task level ${r.nivel}]`, `Task: ${r.tarefa}`, `Answer: """${r.texto}"""`, `Measures: ${r.medidas.palavras} words, ${r.medidas.ppm} wpm, ${r.medidas.pausas_longas} long pauses`].join("\n"),
  );
  const conteudo = [
    `Adaptive ladder result (highest level whose task she passed): ${escada}`,
    `Listening item: ${escutaPassou ? "answered correctly" : "not answered correctly"}`,
    `Aggregate measures: ${medidas.respostas} answers, ${medidas.palavras_por_resposta} words/answer, ${medidas.ppm_medio} wpm, ${medidas.pausas_por_minuto} long pauses/min`,
    "",
    ...linhas,
  ].join("\n");
  const { dados } = await json(env, { avaliacao: true, system, messages: [{ role: "user", content: conteudo }], schema: SCHEMA_AVALIACAO });
  dados.prioridades = (dados.prioridades || []).slice(0, 3);
  return dados;
}

/* ---------- parceiro de conversa ---------- */

const SCHEMA_CONVERSA = obj({
  resposta: { type: "string" },
  correcoes: {
    type: "array",
    items: obj({
      errado: { type: "string" },
      certo: { type: "string" },
      explicacao_pt: { type: "string" },
      categoria: { type: "string", enum: ["gramatica", "tempo-verbal", "preposicao", "vocabulario", "falso-cognato", "ordem", "outro"] },
    }),
  },
  dica_pt: { type: "string" },
});

/* historico: [{ papel: 'ia'|'aluno', texto }]; errosRecorrentes: [{ errado, certo }] do perfil. */
export async function conversar(env, { nome, nivel, tema, historico, errosRecorrentes }) {
  if (env.__iaFalsa) return falsoConversar(historico);
  const curto = ["pre-A1", "A1", "A2"].includes(nivel);
  const system = `You are a warm, patient English conversation partner for ${nome || "a Brazilian adult learner"}, a Brazilian adult at CEFR level ${nivel}. Topic: ${tema}.

How to talk:
- Replies of ${curto ? "1–2 short sentences, simple words, slow pace" : "2–4 sentences"}; end with exactly ONE question that keeps the conversation going.
- Use vocabulary at the learner's level or just above it. Never lecture.
- When the learner makes a mistake, recast it naturally inside your reply (use the correct form yourself) without saying "you made a mistake".
- Put at most the 2 most important corrections in "correcoes" (ignore tiny slips and anything that is just transcription noise: punctuation, casing, a wrong homophone). "explicacao_pt" is one short sentence in Brazilian Portuguese. Empty array when there is nothing worth correcting.
- If the learner speaks Portuguese, says they don't understand, or seems stuck: simplify, and put a short help in Brazilian Portuguese in "dica_pt" (a word, a sentence starter). Otherwise "dica_pt" is "". "resposta" is always in English.
- The learner's turns are speech-to-text transcripts.${
    errosRecorrentes && errosRecorrentes.length
      ? `\n\nThis learner's recurring mistakes — create natural chances to practise them, and correct them if they come back:\n${errosRecorrentes.map((e) => `- "${e.errado}" → "${e.certo}"`).join("\n")}`
      : ""
  }`;
  const messages = historico.map((t) => ({ role: t.papel === "ia" ? "assistant" : "user", content: t.texto }));
  // A API pede que a conversa comece pelo usuário: a abertura é pedida como instrução.
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: "(The learner just opened the app. Greet them briefly by name and start the topic with one easy question.)" });
  const { dados } = await json(env, { system, messages, schema: SCHEMA_CONVERSA, maxTokens: 1200 });
  dados.correcoes = (dados.correcoes || []).slice(0, 2);
  return dados;
}

/* ---------- relatório do fim da conversa ---------- */

const SCHEMA_RELATORIO = obj({
  resumo_pt: { type: "string" },
  acertos_pt: { type: "array", items: { type: "string" } },
  foco_pt: { type: "array", items: { type: "string" } },
  palavras_novas: { type: "array", items: obj({ en: { type: "string" }, pt: { type: "string" } }) },
  sinal: { type: "string", enum: ["acima", "no_nivel", "abaixo"] },
});

export async function relatorio(env, { nivel, historico, correcoes }) {
  if (env.__iaFalsa) return { resumo_pt: "Conversa de teste.", acertos_pt: ["falou"], foco_pt: ["praticar"], palavras_novas: [{ en: "test", pt: "teste" }], sinal: "no_nivel" };
  const system = `You write a short end-of-conversation report, in Brazilian Portuguese, for a Brazilian adult learning English (current CEFR level ${nivel}), addressed as "você". Be encouraging and concrete; quote her actual words when useful.
- resumo_pt: 2 sentences.
- acertos_pt: up to 3 things she did well.
- foco_pt: up to 3 things to practise next, each with the correct English form.
- palavras_novas: up to 5 useful English words or expressions that appeared or that she needed, with the Portuguese meaning.
- sinal: compared with level ${nivel}, did she perform "acima" (clearly above), "no_nivel", or "abaixo" (clearly below)? Use "no_nivel" unless the evidence is clear.`;
  const transcript = historico.map((t) => (t.papel === "ia" ? "Partner: " : "Learner: ") + t.texto).join("\n");
  const corr = correcoes.length ? "\n\nCorrections made during the conversation:\n" + correcoes.map((c) => `- "${c.errado}" → "${c.certo}"`).join("\n") : "";
  const { dados } = await json(env, { avaliacao: true, system, messages: [{ role: "user", content: transcript + corr }], schema: SCHEMA_RELATORIO });
  return dados;
}

/* ---------- modo falso (testes locais) ---------- */
// "[passa]" na fala faz o juiz aprovar; o resto reprova. A avaliação devolve o nível da escada.

function falsoJulgar(resposta) {
  const passou = /\[passa\]/i.test(resposta);
  return { passou, motivo_pt: passou ? "teste: aprovado" : "teste: reprovado", reacao_en: "I see." };
}

function falsoAvaliar(escada) {
  const n = escada || "A1";
  return {
    notas: { vocabulario: n, gramatica: n, fluencia: n, compreensao: n, geral: n },
    prioridades: [{ tema: "teste", exemplo_dela: "", como_dizer: "test", dica: "teste" }],
    resumo: "Avaliação de teste.",
  };
}

function falsoConversar(historico) {
  const ultima = [...historico].reverse().find((t) => t.papel === "aluno");
  const correcoes = ultima && /i have \d+ years/i.test(ultima.texto) ? [{ errado: "I have 30 years", certo: "I am 30 years old", explicacao_pt: "Idade em inglês usa o verbo to be.", categoria: "falso-cognato" }] : [];
  return { resposta: ultima ? "That's interesting! Tell me more?" : "Hi! How was your day?", correcoes, dica_pt: "" };
}
