/* Stepwise — Worker. O app (public/) é estático e chama a API daqui.
   Rotas:
     GET  /entrar · /entrar/volta · /sair          login Google (sessao.js)
     POST /entrar/local                             login sem Google — SÓ em localhost com MODO_LOCAL=1
     GET  /api/config                               { modoLocal }
     GET  /api/eu                                   conta + perfis
     POST /api/perfis                               { nome } → novo perfil
     GET  /api/perfis/:id                           perfil, histórico, erros recentes, sugestão de refazer a prova
     PATCH /api/perfis/:id                          { nivel } → ajuste manual do nível
     POST /api/perfis/:id/prova                     começa a prova de nivelamento
     POST /api/perfis/:id/conversa                  { tema } → começa uma conversa
     POST /api/sessoes/:id/turno[?pular=1]          corpo = WAV 16 kHz mono → transcreve, responde, fala
     POST /api/sessoes/:id/encerrar                 prova: nota final (3 avaliações, mediana) · conversa: relatório
     GET  /api/sessoes/:id                          transcrição e resultado
   Desenho: docs/01-prova-de-nivelamento.md. Estado e decisões: docs/00-estado.md. */

import { ROTAS_SESSAO, irParaGoogle, voltarDoGoogle, respostaComSessao, sair, lerSessao, normalizar } from "./sessao.js";
import { estadoInicial, proximo, tarefaPorId, medirFala, agregarMedidas, consolidar, sugestaoDeProva, NIVEIS } from "./regras.js";
import { FECHAMENTO, TEMAS } from "./tarefas.js";
import { julgar, avaliarProva, conversar, relatorio, ErroIA } from "./ia.js";
import { ouvir, falar } from "./voz.js";

const MAX_WAV = 2.5 * 1024 * 1024; // ~75 s de WAV 16 kHz mono
const MAX_PERFIS = 6;
const MAX_TURNOS_CONVERSA = 40;
const RODADAS_AVALIACAO = 3;

