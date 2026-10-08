/* Provas das regras puras (worker/regras.js): a escada da prova, as medidas de fluência e a nota final.
   Sem rede, sem banco: `npm run teste:regras`. */

import { estadoInicial, proximo, medirFala, agregarMedidas, consolidar, medianaNivel, sugestaoDeProva, tarefaPorId, MAX_TAREFAS_ESCADA } from "../worker/regras.js";
import { TAREFAS, ESCUTA } from "../worker/tarefas.js";

let ok = 0, falhou = 0;
function prova(nome, cond, detalhe = "") {
  if (cond) ok++;
  else { falhou++; console.log("  ✗ " + nome + (detalhe ? " — " + detalhe : "")); }
}

/* Roda a escada inteira com uma "aluna" que passa em tudo até `nivelReal` e cai acima dele. */
function rodar(nivelReal, variante = 0) {
  const ordem = ["A1", "A2", "B1", "B2", "C1"];
  const real = nivelReal === "pre-A1" ? -1 : ordem.indexOf(nivelReal);
  let e = estadoInicial(variante);
  e = proximo(e, null); // aquecimento
  const caminho = [];
  let guarda = 0;
  while (e.fase === "escada" && guarda++ < 20) {
    const t = tarefaPorId(e.tarefa);
    caminho.push(t.id);
    e = proximo(e, ordem.indexOf(t.nivel) <= real);
  }
  const escuta = e.fase === "escuta" ? tarefaPorId(e.tarefa) : null;
  e = proximo(e, true);
  return { e, caminho, escuta };
}

console.log("escada:");
for (const [real, esperado] of [["pre-A1", "pre-A1"], ["A1", "A1"], ["A2", "A2"], ["B1", "B1"], ["B2", "B2"], ["C1", "C1"]]) {
  const { e, caminho, escuta } = rodar(real);
  prova(`aluna ${real} → teto ${esperado}`, e.teto === esperado, `teto=${e.teto} caminho=${caminho.join(",")}`);
  prova(`aluna ${real} → termina`, e.fase === "fim");
  prova(`aluna ${real} → no máximo ${MAX_TAREFAS_ESCADA} tarefas`, caminho.length <= MAX_TAREFAS_ESCADA, String(caminho.length));
  prova(`aluna ${real} → nunca repete tarefa`, new Set(caminho).size === caminho.length);
  prova(`aluna ${real} → escuta do nível certo`, escuta && escuta.nivel === (esperado === "pre-A1" ? "A1" : esperado), escuta && escuta.id);
}
{
  const { caminho } = rodar("A2");
  prova("começa em A2", tarefaPorId(caminho[0]).nivel === "A2");
  prova("aluna A2 faz poucas tarefas (≤ 4)", caminho.length <= 4, caminho.join(","));
}
{
  const a = rodar("B1", 0).caminho, b = rodar("B1", 1).caminho;
  prova("variante muda as perguntas", a.join() !== b.join(), a.join() + " | " + b.join());
}
{
  // uma queda isolada não derruba: cai uma vez em B1 e passa na segunda
  let e = proximo(estadoInicial(), null);
  e = proximo(e, true); // A2 ok
  prova("passou em A2 → sobe para B1", e.nivel === "B1");
  e = proximo(e, false); // B1 cai 1x
  prova("1ª queda em B1 → outra tarefa de B1", e.fase === "escada" && e.nivel === "B1" && tarefaPorId(e.tarefa).nivel === "B1");
  e = proximo(e, true); // B1 ok
  prova("passou na 2ª de B1 → sobe para B2", e.nivel === "B2");
  e = proximo(e, false); e = proximo(e, false);
  prova("duas quedas em B2 → teto B1", e.fase === "escuta" && e.teto === "B1");
}
{
  const e0 = estadoInicial();
  const e1 = proximo(e0, null);
  prova("proximo não altera o estado de entrada", e0.fase === "aquecimento" && e1.fase === "escada");
}
prova("todas as tarefas têm critério", [...TAREFAS, ...ESCUTA].every((t) => t.criterio && t.texto));
prova("3 tarefas por nível de A1 a B2", ["A1", "A2", "B1", "B2"].every((n) => TAREFAS.filter((t) => t.nivel === n).length === 3));

console.log("medidas:");
{
  const m = medirFala([
    { word: " I", start: 0.0, end: 0.2 }, { word: " work", start: 0.3, end: 0.6 }, { word: " um", start: 0.7, end: 0.9 },
    { word: " in", start: 2.5, end: 2.6 }, { word: " a", start: 2.6, end: 2.7 }, { word: " hospital.", start: 2.8, end: 3.4 },
  ]);
  prova("conta palavras sem a hesitação", m.palavras === 5, JSON.stringify(m));
  prova("conta a hesitação", m.hesitacoes === 1);
  prova("acha a pausa longa (0,9 → 2,5)", m.pausas_longas === 1);
  prova("duração do 1º início ao último fim", m.duracao_s === 3.4);
  prova("palavras por minuto", m.ppm === Math.round((5 / 3.4) * 60 * 10) / 10, String(m.ppm));
  prova("fala vazia não quebra", medirFala([]).palavras === 0 && medirFala(null).ppm === 0);
  const ag = agregarMedidas([m, medirFala([]), { palavras: 10, duracao_s: 6.6, pausas_longas: 0 }]);
  prova("agrega só respostas com fala", ag.respostas === 2 && ag.palavras_por_resposta === 7.5, JSON.stringify(ag));
}

console.log("nota final:");
{
  prova("mediana de 3", medianaNivel(["B1", "A2", "B2"]) === "B1");
  prova("mediana de 2 é a menor", medianaNivel(["B2", "B1"]) === "B1");
  const r = (g, v = g) => ({ notas: { vocabulario: v, gramatica: g, fluencia: g, compreensao: g, geral: g }, prioridades: ["p-" + g], resumo: "r-" + g });
  const c = consolidar([r("B1"), r("A2"), r("B1", "B2")], "B1");
  prova("nível = mediana da geral", c.nivel === "B1");
  prova("texto vem de uma rodada com a geral da mediana", c.resumo === "r-B1");
  prova("vocabulário pela mediana própria", c.notas.vocabulario === "B1");
  prova("sem divergência quando bate com a escada", c.divergente === false);
  prova("diverge quando a escada está 2 níveis longe", consolidar([r("B2"), r("B2"), r("B2")], "A2").divergente === true);
  prova("espalhamento entre rodadas", c.espalhamento === 1);
  let erro = null;
  try { consolidar([r("B1"), null, null], "B1"); } catch (e) { erro = e; }
  prova("recusa com menos de 2 rodadas", !!erro);
  prova("sugere refazer: 3× acima", sugestaoDeProva(["acima", "acima", "acima", "no_nivel"]) === "acima");
  prova("não sugere com sinais mistos", sugestaoDeProva(["acima", "no_nivel", "acima"]) === null);
  prova("não sugere com menos de 3", sugestaoDeProva(["abaixo", "abaixo"]) === null);
}

console.log(`\nregras: ${ok} provas ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
