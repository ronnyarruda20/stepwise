/* Regras puras do Stepwise — sem rede, sem banco: a escada da prova, as medidas de fluência e a nota final.
   Tudo aqui é provado por scripts/teste-regras.mjs. O desenho está em docs/01-prova-de-nivelamento.md. */

import { TAREFAS, AQUECIMENTO, ESCUTA } from "./tarefas.js";

// Escala CEFR, do menor para o maior. "pre-A1" = ainda não sustenta uma resposta simples.
export const NIVEIS = ["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"];
// Níveis que a escada testa (C2 não se mede numa conversa de 10 minutos: o teto dela é C1).
export const ESCADA = ["A1", "A2", "B1", "B2", "C1"];
export const NIVEL_INICIAL = "A2";
export const MAX_TAREFAS_ESCADA = 8;
export const PAUSA_LONGA_S = 1.2;

export function idx(nivel) {
  const i = NIVEIS.indexOf(nivel);
  if (i < 0) throw new Error("nível desconhecido: " + nivel);
  return i;
}

export function distancia(a, b) {
  return Math.abs(idx(a) - idx(b));
}

/* Mediana ordinal: com 3 notas, a do meio; com 2, a menor (conservador: não promover por empate). */
export function medianaNivel(niveis) {
  const v = niveis.filter(Boolean).map(idx).sort((x, y) => x - y);
  if (!v.length) return null;
  return NIVEIS[v[Math.floor((v.length - 1) / 2)]];
}

/* ---------- A escada ---------- */

/* variante: quantas provas este perfil já fez — muda a tarefa escolhida em cada nível, para refazer a prova
   não ser decorar as mesmas perguntas. */
export function estadoInicial(variante = 0) {
  return {
    fase: "aquecimento",
    nivel: NIVEL_INICIAL,
    falhas: {},
    aprovados: [],
    feitas: [AQUECIMENTO.id],
    tarefa: AQUECIMENTO.id,
    passos: 0,
    teto: null,
    escuta_passou: null,
    variante,
  };
}

export function tarefaPorId(id) {
  if (id === AQUECIMENTO.id) return AQUECIMENTO;
  return TAREFAS.find((t) => t.id === id) || ESCUTA.find((t) => t.id === id) || null;
}

function escolher(nivel, feitas, variante) {
  const doNivel = TAREFAS.filter((t) => t.nivel === nivel && !feitas.includes(t.id));
  if (!doNivel.length) return null;
  return doNivel[variante % doNivel.length];
}

function maiorAprovadoAbaixoDe(aprovados, nivel) {
  const abaixo = aprovados.filter((n) => idx(n) < idx(nivel)).sort((a, b) => idx(b) - idx(a));
  return abaixo[0] || null;
}

function irParaEscuta(e, teto) {
  e.teto = teto;
  e.fase = "escuta";
  // pre-A1 ouve o trecho de A1: é o mais fácil que existe
  const nivelEscuta = teto === "pre-A1" ? "A1" : teto;
  const t = ESCUTA.find((x) => x.nivel === nivelEscuta);
  e.tarefa = t.id;
  e.feitas.push(t.id);
  return e;
}

/* Avança a escada. `passou` é o veredito do juiz sobre a resposta à tarefa atual (ignorado no aquecimento).
   Devolve um estado NOVO; o de entrada não muda. */
export function proximo(estado, passou) {
  const e = structuredClone(estado);
  if (e.fase === "fim") return e;

  if (e.fase === "aquecimento") {
    e.fase = "escada";
    e.tarefa = escolher(e.nivel, e.feitas, e.variante).id;
    e.feitas.push(e.tarefa);
    return e;
  }

  if (e.fase === "escuta") {
    e.escuta_passou = !!passou;
    e.fase = "fim";
    e.tarefa = null;
    return e;
  }

  // fase "escada"
  e.passos += 1;
  const i = ESCADA.indexOf(e.nivel);

  if (passou) {
    if (!e.aprovados.includes(e.nivel)) e.aprovados.push(e.nivel);
    const acima = ESCADA[i + 1];
    if (!acima) return irParaEscuta(e, e.nivel); // passou em C1: teto da escada
    if ((e.falhas[acima] || 0) >= 2) return irParaEscuta(e, e.nivel); // já caiu duas vezes lá em cima
    e.nivel = acima;
  } else {
    e.falhas[e.nivel] = (e.falhas[e.nivel] || 0) + 1;
    if (e.falhas[e.nivel] >= 2) {
      const abaixo = ESCADA[i - 1];
      if (abaixo && !e.aprovados.includes(abaixo) && (e.falhas[abaixo] || 0) < 2) {
        e.nivel = abaixo; // caiu duas vezes e nunca passou no de baixo: desce para conferir
      } else {
        return irParaEscuta(e, maiorAprovadoAbaixoDe(e.aprovados, e.nivel) || "pre-A1");
      }
    }
  }

  if (e.passos >= MAX_TAREFAS_ESCADA) {
    const teto = e.aprovados.sort((a, b) => idx(b) - idx(a))[0] || "pre-A1";
    return irParaEscuta(e, teto);
  }

  const t = escolher(e.nivel, e.feitas, e.variante);
  if (!t) {
    // acabaram as tarefas deste nível: conta como a 2ª queda
    return proximo({ ...e, passos: e.passos - 1, falhas: { ...e.falhas, [e.nivel]: 1 } }, false);
  }
  e.tarefa = t.id;
  e.feitas.push(t.id);
  return e;
}