export default {
  async fetch(requisicao, envOriginal) {
    const url = new URL(requisicao.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    // Os dois modos de teste só existem em localhost: no ar, nem com a variável ligada eles valem.
    const env = Object.create(envOriginal);
    env.__iaFalsa = local && envOriginal.IA_FALSA === "1";
    env.__modoLocal = local && envOriginal.MODO_LOCAL === "1";
    try {
      return comCabecalhos(await rotear(requisicao, url, env));
    } catch (e) {
      if (e instanceof Resposta) return comCabecalhos(e.resposta);
      if (e instanceof ErroIA) {
        console.log("IA:", e.message);
        const status = e.motivo === "limite" ? 429 : 502;
        return comCabecalhos(json({ erro: mensagemIA(e.motivo) }, status));
      }
      console.log("erro:", e && e.stack);
      return comCabecalhos(json({ erro: "Algo deu errado aqui. Tente de novo." }, 500));
    }
  },
};

async function rotear(req, url, env) {
  const p = url.pathname;
  const m = req.method;

  if (p === ROTAS_SESSAO.entrar && m === "GET") return irParaGoogle(url, env);
  if (p === ROTAS_SESSAO.callback && m === "GET") {
    const r = await voltarDoGoogle(req, url, env);
    if (r.erro) return texto(r.erro, 400);
    return entrarComo(r.email, r.nome, env);
  }
  if (p === ROTAS_SESSAO.sair) return sair(req, env);
  if (p === "/entrar/local" && m === "POST") {
    if (!env.__modoLocal) return texto("Não encontrado", 404);
    const f = await req.formData();
    return entrarComo(normalizar(f.get("email")), "Local", env);
  }
  // iaFalsa vai junto para o teste conferir, ANTES de qualquer turno, que não vai gastar IA de verdade.
  if (p === "/api/config") return json({ modoLocal: env.__modoLocal, iaFalsa: env.__iaFalsa });

  if (!p.startsWith("/api/")) return texto("Não encontrado", 404);
  const conta = await exigirConta(req, env);

  if (p === "/api/eu" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT id, nome, nivel, nivel_em FROM perfil WHERE conta_id = ? ORDER BY id").bind(conta.id).all();
    return json({ email: conta.email, nome: conta.nome, perfis: results });
  }
  if (p === "/api/perfis" && m === "POST") return criarPerfil(req, env, conta);

  let r;
  if ((r = p.match(/^\/api\/perfis\/(\d+)$/))) {
    const perfil = await exigirPerfil(env, conta, r[1]);
    if (m === "GET") return lerPerfil(env, perfil);
    if (m === "PATCH") return ajustarNivel(req, env, perfil);
  }
  if ((r = p.match(/^\/api\/perfis\/(\d+)\/prova$/)) && m === "POST") return comecarProva(env, await exigirPerfil(env, conta, r[1]));
  if ((r = p.match(/^\/api\/perfis\/(\d+)\/conversa$/)) && m === "POST") return comecarConversa(req, env, await exigirPerfil(env, conta, r[1]));
  if ((r = p.match(/^\/api\/sessoes\/([\w-]{36})\/turno$/)) && m === "POST") return turno(req, url, env, conta, await exigirSessao(env, conta, r[1]));
  if ((r = p.match(/^\/api\/sessoes\/([\w-]{36})\/encerrar$/)) && m === "POST") return encerrar(env, await exigirSessao(env, conta, r[1]));
  if ((r = p.match(/^\/api\/sessoes\/([\w-]{36})$/)) && m === "GET") return lerSessaoCompleta(env, await exigirSessao(env, conta, r[1]));

  return json({ erro: "Não encontrado" }, 404);
}

/* ---------- conta, perfil, sessão ---------- */

/* CONTAS_LIBERADAS: lista de e-mails, ou "*" para qualquer conta Google com e-mail verificado (decisão do Ronny em
   08/10, D11). Aberto, quem segura o gasto são as travas: MAX_CONTAS, LIMITE_TURNOS_DIA (por conta) e
   LIMITE_GLOBAL_DIA (todas as contas somadas — o Whisper e a voz cobram na Cloudflare, fora do saldo da DeepSeek). */
function liberado(email, env) {
  const lista = String(env.CONTAS_LIBERADAS || "").split(",").map(normalizar).filter(Boolean);
  return !!email && (lista.includes("*") || lista.includes(email));
}

async function entrarComo(email, nome, env) {
  if (!liberado(email, env)) return texto("O Stepwise ainda é só por convite, e este e-mail (" + email + ") não está na lista.", 403);
  const existe = await env.DB.prepare("SELECT id FROM conta WHERE email = ?").bind(email).first();
  if (!existe) {
    const { c } = await env.DB.prepare("SELECT count(*) AS c FROM conta").first();
    if (c >= Number(env.MAX_CONTAS || 50)) return texto("O Stepwise está em teste e as vagas acabaram por enquanto. Tente de novo mais tarde.", 403);
  }
  await env.DB.prepare("INSERT INTO conta (email, nome, criado_em) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET nome = COALESCE(conta.nome, excluded.nome)")
    .bind(email, nome || null, agora()).run();
  return respostaComSessao(email, env, "/");
}

async function exigirConta(req, env) {
  const s = await lerSessao(req, env);
  if (!s) throw new Resposta(json({ erro: "Entre de novo." }, 401));
  if (!liberado(s.email, env)) throw new Resposta(json({ erro: "Acesso retirado." }, 403));
  const c = await env.DB.prepare("SELECT id, email, nome FROM conta WHERE email = ?").bind(s.email).first();
  if (!c) throw new Resposta(json({ erro: "Entre de novo." }, 401));
  return c;
}

async function exigirPerfil(env, conta, id) {
  const p = await env.DB.prepare("SELECT * FROM perfil WHERE id = ? AND conta_id = ?").bind(Number(id), conta.id).first();
  if (!p) throw new Resposta(json({ erro: "Perfil não encontrado." }, 404));
  return p;
}

async function exigirSessao(env, conta, id) {
  const s = await env.DB.prepare("SELECT s.*, p.nome AS perfil_nome, p.nivel AS perfil_nivel FROM sessao s JOIN perfil p ON p.id = s.perfil_id WHERE s.id = ? AND p.conta_id = ?")
    .bind(id, conta.id).first();
  if (!s) throw new Resposta(json({ erro: "Sessão não encontrada." }, 404));
  s.estado = JSON.parse(s.estado);
  s.resultado = s.resultado ? JSON.parse(s.resultado) : null;
  return s;
}

async function criarPerfil(req, env, conta) {
  const { nome } = await corpoJSON(req);
  const n = String(nome || "").trim().slice(0, 40);
  if (!n) return json({ erro: "Dê um nome ao perfil." }, 400);
  const { c } = await env.DB.prepare("SELECT count(*) AS c FROM perfil WHERE conta_id = ?").bind(conta.id).first();
  if (c >= MAX_PERFIS) return json({ erro: "Limite de " + MAX_PERFIS + " perfis por conta." }, 409);
  const r = await env.DB.prepare("INSERT INTO perfil (conta_id, nome, criado_em) VALUES (?, ?, ?) RETURNING id, nome, nivel, nivel_em").bind(conta.id, n, agora()).first();
  return json(r, 201);
}

async function lerPerfil(env, perfil) {
  const { results: sessoes } = await env.DB.prepare("SELECT id, tipo, tema, status, resultado, iniciado_em, fechado_em FROM sessao WHERE perfil_id = ? ORDER BY iniciado_em DESC LIMIT 15").bind(perfil.id).all();
  const { results: erros } = await env.DB.prepare("SELECT errado, certo, explicacao, categoria, criado_em FROM erro WHERE perfil_id = ? ORDER BY id DESC LIMIT 8").bind(perfil.id).all();
  const lista = sessoes.map((s) => {
    const r = s.resultado ? JSON.parse(s.resultado) : null;
    return { id: s.id, tipo: s.tipo, tema: s.tema, status: s.status, iniciado_em: s.iniciado_em, nivel: r && r.nivel, sinal: r && r.sinal, incompleta: !!(r && (r.incompleta || r.curta)) };
  });
  const sinais = lista.filter((s) => s.tipo === "conversa" && s.status === "fechada" && s.sinal).map((s) => s.sinal);
  return json({ perfil: publicoPerfil(perfil), sessoes: lista, erros, sugestao_prova: perfil.nivel ? sugestaoDeProva(sinais) : null });
}

async function ajustarNivel(req, env, perfil) {
  const { nivel } = await corpoJSON(req);
  if (!NIVEIS.includes(nivel)) return json({ erro: "Nível inválido." }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE perfil SET nivel = ?, nivel_em = ? WHERE id = ?").bind(nivel, agora(), perfil.id),
    env.DB.prepare("INSERT INTO nivel_historico (perfil_id, nivel, origem, criado_em) VALUES (?, ?, 'manual', ?)").bind(perfil.id, nivel, agora()),
  ]);
  return json({ ok: true, nivel });
}

