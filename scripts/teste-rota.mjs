/* Prova de ponta a ponta no Worker local, em MODO FALSO (sem Claude, sem Workers AI, nada sai da máquina):
   login, perfis, isolamento entre contas, a prova inteira, a conversa com memória de erros, o limite diário e o
   "Sair" que revoga. `npm run teste:rota`.

   Banco próprio (.wrangler/teste), porta própria (8811): não encosta no que o Ronny tiver no `wrangler dev`.
   Lições do Bola Alta (04/10): um `wrangler dev` por vez, encerrado pela RAIZ da árvore (taskkill /T), e o banco
   só é lido pelo wrangler depois de derrubar o servidor. */

import { spawn, execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(RAIZ, "node_modules", "wrangler", "bin", "wrangler.js");
const PORTA = 8811; // porta só do Stepwise: o Bola Alta usa 8794–8797 (colidiu em 08/10)
const BASE = `http://localhost:${PORTA}`;
const PERSIST = path.join(RAIZ, ".wrangler", "teste");
const LIMITE = 14;

let ok = 0, falhou = 0;
function prova(nome, cond, detalhe = "") {
  if (cond) ok++;
  else { falhou++; console.log("  ✗ " + nome + (detalhe ? " — " + detalhe : "")); }
}

function wrangler(args, opcoes = {}) {
  return execFileSync(process.execPath, [WRANGLER, ...args], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opcoes });
}

/* ---------- servidor ---------- */

rmSync(PERSIST, { recursive: true, force: true });
wrangler(["d1", "migrations", "apply", "stepwise", "--local", "--persist-to", PERSIST], { env: { ...process.env, CI: "1" } });

const vars = { IA_FALSA: "1", MODO_LOCAL: "1", CONTAS_LIBERADAS: "a@teste.local,b@teste.local", SESSAO_SEGREDO: "segredo-de-teste", LIMITE_TURNOS_DIA: String(LIMITE), ANTHROPIC_API_KEY: "" };
const servidor = spawn(process.execPath, [WRANGLER, "dev", "--port", String(PORTA), "--persist-to", PERSIST, "--log-level", "warn", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
servidor.stdout.on("data", (d) => (log += d));
servidor.stderr.on("data", (d) => (log += d));

function derrubar() {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(servidor.pid), "/T", "/F"], { stdio: "ignore" });
    else servidor.kill("SIGTERM");
  } catch {}
}
process.on("exit", derrubar);

async function esperar() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + "/api/config")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(log);
  throw new Error("wrangler dev não subiu");
}

/* ---------- cliente ---------- */

async function entrar(email) {
  const r = await fetch(BASE + "/entrar/local", { method: "POST", body: new URLSearchParams({ email }), redirect: "manual" });
  const c = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")]).find((x) => x && x.startsWith("sessao="));
  return { status: r.status, cookie: c ? c.split(";")[0] : null };
}

function cliente(cookie) {
  const chamar = async (metodo, caminho, corpo, extra = {}) => {
    const headers = { Cookie: cookie || "", ...(extra.headers || {}) };
    let body = corpo;
    if (corpo && !(corpo instanceof Uint8Array)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, { method: metodo, headers, body, redirect: "manual" });
    let dados = null;
    try { dados = await r.json(); } catch {}
    return { status: r.status, dados };
  };
  return {
    get: (c) => chamar("GET", c),
    post: (c, corpo) => chamar("POST", c, corpo),
    patch: (c, corpo) => chamar("PATCH", c, corpo),
    falar: (sessao, frase, query = "") => chamar("POST", `/api/sessoes/${sessao}/turno${query}`, new Uint8Array([82, 73, 70, 70, 0, 0]), { headers: { "Content-Type": "audio/wav", "X-Teste-Fala": encodeURIComponent(frase) } }),
  };
}

/* ---------- provas ---------- */