/* ---------- Medidas de fluência (da transcrição, sem IA) ---------- */

const HESITACAO = /^(um+|uh+|ah+|eh+|hmm+|er+|é+|hã+)$/i;

/* palavras: [{ word, start, end }] na ordem, como o Whisper devolve. */
export function medirFala(palavras) {
  const ws = (palavras || [])
    .map((p) => ({ w: String(p.word || "").trim().replace(/[^\p{L}\p{N}'-]/gu, ""), s: Number(p.start), e: Number(p.end) }))
    .filter((p) => p.w && Number.isFinite(p.s) && Number.isFinite(p.e));
  if (!ws.length) return { palavras: 0, duracao_s: 0, ppm: 0, pausas_longas: 0, hesitacoes: 0 };
  const duracao = Math.max(0, ws[ws.length - 1].e - ws[0].s);
  let pausas = 0;
  for (let k = 1; k < ws.length; k++) if (ws[k].s - ws[k - 1].e > PAUSA_LONGA_S) pausas++;
  const hesitacoes = ws.filter((p) => HESITACAO.test(p.w)).length;
  const contadas = ws.length - hesitacoes;
  return {
    palavras: contadas,
    duracao_s: arred(duracao),
    ppm: duracao >= 1 ? arred((contadas / duracao) * 60) : 0,
    pausas_longas: pausas,
    hesitacoes,
  };
}

/* Agrega as medidas de várias respostas (só as da escada e da escuta; o aquecimento não conta). */
export function agregarMedidas(medidas) {
  const v = medidas.filter((m) => m && m.palavras > 0);
  if (!v.length) return { respostas: 0, palavras_por_resposta: 0, ppm_medio: 0, pausas_por_minuto: 0 };
  const palavras = v.reduce((s, m) => s + m.palavras, 0);
  const duracao = v.reduce((s, m) => s + m.duracao_s, 0);
  const pausas = v.reduce((s, m) => s + m.pausas_longas, 0);
  return {
    respostas: v.length,
    palavras_por_resposta: arred(palavras / v.length),
    ppm_medio: duracao > 0 ? arred((palavras / duracao) * 60) : 0,
    pausas_por_minuto: duracao > 0 ? arred((pausas / duracao) * 60) : 0,
  };
}

/* ---------- Nota final ---------- */

export const DIMENSOES = ["vocabulario", "gramatica", "fluencia", "compreensao", "geral"];

/* rodadas: as avaliações independentes do avaliador (3, de preferência). Mediana por dimensão; o texto
   (prioridades e resumo) vem da rodada cuja nota geral é a mediana. `divergente` marca quando o avaliador
   e a escada discordam em 2 níveis ou mais — o resultado vale, mas a tela avisa que pode refazer. */
export function consolidar(rodadas, escada) {
  const ok = rodadas.filter(Boolean);
  if (ok.length < 2) throw new Error("avaliação insuficiente: " + ok.length + " rodada(s) válidas");
  const notas = {};
  for (const d of DIMENSOES) notas[d] = medianaNivel(ok.map((r) => r.notas[d]));
  const base = ok.find((r) => r.notas.geral === notas.geral) || ok[0];
  const espalhamento = Math.max(...ok.map((r) => idx(r.notas.geral))) - Math.min(...ok.map((r) => idx(r.notas.geral)));
  return {
    nivel: notas.geral,
    notas,
    prioridades: base.prioridades,
    resumo: base.resumo,
    escada,
    divergente: escada ? distancia(notas.geral, escada) >= 2 : false,
    espalhamento,
    rodadas: ok.length,
  };
}

/* Sugestão de refazer a prova: as 3 últimas conversas apontam para o mesmo lado. */
export function sugestaoDeProva(sinais) {
  const u = sinais.slice(0, 3);
  if (u.length < 3) return null;
  if (u.every((s) => s === "acima")) return "acima";
  if (u.every((s) => s === "abaixo")) return "abaixo";
  return null;
}

function arred(x) {
  return Math.round(x * 10) / 10;
}