/* ---------- começar ---------- */

async function comecarProva(env, perfil) {
  const { c } = await env.DB.prepare("SELECT count(*) AS c FROM sessao WHERE perfil_id = ? AND tipo = 'prova'").bind(perfil.id).first();
  const estado = estadoInicial(c);
  const id = crypto.randomUUID();
  const fala = tarefaPorId(estado.tarefa).texto;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessao (id, perfil_id, tipo, estado, status, iniciado_em) VALUES (?, ?, 'prova', ?, 'aberta', ?)").bind(id, perfil.id, JSON.stringify(estado), agora()),
    env.DB.prepare("INSERT INTO turno (sessao_id, ordem, papel, texto, tarefa_id, criado_em) VALUES (?, 1, 'ia', ?, ?, ?)").bind(id, fala, estado.tarefa, agora()),
  ]);
  return json({ sessao_id: id, tipo: "prova", ia: { texto: fala, audio: await falar(env, fala) }, progresso: progresso(estado) }, 201);
}

async function comecarConversa(req, env, perfil) {
  const { tema } = await corpoJSON(req);
  const chave = TEMAS[tema] ? tema : "dia-a-dia";
  const nivel = perfil.nivel || "A2";
  const erros = await errosRecorrentes(env, perfil.id);
  const r = await conversar(env, { nome: perfil.nome, nivel, tema: TEMAS[chave], historico: [], errosRecorrentes: erros });
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessao (id, perfil_id, tipo, tema, estado, status, iniciado_em) VALUES (?, ?, 'conversa', ?, ?, 'aberta', ?)").bind(id, perfil.id, chave, JSON.stringify({ nivel, erros }), agora()),
    env.DB.prepare("INSERT INTO turno (sessao_id, ordem, papel, texto, criado_em) VALUES (?, 1, 'ia', ?, ?)").bind(id, r.resposta, agora()),
  ]);
  return json({ sessao_id: id, tipo: "conversa", nivel, sem_prova: !perfil.nivel, ia: { texto: r.resposta, audio: await falar(env, r.resposta), dica_pt: r.dica_pt } }, 201);
}

