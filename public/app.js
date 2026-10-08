/* Stepwise — o app. Uma página, telas desenhadas por funções; a API é o Worker (worker/index.js).
   iPhone primeiro: toque para começar a falar e toque de novo para enviar (segurar o botão no iOS abre menu
   de seleção e é ruim para quem está pensando no que dizer). Visual: estilo.css (referências do Pinterest no topo). */

import { Gravador, MAX_SEGUNDOS } from "/gravador.js";

const app = document.getElementById("app");
const voz = document.getElementById("voz");
const gravador = new Gravador();

const NOME_NIVEL = { "pre-A1": "Iniciante", A1: "Básico", A2: "Básico+", B1: "Intermediário", B2: "Intermediário+", C1: "Avançado", C2: "Proficiente" };
const NIVEIS = Object.keys(NOME_NIVEL);
const TEMAS = [
  { id: "dia-a-dia", nome: "Dia a dia", sub: "rotina, casa, família", emoji: "☕", classe: "dia" },
  { id: "viagem", nome: "Viagem", sub: "aeroporto, hotel, restaurante", emoji: "✈️", classe: "viagem" },
  { id: "trabalho", nome: "Trabalho", sub: "seu dia, colegas, reunião", emoji: "💼", classe: "trabalho" },
  { id: "livre", nome: "Livre", sub: "o assunto que você quiser", emoji: "💬", classe: "livre" },
];
const DIMENSAO = { vocabulario: "Vocabulário", gramatica: "Gramática", fluencia: "Fluência", compreensao: "Compreensão" };

/* Ícones em traço (24×24, currentColor). */
const ICONES = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
  parar: '<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  repetir: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
  som: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  pular: '<path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/>',
  voltar: '<path d="M15 18l-6-6 6-6"/>',
  seta: '<path d="M9 18l6-6-6-6"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  brilho: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
  prova: '<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 3h6v3H9z"/><path d="M9 13l2 2 4-4"/>',
  conversa: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  lapis: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
};

let devagar = pref("devagar") === "1";
let audioDesbloqueado = false;
let ultimaFala = null; // { audio, texto } — para o "Repetir"
let aoFalar = null;    // o orbe da sessão escuta isto para animar enquanto a IA fala

/* ---------- utilitários ---------- */

function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return el;
}

function icone(nome) {
  const s = h("span", { class: "icone", "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome]}</svg>`;
  return s;
}

function tela(...filhos) {
  app.className = "";
  app.replaceChildren(...filhos.flat().filter((f) => f != null && f !== false));
  window.scrollTo(0, 0);
}

function pref(chave, valor) {
  try {
    if (valor === undefined) return localStorage.getItem("stepwise." + chave);
    localStorage.setItem("stepwise." + chave, valor);
  } catch { return null; }
}

class ErroApi extends Error {
  constructor(msg, status, dados) { super(msg); this.status = status; this.dados = dados; }
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, { credentials: "same-origin", ...opcoes });
  let dados = null;
  try { dados = await r.json(); } catch {}
  if (r.status === 401) { telaEntrar(); throw new ErroApi("sem sessão", 401); }
  if (!r.ok) throw new ErroApi((dados && dados.erro) || "Erro " + r.status, r.status, dados);
  return dados;
}

function postJSON(caminho, corpo) {
  return api(caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo || {}) });
}

function data(iso) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

function numero(x) {
  return Number(x || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function iniciais(nome) {
  return String(nome || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function saudacao() {
  const hora = new Date().getHours();
  return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
}

/* Anel com o nível no centro; a volta cheia é C2. */
function anel(nivel, grande) {
  const r = 44, c = 2 * Math.PI * r;
  const frac = nivel ? (NIVEIS.indexOf(nivel) + 1) / NIVEIS.length : 0;
  const el = h("div", { class: "anel" + (grande ? " grande" : ""), role: "img", "aria-label": nivel ? "Nível " + nivel : "Sem nível" });
  el.innerHTML = `<svg viewBox="0 0 100 100"><circle class="fundo-anel" cx="50" cy="50" r="${r}" fill="none" stroke-width="9"/><circle class="frente" cx="50" cy="50" r="${r}" fill="none" stroke-width="9" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>`;
  el.append(h("div", { class: "centro-anel" }, h("b", {}, nivel || "?"), h("span", {}, nivel ? NOME_NIVEL[nivel] : "sem nível")));
  requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector(".frente").style.strokeDashoffset = String(c * (1 - frac)); }));
  return el;
}

/* ---------- áudio ---------- */

/* O iOS só deixa tocar som depois de um toque: no 1º toque tocamos meio segundo de silêncio. */
function desbloquearAudio() {
  if (audioDesbloqueado) return;
  audioDesbloqueado = true;
  voz.src = URL.createObjectURL(silencio());
  voz.play().catch(() => {});
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}

function silencio() {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, "data"); v.setUint32(40, n * 2, true);
  return new Blob([buf], { type: "audio/wav" });
}

