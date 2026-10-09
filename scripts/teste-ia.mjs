/* Provas da ligação com a DeepSeek (worker/ia.js), sem rede: o `fetch` é trocado por respostas montadas à mão.
   Confere o pedido (modelo, pensamento, modo JSON, schema no prompt), a conferência do schema, as novas tentativas
   e os erros. `npm run teste:ia`. */

import { julgar, avaliarProva, conversar, relatorio, conferir, extrairJSON, ErroIA } from "../worker/ia.js";
import { ouvir } from "../worker/voz.js";

let ok = 0, falhou = 0;
function prova(nome, cond, detalhe = "") {
  if (cond) ok++;
  else { falhou++; console.log("  ✗ " + nome + (detalhe ? " — " + detalhe : "")); }
}

const env = { DEEPSEEK_API_KEY: "chave-falsa", MODELO_CONVERSA: "deepseek-flash", MODELO_AVALIACAO: "deepseek-v4-pro", __esperaIA: 0 };

/* Cada resposta: { status, corpo } ou um Error (falha de rede). A última se repete. */
let pedidos = [];
function responder(...fila) {
  pedidos = [];
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url, headers: init.headers, corpo: JSON.parse(init.body) });
    const r = fila.length > 1 ? fila.shift() : fila[0];
    if (r instanceof Error) throw r;
    return new Response(typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), { status: r.status || 200 });
  };
}
const certa = (conteudo, fim = "stop") => ({
  corpo: { choices: [{ message: { content: typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo) }, finish_reason: fim }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
});
async function erroDe(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

const TAREFA = { tarefa: { nivel: "A2", texto: "Tell me about your weekend.", criterio: "past tense" }, resposta: "I went to the beach", medidas: { palavras: 5, duracao_s: 2, ppm: 150, pausas_longas: 0, hesitacoes: 0 } };
const JUIZ = { passou: true, motivo_pt: "usou o passado", reacao_en: "Oh, the beach!" };
const notas = (g) => ({ vocabulario: g, gramatica: g, fluencia: g, compreensao: g, geral: g });
const AVALIACAO = { notas: notas("B1"), prioridades: [1, 2, 3, 4].map((i) => ({ tema: "t" + i, exemplo_dela: "", como_dizer: "x", dica: "d" })), resumo: "Bom." };
const PROVA = {
  respostas: [{ tipo: "fala", nivel: "B1", tarefa: "t", texto: "I went", medidas: { palavras: 2, ppm: 100, pausas_longas: 0 } }],
  escada: "B1", escutaPassou: true,
  medidas: { respostas: 1, palavras_por_resposta: 2, ppm_medio: 100, pausas_por_minuto: 0 },
};
const CONVERSA = { resposta: "Hi! How are you?", correcoes: [1, 2, 3].map(() => ({ errado: "a", certo: "b", explicacao_pt: "c", categoria: "gramatica" })), dica_pt: "" };
const RELATORIO = { resumo_pt: "r", acertos_pt: ["a"], foco_pt: ["f"], palavras_novas: [{ en: "beach", pt: "praia" }], sinal: "no_nivel" };

console.log("pedido:");
{
  responder(certa(JUIZ));
  const d = await julgar(env, TAREFA);
  const p = pedidos[0];
  prova("vai para a API da DeepSeek", p.url === "https://api.deepseek.com/chat/completions", p.url);
  prova("chave no Authorization", p.headers.authorization === "Bearer chave-falsa");
  prova("juiz no modelo de conversa", p.corpo.model === "deepseek-flash", p.corpo.model);
  prova("juiz SEM pensamento", p.corpo.thinking && p.corpo.thinking.type === "disabled", JSON.stringify(p.corpo.thinking));
  prova("modo JSON ligado", p.corpo.response_format && p.corpo.response_format.type === "json_object");
  prova("juiz com max_tokens 600", p.corpo.max_tokens === 600, String(p.corpo.max_tokens));
  const sys = p.corpo.messages[0];
  prova("1ª mensagem é o system", sys.role === "system");
  prova("system cita json (exigência do modo JSON)", /json/.test(sys.content));
  prova("system leva o schema", sys.content.includes('"reacao_en"') && sys.content.includes('"additionalProperties":false'));
  prova("depois vem a fala da aluna", p.corpo.messages[1].role === "user" && p.corpo.messages[1].content.includes("I went to the beach"));
  prova("devolve o veredito", d.passou === true && d.reacao_en === "Oh, the beach!");
}
{
  responder(certa(AVALIACAO));
  const d = await avaliarProva(env, PROVA);
  const p = pedidos[0];
  prova("avaliação no modelo de avaliação", p.corpo.model === "deepseek-v4-pro", p.corpo.model);
  prova("avaliação COM pensamento", p.corpo.thinking && p.corpo.thinking.type === "enabled");
  prova("avaliação com folga para pensar (32000)", p.corpo.max_tokens === 32000, String(p.corpo.max_tokens));
  prova("avaliação corta em 3 prioridades", d.prioridades.length === 3);
}
{
  responder(certa(CONVERSA));
  const d = await conversar(env, { nome: "Maria", nivel: "A2", tema: "dia-a-dia", historico: [], errosRecorrentes: [] });
  const p = pedidos[0];
  prova("conversa sem pensamento", p.corpo.model === "deepseek-flash" && p.corpo.thinking.type === "disabled");
  prova("abertura vira pedido do usuário depois do system", p.corpo.messages.length === 2 && p.corpo.messages[1].role === "user");
  prova("conversa corta em 2 correções", d.correcoes.length === 2);
  responder(certa(CONVERSA));
  await conversar(env, { nome: "Maria", nivel: "A2", tema: "dia-a-dia", historico: [{ papel: "ia", texto: "Hi!" }, { papel: "aluno", texto: "I have 30 years" }], errosRecorrentes: [{ errado: "people is", certo: "people are" }] });
  const m = pedidos[0].corpo.messages;
  prova("histórico vira assistant/user na ordem", m.map((x) => x.role).join() === "system,user,assistant,user", m.map((x) => x.role).join());
  prova("erros recorrentes no system", m[0].content.includes('"people is" → "people are"'));
}
{
  responder(certa(RELATORIO));
  const d = await relatorio(env, { nivel: "A2", historico: [{ papel: "ia", texto: "Hi" }, { papel: "aluno", texto: "Hello" }], correcoes: [] });
  prova("relatório no modelo de avaliação, com pensamento", pedidos[0].corpo.model === "deepseek-v4-pro" && pedidos[0].corpo.thinking.type === "enabled");
  prova("relatório devolve o sinal", d.sinal === "no_nivel");
}

console.log("resposta:");
{
  responder(certa("```json\n" + JSON.stringify(JUIZ) + "\n```"));
  prova("aceita JSON dentro de cerca de markdown", (await julgar(env, TAREFA)).passou === true);
  responder(certa({ ...AVALIACAO, notas: { ...notas("b1"), geral: "Pre-A1" } }));
  const d = await avaliarProva(env, PROVA);
  prova("conserta a caixa do nível (b1 → B1, Pre-A1 → pre-A1)", d.notas.vocabulario === "B1" && d.notas.geral === "pre-A1", JSON.stringify(d.notas));
  responder(certa({ ...JUIZ, extra: "x" }));
  prova("tira propriedade a mais", !("extra" in (await julgar(env, TAREFA))));
}

console.log("novas tentativas:");
{
  responder({ status: 503, corpo: "ocupado" }, certa(JUIZ));
  prova("503 → tenta de novo e passa", (await julgar(env, TAREFA)).passou === true && pedidos.length === 2, String(pedidos.length));
  responder(new TypeError("fetch failed"), certa(JUIZ));
  prova("queda de rede → tenta de novo e passa", (await julgar(env, TAREFA)).passou === true && pedidos.length === 2);
  responder(certa("não sei"), certa(JUIZ));
  prova("texto que não é JSON → tenta de novo e passa", (await julgar(env, TAREFA)).passou === true && pedidos.length === 2);
  responder(certa(""), certa(JUIZ));
  prova("conteúdo vazio → tenta de novo e passa", (await julgar(env, TAREFA)).passou === true && pedidos.length === 2);
  responder(certa({ ...AVALIACAO, notas: notas("A2+") }));
  const e = await erroDe(() => avaliarProva(env, PROVA));
  prova("nível fora da escala 3× → fora_do_schema", e instanceof ErroIA && e.motivo === "fora_do_schema" && pedidos.length === 3, e && e.message);
  responder({ status: 429, corpo: "devagar" });
  const e2 = await erroDe(() => julgar(env, TAREFA));
  prova("429 3× → limite", e2 instanceof ErroIA && e2.motivo === "limite" && pedidos.length === 3, e2 && e2.message);
}

console.log("erros que não se repetem:");
for (const [status, motivo] of [[401, "chave_invalida"], [402, "sem_saldo"], [422, "api"], [400, "api"]]) {
  responder({ status, corpo: "x" });
  const e = await erroDe(() => julgar(env, TAREFA));
  prova(`${status} → ${motivo}, uma chamada só`, e instanceof ErroIA && e.motivo === motivo && pedidos.length === 1, e && e.message);
}
{
  responder(certa('{"passou": tr', "length"));
  const e = await erroDe(() => julgar(env, TAREFA));
  prova("cortada no max_tokens → cortou, sem repetir", e && e.motivo === "cortou" && pedidos.length === 1);
  responder(certa("", "content_filter"));
  const e2 = await erroDe(() => julgar(env, TAREFA));
  prova("filtro de conteúdo → recusou", e2 && e2.motivo === "recusou");
  responder(certa(JUIZ));
  const e3 = await erroDe(() => julgar({ ...env, DEEPSEEK_API_KEY: "" }, TAREFA));
  prova("sem chave → sem_chave, sem chamar a rede", e3 && e3.motivo === "sem_chave" && pedidos.length === 0);
}

console.log("conferir e extrair:");
{
  const S = { type: "object", properties: { a: { type: "string" }, b: { type: "array", items: { type: "boolean" } } }, required: ["a", "b"], additionalProperties: false };
  prova("objeto certo passa", !conferir(S, { a: "x", b: [true] }).erro);
  prova("falta propriedade → erro com caminho", conferir(S, { a: "x" }).erro === "$.b faltando");
  prova("tipo errado dentro da lista → erro com índice", conferir(S, { a: "x", b: [true, "sim"] }).erro === "$.b[1] não é booleano");
  prova("lista no lugar de objeto → erro", !!conferir(S, []).erro);
  prova("extrai o objeto do meio do texto", extrairJSON('Aqui está: {"a": 1} pronto') === '{"a": 1}');
}

console.log("ouvir (Workers AI):");
{
  const comErro = (msg) => ({ AI: { run: async () => { throw new Error(msg); } } });
  const wav = new Uint8Array(44);
  const e = await erroDe(() => ouvir(comErro("4006: you have used up your daily free allocation of 10,000 neurons"), wav));
  prova("cota grátis esgotada (4006) → cota_voz, não o 500 genérico", e instanceof ErroIA && e.motivo === "cota_voz", e && e.message);
  const e2 = await erroDe(() => ouvir(comErro("3010: invalid audio"), wav));
  prova("outra falha do Whisper → ouvir", e2 instanceof ErroIA && e2.motivo === "ouvir", e2 && e2.message);
}

console.log(`\nia: ${ok} provas ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