/* Os erros que mais voltam deste perfil (pela forma certa), para a conversa trabalhar neles. */
async function errosRecorrentes(env, perfilId) {
  const { results } = await env.DB.prepare(
    "SELECT errado, certo, count(*) AS vezes FROM erro WHERE perfil_id = ? GROUP BY lower(certo) ORDER BY vezes DESC, max(id) DESC LIMIT 5",
  ).bind(perfilId).all();
  return results.map((e) => ({ errado: e.errado, certo: e.certo }));
}

/* ---------- um turno ---------- */

async function turno(req, url, env, conta, sessao) {
  if (sessao.status !== "aberta") return json({ erro: "Esta sessão já terminou." }, 409);
  await checarLimiteDiario(env, conta);
  const pular = url.searchParams.get("pular") === "1";
  if (pular && sessao.tipo !== "prova") return json({ erro: "Pular só existe na prova." }, 400);

  let fala = "(skipped)", medidas = medirFala([]);
  if (!pular) {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return json({ erro: "Não chegou áudio." }, 400);
    if (bytes.length > MAX_WAV) return json({ erro: "Fala longa demais: até um minuto por vez." }, 413);
    const o = await ouvir(env, bytes, { textoFalso: env.__iaFalsa ? decodeURIComponent(req.headers.get("X-Teste-Fala") || "") : undefined });
    medidas = medirFala(o.palavras);
    fala = o.texto;
    if (!fala || medidas.palavras === 0) return json({ erro: "Não consegui ouvir. Tente de novo, mais perto do microfone." }, 422);
  }

  const { ultima } = await env.DB.prepare("SELECT max(ordem) AS ultima FROM turno WHERE sessao_id = ?").bind(sessao.id).first();
  return sessao.tipo === "prova" ? turnoProva(env, sessao, fala, medidas, pular, ultima) : turnoConversa(env, sessao, fala, medidas, ultima);
}