function pararAudio() {
  try { voz.pause(); } catch {}
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (aoFalar) aoFalar(false);
}

voz.addEventListener("ended", () => aoFalar && aoFalar(false));
voz.addEventListener("pause", () => aoFalar && aoFalar(false));

/* Toca a voz da IA (MP3 do servidor) ou, se ele não veio, a voz do próprio aparelho. */
async function tocar(fala) {
  if (!fala) return;
  ultimaFala = fala;
  pararAudio();
  if (fala.audio) {
    const bytes = Uint8Array.from(atob(fala.audio), (c) => c.charCodeAt(0));
    voz.src = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    voz.playbackRate = devagar ? 0.8 : 1;
    try { await voz.play(); if (aoFalar) aoFalar(true); return; } catch {}
  }
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(fala.texto);
    u.lang = "en-US";
    u.rate = devagar ? 0.75 : 0.95;
    const v = speechSynthesis.getVoices().find((x) => x.lang === "en-US");
    if (v) u.voice = v;
    u.onstart = () => aoFalar && aoFalar(true);
    u.onend = () => aoFalar && aoFalar(false);
    speechSynthesis.speak(u);
  }
}

/* ---------- entrar ---------- */

async function telaEntrar() {
  let cfg = { modoLocal: false };
  try { cfg = await (await fetch("/api/config")).json(); } catch {}
  const local = cfg.modoLocal
    ? h("form", { method: "post", action: "/entrar/local" },
        h("p", { class: "pequeno" }, "Modo local (só no computador)"),
        h("input", { name: "email", type: "email", value: "local@stepwise.test", "aria-label": "E-mail" }),
        h("button", { class: "branco", type: "submit" }, "Entrar (modo local)"))
    : null;
  const google = h("a", { class: "botao branco cheio", href: "/entrar" });
  google.innerHTML = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg><span>Entrar com o Google</span>';
  tela(h("section", { class: "capa" },
    h("div", { class: "marca" }, h("img", { src: "/icone-192.png", alt: "" }), "Stepwise"),
    h("h1", {}, "Fale inglês, um degrau por vez."),
    h("p", { class: "suave" }, "Uma prova de nível só conversando, e depois conversas que corrigem o que importa."),
    h("div", { class: "cena", "aria-hidden": "true" },
      h("div", { class: "bolha b1" }, "Hi! How was your day? 👋"),
      orbeEnfeite(),
      h("div", { class: "bolha b2" }, "It ", h("b", {}, "was"), " great, thanks!")),
    google,
    h("p", { class: "suave pequeno" }, "Em fase de teste. O que você fala é transcrito e guardado para a IA corrigir e lembrar dos seus erros; o áudio não fica salvo."),
    local,
  ));
}

function orbeEnfeite() {
  return h("div", { class: "orbe", "data-modo": "pronto" }, h("span", { class: "halo" }), h("span", { class: "halo h2" }), h("span", { class: "nucleo" }, icone("mic")));
}

/* ---------- perfis ---------- */