try {
  await esperar();

  const cfg = await (await fetch(BASE + "/api/config")).json();
  prova("modo falso ligado (senão o teste gastaria IA de verdade)", cfg.iaFalsa === true && cfg.modoLocal === true, JSON.stringify(cfg));
  if (!cfg.iaFalsa) throw new Error("abortado: IA_FALSA não pegou — nada foi enviado à IA");

  console.log("página e login:");
  const pagina = await fetch(BASE + "/");
  const html = await pagina.text();
  prova("serve o app", pagina.status === 200 && html.includes("/app.js"));
  prova("CSP no app", (pagina.headers.get("content-security-policy") || "").includes("default-src 'self'"));
  prova("sem cookie → 401", (await cliente(null).get("/api/eu")).status === 401);
  prova("e-mail fora da lista → 403", (await entrar("estranho@teste.local")).status === 403);
  const a = await entrar("a@teste.local");
  prova("e-mail liberado entra", a.status === 302 && !!a.cookie);
  const A = cliente(a.cookie), B = cliente((await entrar("b@teste.local")).cookie);
  prova("cookie forjado → 401", (await cliente("sessao=abc.def").get("/api/eu")).status === 401);

  console.log("perfis e isolamento:");
  prova("perfil sem nome → 400", (await A.post("/api/perfis", { nome: "  " })).status === 400);
  const maria = (await A.post("/api/perfis", { nome: "Maria" })).dados;
  const ronny = (await A.post("/api/perfis", { nome: "Ronny" })).dados;
  const doB = (await B.post("/api/perfis", { nome: "Outra pessoa" })).dados;
  prova("dois perfis na mesma conta", (await A.get("/api/eu")).dados.perfis.length === 2);
  prova("conta B não vê perfil de A", (await B.get("/api/perfis/" + maria.id)).status === 404);
  prova("conta A não vê perfil de B", (await A.get("/api/perfis/" + doB.id)).status === 404);
  prova("conta B não começa prova no perfil de A", (await B.post(`/api/perfis/${maria.id}/prova`)).status === 404);

  console.log("prova:");
  const ini = await A.post(`/api/perfis/${maria.id}/prova`);
  const sid = ini.dados.sessao_id;
  prova("prova começa no aquecimento", ini.status === 201 && ini.dados.progresso.fase === "aquecimento" && ini.dados.ia.texto.includes("name"));
  prova("conta B não fala na sessão de A", (await B.falar(sid, "hello")).status === 404);
  prova("silêncio → 422 e não avança", (await A.falar(sid, "")).status === 422);
  let t = await A.falar(sid, "My name is Maria and I am from Palhoça");
  prova("aquecimento → escada", t.status === 200 && t.dados.progresso.fase === "escada", JSON.stringify(t.dados && t.dados.progresso));
  prova("veredito não vai para o app (prova às cegas)", !JSON.stringify(t.dados).includes("motivo") && !JSON.stringify(t.dados).includes("passou"));
  // aluna B1: passa em A2 e B1, cai duas vezes em B2
  t = await A.falar(sid, "[passa] I wake up at six and then I go to work");
  t = await A.falar(sid, "[passa] Last year I went to Gramado with my family");
  t = await A.falar(sid, "I think home office is good");
  prova("pular conta como resposta", (t = await A.falar(sid, "", "?pular=1")).status === 200);
  prova("depois de 2 quedas em B2 → escuta", t.dados.progresso.fase === "escuta", JSON.stringify(t.dados.progresso));
  prova("a escuta traz o trecho em áudio/texto", /Listen carefully/.test(t.dados.ia.texto));
  t = await A.falar(sid, "[passa] they were stressed and now they are happier");
  prova("escuta → fim", t.dados.fim === true);
  prova("depois do fim não aceita fala", (await A.falar(sid, "more")).status === 409);
  const fim = await A.post(`/api/sessoes/${sid}/encerrar`);
  prova("nota final = B1", fim.status === 200 && fim.dados.resultado.nivel === "B1", JSON.stringify(fim.dados));
  prova("escada registrada = B1, sem divergência", fim.dados.resultado.escada === "B1" && fim.dados.resultado.divergente === false);
  prova("3 rodadas de avaliação", fim.dados.resultado.rodadas === 3);
  // 4 respostas da escada, mas a pulada não tem fala: 3 entram nas medidas (a escuta não conta como fluência)
  prova("medidas no resultado", fim.dados.resultado.medidas && fim.dados.resultado.medidas.respostas === 3, JSON.stringify(fim.dados.resultado.medidas));
  prova("encerrar de novo devolve o mesmo resultado", (await A.post(`/api/sessoes/${sid}/encerrar`)).dados.resultado.nivel === "B1");
  let pm = (await A.get("/api/perfis/" + maria.id)).dados;
  prova("perfil da Maria ficou B1", pm.perfil.nivel === "B1");
  prova("perfil do Ronny segue sem nível", (await A.get("/api/perfis/" + ronny.id)).dados.perfil.nivel === null);
  const det = (await A.get("/api/sessoes/" + sid)).dados;
  prova("transcrição completa (1 + 6 falas de cada lado)", det.turnos.length === 13, String(det.turnos.length));

  console.log("prova abandonada:");
  const p2 = (await A.post(`/api/perfis/${maria.id}/prova`)).dados;
  await A.falar(p2.sessao_id, "Hi I am Maria");
  const ab = await A.post(`/api/sessoes/${p2.sessao_id}/encerrar`);
  prova("sair no meio → incompleta", ab.dados.resultado.incompleta === true);
  prova("e o nível não muda", (await A.get("/api/perfis/" + maria.id)).dados.perfil.nivel === "B1");

  console.log("conversa:");
  const c = await A.post(`/api/perfis/${maria.id}/conversa`, { tema: "viagem" });
  const cid = c.dados.sessao_id;
  prova("conversa começa com fala da IA", c.status === 201 && !!c.dados.ia.texto);
  prova("conversa usa o nível do perfil", c.dados.nivel === "B1");
  prova("conversa não aceita pular", (await A.falar(cid, "", "?pular=1")).status === 400);
  t = await A.falar(cid, "I have 30 years and I like to travel");
  prova("correção devolvida", t.dados.aluno.correcoes.length === 1 && t.dados.aluno.correcoes[0].certo === "I am 30 years old", JSON.stringify(t.dados.aluno));
  t = await A.falar(cid, "I went to Rio last year");
  const rel = await A.post(`/api/sessoes/${cid}/encerrar`);
  prova("relatório da conversa", rel.status === 200 && rel.dados.resultado.sinal === "no_nivel");
  pm = (await A.get("/api/perfis/" + maria.id)).dados;
  prova("erro aparece no perfil", pm.erros.some((e) => e.certo === "I am 30 years old"));
  prova("histórico lista prova e conversa", pm.sessoes.length === 3 && pm.sessoes.some((s) => s.tipo === "conversa" && s.sinal === "no_nivel"));
  const curta = (await A.post(`/api/perfis/${ronny.id}/conversa`, { tema: "inexistente" })).dados;
  prova("tema desconhecido vira dia-a-dia e perfil sem prova começa em A2", curta.nivel === "A2" && curta.sem_prova === true);
  const rc = await A.post(`/api/sessoes/${curta.sessao_id}/encerrar`);
  prova("conversa sem fala → curta, sem relatório", rc.dados.resultado.curta === true);

  console.log("ajuste manual:");
  prova("nível inválido → 400", (await A.patch("/api/perfis/" + ronny.id, { nivel: "Z9" })).status === 400);
  prova("nível manual", (await A.patch("/api/perfis/" + ronny.id, { nivel: "A2" })).status === 200 && (await A.get("/api/perfis/" + ronny.id)).dados.perfil.nivel === "A2");
  prova("conta B não ajusta perfil de A", (await B.patch("/api/perfis/" + maria.id, { nivel: "C2" })).status === 404);

  console.log("limite diário:");
  const lim = (await A.post(`/api/perfis/${ronny.id}/conversa`, { tema: "livre" })).dados;
  let status = 200, enviadas = 0;
  while (status === 200 && enviadas < 30) { status = (await A.falar(lim.sessao_id, "hello there friend")).status; if (status === 200) enviadas++; }
  // falas de aluno já gravadas hoje nesta conta: 6 (prova) + 1 (abandonada) + 2 (conversa) = 9
  prova(`limite de ${LIMITE} falas/dia → 429`, status === 429 && enviadas === LIMITE - 9, `status=${status} enviadas=${enviadas}`);
  prova("o limite é por conta (B segue falando)", (await B.falar((await B.post(`/api/perfis/${doB.id}/conversa`, {})).dados.sessao_id, "hello")).status === 200);

  console.log("sair:");
  const sai = await fetch(BASE + "/sair", { headers: { Cookie: a.cookie }, redirect: "manual" });
  prova("sair redireciona", sai.status === 302);
  await new Promise((r) => setTimeout(r, 20));
  prova("cookie antigo morre depois do sair", (await A.get("/api/eu")).status === 401);
} catch (e) {
  falhou++;
  console.log("  ✗ exceção: " + (e && e.stack));
} finally {
  derrubar();
}

/* ---------- banco, depois de derrubar ---------- */
await new Promise((r) => setTimeout(r, 1500));
try {
  const saida = wrangler(["d1", "execute", "stepwise", "--local", "--persist-to", PERSIST, "--json", "--command",
    "SELECT (SELECT count(*) FROM nivel_historico WHERE origem='prova') AS por_prova, (SELECT count(*) FROM nivel_historico WHERE origem='manual') AS manual, (SELECT count(*) FROM erro) AS erros, (SELECT count(*) FROM sessao WHERE status='avaliando') AS presas"]);
  const linha = JSON.parse(saida)[0].results[0];
  prova("banco: 1 nível por prova, 1 manual", linha.por_prova === 1 && linha.manual === 1, JSON.stringify(linha));
  prova("banco: 1 erro gravado", linha.erros === 1);
  prova("banco: nenhuma sessão presa em 'avaliando'", linha.presas === 0);
} catch (e) {
  falhou++;
  console.log("  ✗ leitura do banco: " + e.message);
}

console.log(`\nrota: ${ok} provas ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