async function turnoProva(env, sessao, fala, medidas, pular, ultima) {
  const estado = sessao.estado;
  if (estado.fase === "fim") return json({ erro: "A prova terminou: falta só ver o resultado." }, 409);
  const tarefa = tarefaPorId(estado.tarefa);
  let veredito = null, reacao;
  if (estado.fase === "aquecimento") {
    reacao = "Nice to meet you! Let's begin.";
  } else if (pular) {
    veredito = { passou: false, motivo_pt: "pulou a tarefa", reacao_en: "No problem, let's try another one." };
    reacao = veredito.reacao_en;
  } else {
    veredito = await julgar(env, { tarefa, resposta: fala, medidas });
    reacao = veredito.reacao_en;
  }
  const novo = proximo(estado, veredito ? veredito.passou : null);
  const fim = novo.fase === "fim";
  const proxima = fim ? FECHAMENTO : tarefaPorId(novo.tarefa).texto;
  const textoIA = (reacao + " " + proxima).trim();

  await gravar(env, [
    env.DB.prepare("INSERT INTO turno (sessao_id, ordem, papel, texto, tarefa_id, nivel_tarefa, duracao_s, palavras, ppm, pausas_longas, veredito, criado_em) VALUES (?, ?, 'aluno', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(sessao.id, ultima + 1, fala, tarefa.id, tarefa.nivel, medidas.duracao_s, medidas.palavras, medidas.ppm, medidas.pausas_longas, veredito ? JSON.stringify(veredito) : null, agora()),
    env.DB.prepare("INSERT INTO turno (sessao_id, ordem, papel, texto, tarefa_id, criado_em) VALUES (?, ?, 'ia', ?, ?, ?)").bind(sessao.id, ultima + 2, textoIA, novo.tarefa, agora()),
    env.DB.prepare("UPDATE sessao SET estado = ? WHERE id = ?").bind(JSON.stringify(novo), sessao.id),
  ]);
  // O veredito NÃO vai para o app: a prova é às cegas, como numa prova de verdade.
  return json({ aluno: { texto: fala, medidas }, ia: { texto: textoIA, audio: await falar(env, textoIA) }, fim, progresso: progresso(novo) });
}

async function turnoConversa(env, sessao, fala, medidas, ultima) {
  const { results } = await env.DB.prepare("SELECT papel, texto FROM turno WHERE sessao_id = ? ORDER BY ordem").bind(sessao.id).all();
  const daAluna = results.filter((t) => t.papel === "aluno").length;
  if (daAluna >= MAX_TURNOS_CONVERSA) return json({ erro: "Esta conversa já está longa: encerre para ver o relatório e comece outra." }, 409);
  const historico = [...results, { papel: "aluno", texto: fala }];
  const r = await conversar(env, { nome: sessao.perfil_nome, nivel: sessao.estado.nivel, tema: TEMAS[sessao.tema], historico, errosRecorrentes: sessao.estado.erros });

  const ops = [
    env.DB.prepare("INSERT INTO turno (sessao_id, ordem, papel, texto, duracao_s, palavras, ppm, pausas_longas, criado_em) VALUES (?, ?, 'aluno', ?, ?, ?, ?, ?, ?)")
      .bind(sessao.id, ultima + 1, fala, medidas.duracao_s, medidas.palavras, medidas.ppm, medidas.pausas_longas, agora()),
    env.DB.prepare("INSERT INTO turno (sessao_id, ordem, papel, texto, criado_em) VALUES (?, ?, 'ia', ?, ?)").bind(sessao.id, ultima + 2, r.resposta, agora()),
  ];
  for (const c of r.correcoes) {
    ops.push(env.DB.prepare("INSERT INTO erro (perfil_id, sessao_id, errado, certo, explicacao, categoria, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(sessao.perfil_id, sessao.id, c.errado.slice(0, 300), c.certo.slice(0, 300), c.explicacao_pt.slice(0, 400), c.categoria, agora()));
  }
  await gravar(env, ops);
  return json({ aluno: { texto: fala, medidas, correcoes: r.correcoes }, ia: { texto: r.resposta, audio: await falar(env, r.resposta), dica_pt: r.dica_pt } });
}

/* Batch do D1 é atômico; o índice único de (sessao_id, ordem) transforma o envio duplicado em 409. */
async function gravar(env, ops) {
  try {
    await env.DB.batch(ops);
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw new Resposta(json({ erro: "Esta fala já foi enviada." }, 409));
    throw e;
  }
}

async function checarLimiteDiario(env, conta) {
  const limite = Number(env.LIMITE_TURNOS_DIA || 300);
  const hoje = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  const { n } = await env.DB.prepare(
    "SELECT count(*) AS n FROM turno t JOIN sessao s ON s.id = t.sessao_id JOIN perfil p ON p.id = s.perfil_id WHERE p.conta_id = ? AND t.papel = 'aluno' AND t.criado_em >= ?",
  ).bind(conta.id, hoje).first();
  if (n >= limite) throw new Resposta(json({ erro: "Limite de " + limite + " falas por dia nesta conta. Volte amanhã!" }, 429));
  const global = Number(env.LIMITE_GLOBAL_DIA || 800);
  const { g } = await env.DB.prepare("SELECT count(*) AS g FROM turno WHERE papel = 'aluno' AND criado_em >= ?").bind(hoje).first();
  if (g >= global) throw new Resposta(json({ erro: "O Stepwise chegou ao limite de uso de hoje. Volte amanhã!" }, 429));
}

/* ---------- encerrar ---------- */

async function encerrar(env, sessao) {
  if (sessao.status === "fechada") return json({ resultado: sessao.resultado });
  if (!["aberta", "falhou"].includes(sessao.status)) return json({ erro: "A correção já está em andamento." }, 409);
  const trava = await env.DB.prepare("UPDATE sessao SET status = 'avaliando' WHERE id = ? AND status IN ('aberta', 'falhou')").bind(sessao.id).run();
  if (!trava.meta.changes) return json({ erro: "A correção já está em andamento." }, 409);

  try {
    const resultado = sessao.tipo === "prova" ? await notaDaProva(env, sessao) : await relatorioDaConversa(env, sessao);
    const ops = [env.DB.prepare("UPDATE sessao SET status = 'fechada', resultado = ?, fechado_em = ? WHERE id = ?").bind(JSON.stringify(resultado), agora(), sessao.id)];
    if (sessao.tipo === "prova" && resultado.nivel) {
      ops.push(env.DB.prepare("UPDATE perfil SET nivel = ?, nivel_em = ? WHERE id = ?").bind(resultado.nivel, agora(), sessao.perfil_id));
      ops.push(env.DB.prepare("INSERT INTO nivel_historico (perfil_id, nivel, origem, sessao_id, criado_em) VALUES (?, ?, 'prova', ?, ?)").bind(sessao.perfil_id, resultado.nivel, sessao.id, agora()));
    }
    await env.DB.batch(ops);
    return json({ resultado });
  } catch (e) {
    await env.DB.prepare("UPDATE sessao SET status = 'falhou' WHERE id = ?").bind(sessao.id).run();
    console.log("encerrar falhou:", e && e.message);
    return json({ erro: "Não consegui corrigir agora (" + (e instanceof ErroIA ? mensagemIA(e.motivo) : "erro interno") + "). Suas respostas estão salvas: toque em tentar de novo.", pode_tentar_de_novo: true }, 502);
  }
}

async function notaDaProva(env, sessao) {
  const e = sessao.estado;
  if (e.fase !== "fim") return { incompleta: true }; // saiu no meio: nada muda no nível
  const { results } = await env.DB.prepare("SELECT texto, tarefa_id, nivel_tarefa, duracao_s, palavras, ppm, pausas_longas FROM turno WHERE sessao_id = ? AND papel = 'aluno' ORDER BY ordem").bind(sessao.id).all();
  const respostas = results
    .filter((t) => t.tarefa_id !== "aquecimento")
    .map((t) => {
      const tarefa = tarefaPorId(t.tarefa_id);
      return { tipo: tarefa.tipo, nivel: t.nivel_tarefa, tarefa: tarefa.texto, texto: t.texto, medidas: { palavras: t.palavras, duracao_s: t.duracao_s, ppm: t.ppm, pausas_longas: t.pausas_longas } };
    });
  const medidas = agregarMedidas(respostas.filter((r) => r.tipo === "fala").map((r) => r.medidas));
  const pedido = { respostas, escada: e.teto, escutaPassou: e.escuta_passou, medidas };
  const rodadas = await Promise.allSettled(Array.from({ length: RODADAS_AVALIACAO }, () => avaliarProva(env, pedido)));
  for (const r of rodadas) if (r.status === "rejected") console.log("rodada falhou:", r.reason && r.reason.message);
  const ok = rodadas.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (ok.length < 2) throw rodadas.find((r) => r.status === "rejected").reason;
  return { ...consolidar(ok, e.teto), medidas, escuta_passou: e.escuta_passou };
}

async function relatorioDaConversa(env, sessao) {
  const { results } = await env.DB.prepare("SELECT papel, texto FROM turno WHERE sessao_id = ? ORDER BY ordem").bind(sessao.id).all();
  if (results.filter((t) => t.papel === "aluno").length < 2) return { curta: true };
  const { results: correcoes } = await env.DB.prepare("SELECT errado, certo FROM erro WHERE sessao_id = ?").bind(sessao.id).all();
  return relatorio(env, { nivel: sessao.estado.nivel, historico: results, correcoes });
}

async function lerSessaoCompleta(env, sessao) {
  const { results } = await env.DB.prepare("SELECT ordem, papel, texto, duracao_s, palavras, ppm, pausas_longas FROM turno WHERE sessao_id = ? ORDER BY ordem").bind(sessao.id).all();
  const { results: erros } = await env.DB.prepare("SELECT errado, certo, explicacao, categoria FROM erro WHERE sessao_id = ? ORDER BY id").bind(sessao.id).all();
  return json({ id: sessao.id, tipo: sessao.tipo, tema: sessao.tema, status: sessao.status, iniciado_em: sessao.iniciado_em, resultado: sessao.resultado, progresso: sessao.tipo === "prova" ? progresso(sessao.estado) : null, turnos: results, erros });
}

/* ---------- utilitários ---------- */

function progresso(e) {
  const fases = { aquecimento: "Aquecimento", escada: "Conversa", escuta: "Escuta", fim: "Fim" };
  return { fase: e.fase, rotulo: fases[e.fase], passo: e.passos };
}

function publicoPerfil(p) {
  return { id: p.id, nome: p.nome, nivel: p.nivel, nivel_em: p.nivel_em };
}

function mensagemIA(motivo) {
  return { limite: "a IA está ocupada, tente em instantes", sem_chave: "a chave da IA não está configurada", chave_invalida: "a chave da IA foi recusada", sem_saldo: "a IA está sem crédito agora", cota_voz: "acabou a cota de hoje para ouvir a sua voz; ela volta às 21h (horário de Brasília)", ouvir: "não consegui ouvir o seu áudio agora", recusou: "a IA recusou esta resposta", cortou: "a resposta da IA veio cortada" }[motivo] || "a IA não respondeu";
}

class Resposta {
  constructor(resposta) {
    this.resposta = resposta;
  }
}

async function corpoJSON(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function agora() {
  return new Date().toISOString();
}

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function texto(t, status = 200) {
  return new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function comCabecalhos(r) {
  const h = new Headers(r.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");
  h.set("X-Frame-Options", "DENY");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