async function telaPerfis() {
  const eu = await api("/api/eu");
  const ultimo = Number(pref("perfil"));
  if (eu.perfis.length === 1 && !telaPerfis.escolher) return telaPerfil(eu.perfis[0].id);
  if (ultimo && eu.perfis.some((p) => p.id === ultimo) && !telaPerfis.escolher) return telaPerfil(ultimo);
  telaPerfis.escolher = false;

  const erro = h("p", { class: "erro", role: "alert" });
  const nome = h("input", { placeholder: "Nome de quem vai estudar", maxlength: "40", "aria-label": "Nome" });
  const criar = h("form", { class: "cartao", onsubmit: async (e) => {
    e.preventDefault();
    try { const p = await postJSON("/api/perfis", { nome: nome.value }); telaPerfil(p.id); } catch (x) { erro.textContent = x.message; }
  } }, h("h3", {}, eu.perfis.length ? "Novo perfil" : "Quem vai estudar?"), nome, h("button", { type: "submit" }, icone("mais"), "Criar perfil"), erro);

  tela(
    h("div", { class: "linha entre" }, h("h2", {}, "Stepwise"), h("a", { class: "botao redondo", href: "/sair", "aria-label": "Sair" }, icone("sair"))),
    h("h1", {}, eu.perfis.length ? "Quem vai estudar agora?" : "Vamos começar"),
    eu.perfis.length ? h("div", { class: "perfis" }, eu.perfis.map((p) =>
      h("button", { class: "perfil-cartao", onclick: () => telaPerfil(p.id) }, h("span", { class: "avatar" }, iniciais(p.nome)), p.nome, h("span", { class: "selo" }, p.nivel || "sem nível")))) : null,
    criar,
  );
}

async function telaPerfil(id) {
  pref("perfil", String(id));
  const d = await api("/api/perfis/" + id);
  const p = d.perfil;
  const erro = h("p", { class: "erro", role: "alert" });

  const comecar = async (fn) => {
    desbloquearAudio();
    erro.textContent = "";
    try { await fn(); } catch (x) { if (x.status !== 401) erro.textContent = x.message; }
  };
  const fazerProva = () => comecar(async () => telaSessao(await postJSON("/api/perfis/" + id + "/prova"), p));
  const conversar = (tema) => comecar(async () => { pref("tema", tema); telaSessao(await postJSON("/api/perfis/" + id + "/conversa", { tema }), p); });

  const heroi = h("section", { class: "heroi" },
    h("div", { class: "linha entre" },
      h("div", {}, h("p", { class: "suave" }, saudacao() + ","), h("h1", {}, p.nome + " 👋")),
      anel(p.nivel)),
    h("p", { class: "suave" }, p.nivel
      ? "Seu nível é " + NOME_NIVEL[p.nivel] + (p.nivel_em ? ", medido em " + data(p.nivel_em) : "") + ". Bora conversar?"
      : "Comece pela prova: em uns 10 minutos, só conversando, ela descobre o seu nível."),
    p.nivel ? null : h("button", { class: "branco", onclick: fazerProva }, icone("prova"), "Descobrir meu nível"));

  const sugestao = d.sugestao_prova
    ? h("div", { class: "aviso" }, d.sugestao_prova === "acima"
        ? "🚀 Suas últimas 3 conversas ficaram acima do seu nível. Que tal refazer a prova?"
        : "Suas últimas 3 conversas ficaram difíceis. Refazer a prova pode ajustar o nível.")
    : null;

  const prova = p.nivel ? h("button", { class: "acao", onclick: fazerProva },
    h("span", { class: "ico-bloco" }, icone("prova")),
    h("span", { class: "txt" }, h("b", {}, "Refazer a prova de nível"), h("span", { class: "suave pequeno" }, "~10 min · umas 6 perguntas faladas + 1 de escuta")),
    h("span", { class: "seta" }, icone("seta"))) : null;

  const temas = h("div", { class: "secao" },
    h("div", { class: "titulo" }, h("h2", {}, "Conversar sobre…"), p.nivel ? null : h("span", { class: "suave pequeno" }, "no A2, sem prova")),
    h("div", { class: "temas" }, TEMAS.map((t) =>
      h("button", { class: "tema " + t.classe, onclick: () => conversar(t.id) }, h("span", { class: "emoji" }, t.emoji), h("span", {}, h("b", {}, t.nome), h("br"), h("span", { class: "sub" }, t.sub))))));

  const erros = d.erros.length ? h("div", { class: "secao" },
    h("div", { class: "titulo" }, h("h2", {}, "Para não esquecer"), h("span", { class: "suave pequeno" }, "deslize →")),
    h("div", { class: "trilho" }, d.erros.map((e) => h("div", { class: "ficha" },
      h("p", {}, h("s", { class: "errou" }, e.errado)), h("p", {}, h("b", { class: "certo" }, e.certo)), e.explicacao ? h("p", { class: "suave pequeno" }, e.explicacao) : null)))) : null;

  const historico = d.sessoes.length ? h("div", { class: "secao" }, h("div", { class: "titulo" }, h("h2", {}, "Histórico")),
    h("ul", { class: "lista" }, d.sessoes.map((s) => {
      const tema = TEMAS.find((t) => t.id === s.tema);
      const fim = s.status === "fechada" ? (s.incompleta ? "incompleta" : s.nivel ? s.nivel : rotuloSinal(s.sinal)) : s.status === "falhou" ? "corrigir de novo" : "não terminada";
      return h("li", {}, h("button", { class: "item", disabled: s.status !== "fechada" && s.status !== "falhou", onclick: () => telaResultado(s.id, p) },
        h("span", { class: "mini-ico" }, s.tipo === "prova" ? icone("prova") : h("span", {}, tema ? tema.emoji : "💬")),
        h("span", { class: "txt" }, s.tipo === "prova" ? "Prova de nível" : "Conversa · " + (tema ? tema.nome : "livre"), h("span", {}, data(s.iniciado_em))),
        h("span", { class: "selo" }, fim)));
    }))) : null;

  const ajuste = h("select", { "aria-label": "Ajustar nível", onchange: async (e) => {
    if (!e.target.value) return;
    await api("/api/perfis/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nivel: e.target.value }) });
    telaPerfil(id);
  } }, h("option", { value: "" }, "Ajustar o nível à mão…"), NIVEIS.map((n) => h("option", { value: n }, n + " · " + NOME_NIVEL[n])));

  tela(
    h("div", { class: "linha entre" },
      h("button", { class: "fantasma", onclick: () => { telaPerfis.escolher = true; telaPerfis(); } }, icone("voltar"), "Perfis"),
      h("a", { class: "botao redondo", href: "/sair", "aria-label": "Sair" }, icone("sair"))),
    heroi,
    sugestao,
    erro,
    prova,
    temas,
    erros,
    historico,
    h("details", { class: "cartao" }, h("summary", {}, "Ajustes"),
      ajuste,
      h("label", { class: "interruptor" }, h("span", {}, "Voz da IA mais devagar"),
        h("input", { type: "checkbox", role: "switch", checked: devagar, onchange: (e) => { devagar = e.target.checked; pref("devagar", devagar ? "1" : "0"); } }))),
  );
}

function rotuloSinal(s) {
  return { acima: "acima do nível", no_nivel: "no nível", abaixo: "abaixo do nível" }[s] || "relatório";
}

/* ---------- sessão (prova ou conversa) ---------- */

function telaSessao(inicio, perfil) {
  const ehProva = inicio.tipo === "prova";
  let progresso = inicio.progresso;
  let falas = 0;
  let ocupado = false;
  let timer = null, quadro = null;

  const mensagens = h("div", { class: "mensagens", "aria-live": "polite" });
  const estado = h("p", { class: "estado" }, "Toque no microfone para responder.");
  const fase = h("span");
  const barra = h("i");
  const halo1 = h("span", { class: "halo" }), halo2 = h("span", { class: "halo h2" }), nucleo = h("span", { class: "nucleo" }, icone("mic"));
  const orbe = h("button", { class: "orbe", "data-modo": "pronto", "aria-label": "Falar", onclick: () => alternar() }, halo1, halo2, nucleo);
  const repetir = h("div", { class: "lado" }, h("button", { class: "redondo", "aria-label": "Repetir", onclick: () => { desbloquearAudio(); tocar(ultimaFala); } }, icone("repetir")), "Repetir");
  const pularBt = ehProva ? h("button", { class: "redondo", "aria-label": "Pular pergunta", onclick: () => enviar(null, true) }, icone("pular")) : null;
  const ladoDireito = ehProva ? h("div", { class: "lado" }, pularBt, "Pular") : h("div", { class: "lado" }, h("button", { class: "redondo", "aria-label": "Encerrar e ver relatório", onclick: () => sair() }, icone("brilho")), "Relatório");
  const velocidade = h("button", { class: "pilula", "aria-pressed": String(devagar), onclick: () => {
    devagar = !devagar; pref("devagar", devagar ? "1" : "0");
    velocidade.setAttribute("aria-pressed", String(devagar)); velocidade.textContent = devagar ? "0.8×" : "1×";
  } }, devagar ? "0.8×" : "1×");

  function atualizarTopo() {
    if (ehProva) {
      const f = progresso ? progresso.fase : "aquecimento";
      const frac = f === "aquecimento" ? 0.08 : f === "escada" ? Math.min(0.75, 0.18 + progresso.passo * 0.12) : f === "escuta" ? 0.88 : 1;
      barra.style.width = Math.round(frac * 100) + "%";
      fase.textContent = "Prova de nível · " + (progresso ? progresso.rotulo : "");
    } else {
      barra.style.width = Math.min(100, Math.round((falas / 10) * 100)) + "%";
      fase.textContent = "Conversa · nível " + (inicio.nivel || "") + " · " + falas + " fala" + (falas === 1 ? "" : "s");
    }
  }

  function balaoIA(ia) {
    const escuta = ehProva && progresso && progresso.fase === "escuta";
    const fala = { audio: ia.audio, texto: ia.texto };
    const ouvir = h("button", { class: "ouvir", "aria-label": "Ouvir de novo", onclick: () => { desbloquearAudio(); tocar(fala); } }, icone("som"));
    mensagens.append(escuta
      ? h("div", { class: "balao ia oculto" }, ouvir, h("span", {}, "Pergunta de escuta: ouça com atenção. O texto fica escondido, mas dá para ouvir de novo."))
      : h("div", { class: "balao ia" }, ouvir, h("span", {}, ia.texto)));
    if (ia.dica_pt) mensagens.append(h("p", { class: "dica" }, "💡 " + ia.dica_pt));
    rolar();
  }

  function rolar() { mensagens.scrollTop = mensagens.scrollHeight; }

  function modo(m) {
    orbe.dataset.modo = m;
    nucleo.replaceChildren(icone(m === "ouvindo" ? "parar" : "mic"));
    orbe.setAttribute("aria-label", m === "ouvindo" ? "Enviar" : "Falar");
    orbe.disabled = m === "pensando";
    if (pularBt) pularBt.disabled = m !== "pronto" && m !== "falando";
  }

  aoFalar = (falando) => { if (!gravador.gravando && !ocupado) modo(falando ? "falando" : "pronto"); };

  function animarVolume() {
    orbe.style.setProperty("--vol", gravador.volume.toFixed(3));
    quadro = requestAnimationFrame(animarVolume);
  }

  async function alternar() {
    if (ocupado) return;
    desbloquearAudio();
    if (!gravador.gravando) {
      gravador.preparar(); // dentro do toque (iPhone)
      pararAudio();
      try {
        await gravador.iniciar();
      } catch (e) {
        estado.textContent = e && e.name === "NotAllowedError" ? "O microfone foi bloqueado. No iPhone: Ajustes › Safari › Microfone › Permitir." : "Não consegui abrir o microfone.";
        return;
      }
      modo("ouvindo");
      animarVolume();
      estado.textContent = "Ouvindo… toque de novo para enviar.";
      timer = setInterval(() => {
        const s = gravador.segundos();
        estado.textContent = "Ouvindo… " + Math.floor(s) + " s · toque para enviar";
        if (s >= MAX_SEGUNDOS) alternar();
      }, 500);
    } else {
      clearInterval(timer);
      cancelAnimationFrame(quadro);
      orbe.style.setProperty("--vol", "0");
      const dur = gravador.segundos();
      const wav = await gravador.parar();
      if (!wav || dur < 0.6) { modo("pronto"); estado.textContent = "Curto demais. Toque e fale a resposta inteira."; return; }
      enviar(wav, false);
    }
  }

  async function enviar(wav, pulou) {
    ocupado = true;
    modo("pensando");
    estado.textContent = pulou ? "Pulando…" : "Entendendo o que você disse…";
    try {
      const r = await api("/api/sessoes/" + inicio.sessao_id + "/turno" + (pulou ? "?pular=1" : ""), { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav || new Blob([]) });
      if (!pulou) { mensagens.append(h("div", { class: "balao aluno" }, r.aluno.texto)); falas++; }
      for (const c of (r.aluno && r.aluno.correcoes) || []) {
        mensagens.append(h("div", { class: "correcao" }, h("span", { class: "rotulo" }, icone("lapis"), "Dá para dizer assim"),
          h("span", {}, h("s", { class: "errou" }, c.errado), "  →  ", h("b", { class: "certo" }, c.certo)), h("span", { class: "suave pequeno" }, c.explicacao_pt)));
      }
      if (r.progresso) progresso = r.progresso;
      atualizarTopo();
      balaoIA(r.ia);
      ocupado = false;
      modo("pronto");
      tocar(r.ia);
      if (r.fim) return terminar();
      estado.textContent = "Sua vez. Toque no microfone.";
    } catch (e) {
      ocupado = false;
      if (!gravador.gravando) modo("pronto");
      if (e.status === 401) return;
      estado.textContent = e.message;
    }
  }

  async function terminar() {
    ocupado = true;
    modo("pensando");
    estado.textContent = ehProva ? "Corrigindo a sua prova… leva uns 30 segundos." : "Escrevendo o seu relatório…";
    try {
      await postJSON("/api/sessoes/" + inicio.sessao_id + "/encerrar");
      aoFalar = null;
      telaResultado(inicio.sessao_id, perfil);
    } catch (e) {
      estado.textContent = e.message;
      ocupado = false;
      modo("pronto");
      orbe.replaceWith(h("button", { onclick: terminar }, "Tentar corrigir de novo"));
    }
  }

  function sair() {
    if (gravador.gravando) return;
    const msg = ehProva ? "Sair da prova agora? Ela fica incompleta e o seu nível não muda." : "Encerrar a conversa e ver o relatório?";
    if (!confirm(msg)) return;
    pararAudio();
    if (ehProva && !(progresso && progresso.fase === "fim")) {
      aoFalar = null;
      postJSON("/api/sessoes/" + inicio.sessao_id + "/encerrar").catch(() => {}).finally(() => telaPerfil(perfil.id));
    } else terminar();
  }

  tela(
    h("div", { class: "barra-topo" },
      h("button", { class: "redondo", "aria-label": ehProva ? "Sair da prova" : "Encerrar", onclick: sair }, icone("x")),
      h("div", { class: "meio" }, h("h3", {}, perfil.nome), fase),
      velocidade),
    h("div", { class: "progresso", role: "progressbar", "aria-label": "Progresso" }, barra),
    inicio.sem_prova ? h("div", { class: "aviso" }, "Você ainda não fez a prova: a conversa está no A2.") : null,
    mensagens,
    h("div", { class: "doca" }, estado, h("div", { class: "fileira" }, repetir, orbe, ladoDireito)),
  );
  app.className = "sessao";
  atualizarTopo();
  modo("pronto");
  balaoIA(inicio.ia);
  tocar(inicio.ia);
}

/* ---------- resultado ---------- */

async function telaResultado(id, perfil) {
  let s = await api("/api/sessoes/" + id);
  if (s.status === "falhou") {
    try { await postJSON("/api/sessoes/" + id + "/encerrar"); s = await api("/api/sessoes/" + id); }
    catch (e) { return tela(h("h1", {}, "Quase lá"), h("p", { class: "erro" }, e.message), h("button", { onclick: () => telaResultado(id, perfil) }, "Tentar de novo"), h("button", { class: "secundario", onclick: () => telaPerfil(perfil.id) }, "Voltar")); }
  }
  const r = s.resultado || {};
  const voltar = h("button", { class: "secundario cheio", onclick: () => telaPerfil(perfil.id) }, "Voltar ao início");
  const topo = h("div", { class: "linha entre" }, h("button", { class: "fantasma", onclick: () => telaPerfil(perfil.id) }, icone("voltar"), "Início"), h("span", { class: "suave pequeno" }, data(s.iniciado_em)));
  const transcricao = h("details", { class: "cartao" }, h("summary", {}, "Ver a conversa inteira"),
    s.turnos.map((t) => h("p", { class: "pequeno" + (t.papel === "ia" ? " suave" : "") }, h("b", {}, t.papel === "ia" ? "IA: " : "Você: "), t.texto)));
  const conversarAgora = h("button", { class: "cheio", onclick: async () => {
    desbloquearAudio();
    try { telaSessao(await postJSON("/api/perfis/" + perfil.id + "/conversa", { tema: pref("tema") || "dia-a-dia" }), { ...perfil, nivel: r.nivel || perfil.nivel }); } catch (e) { alert(e.message); }
  } }, icone("conversa"), "Conversar agora");

  if (s.tipo === "prova") {
    if (r.incompleta) return tela(topo, h("h1", {}, "Prova incompleta"), h("p", { class: "suave" }, "Você saiu antes do fim, então o seu nível não mudou."), voltar);
    return tela(
      topo,
      h("section", { class: "heroi resultado" },
        h("p", { class: "suave" }, "Seu nível de inglês falado"),
        anel(r.nivel, true),
        null,
        h("p", {}, r.resumo)),
      r.divergente ? h("div", { class: "aviso" }, "As duas medidas da prova discordaram bastante desta vez. O nível vale, mas refazer a prova daqui a alguns dias deixa o resultado mais firme.") : null,
      h("div", { class: "cartao" }, h("h3", {}, "Por habilidade"), Object.entries(DIMENSAO).map(([k, rotulo]) => {
        const n = r.notas && r.notas[k];
        const i = NIVEIS.indexOf(n);
        return h("div", { class: "habilidade" }, h("div", { class: "linha" }, h("span", {}, rotulo), h("span", { class: "selo" }, n || "–")),
          h("div", { class: "degraus", "aria-hidden": "true" }, NIVEIS.map((_, j) => h("i", { class: j <= i ? "cheio" : "" }))));
      })),
      r.medidas ? h("div", { class: "estatisticas" },
        h("div", { class: "estatistica" }, h("b", {}, numero(r.medidas.palavras_por_resposta)), h("span", {}, "palavras por resposta")),
        h("div", { class: "estatistica" }, h("b", {}, numero(r.medidas.ppm_medio)), h("span", {}, "palavras por minuto"))) : null,
      h("div", { class: "secao" }, h("div", { class: "titulo" }, h("h2", {}, "Para treinar primeiro")),
        (r.prioridades || []).map((p, i) => h("div", { class: "cartao prioridade" }, h("span", { class: "num" }, String(i + 1)),
          h("div", { class: "corpo" }, h("h3", {}, p.tema),
            p.exemplo_dela ? h("p", { class: "pequeno" }, "Você disse: ", h("s", { class: "errou" }, p.exemplo_dela)) : null,
            h("p", { class: "pequeno" }, "Em inglês: ", h("b", { class: "certo" }, p.como_dizer)),
            h("p", { class: "suave pequeno" }, p.dica))))),
      conversarAgora,
      transcricao,
      voltar,
    );
  }

  if (r.curta) return tela(topo, h("h1", {}, "Conversa curta"), h("p", { class: "suave" }, "Foram poucas falas para um relatório. Da próxima vez, tente umas 5 trocas."), transcricao, voltar);
  const emoji = { acima: "🚀", no_nivel: "👏", abaixo: "💪" }[r.sinal] || "✨";
  tela(
    topo,
    h("section", { class: "heroi" }, h("p", { class: "suave" }, "Relatório da conversa"), h("h1", {}, emoji + " " + (r.sinal === "acima" ? "Acima do seu nível!" : r.sinal === "abaixo" ? "Hoje foi puxado" : "Mandou bem")), h("p", {}, r.resumo_pt)),
    (r.acertos_pt || []).length ? h("div", { class: "cartao" }, h("h3", {}, "O que você fez bem"), r.acertos_pt.map((a) => h("p", { class: "pequeno" }, "✓ " + a))) : null,
    (r.foco_pt || []).length ? h("div", { class: "cartao" }, h("h3", {}, "Para praticar"), r.foco_pt.map((a) => h("p", { class: "pequeno" }, "→ " + a))) : null,
    s.erros.length ? h("div", { class: "secao" }, h("div", { class: "titulo" }, h("h2", {}, "Correções")), h("div", { class: "trilho" }, s.erros.map((e) => h("div", { class: "ficha" },
      h("p", {}, h("s", { class: "errou" }, e.errado)), h("p", {}, h("b", { class: "certo" }, e.certo)), h("p", { class: "suave pequeno" }, e.explicacao))))) : null,
    (r.palavras_novas || []).length ? h("div", { class: "cartao" }, h("h3", {}, "Palavras novas"), r.palavras_novas.map((w) => h("p", { class: "pequeno" }, h("b", {}, w.en), " — " + w.pt))) : null,
    conversarAgora,
    transcricao,
    voltar,
  );
}

/* ---------- início ---------- */

telaPerfis().catch((e) => { if (e.status !== 401) tela(h("h1", {}, "Stepwise"), h("p", { class: "erro" }, e.message)); });
