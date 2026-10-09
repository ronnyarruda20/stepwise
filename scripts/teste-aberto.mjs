/* Prova do login ABERTO (CONTAS_LIBERADAS="*", D11 de 08/10/2026) e das travas que seguram o gasto:
   qualquer e-mail entra, o teto de contas barra a conta nova (não as antigas) e o limite GLOBAL do dia barra
   todo mundo. Modo falso, banco e porta próprios (8811, como o teste:rota — rode um por vez). `npm run teste:aberto`. */

import { spawn, execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(RAIZ, "node_modules", "wrangler", "bin", "wrangler.js");
const PORTA = 8811;
const BASE = `http://localhost:${PORTA}`;
const PERSIST = path.join(RAIZ, ".wrangler", "teste-aberto");

let ok = 0, falhou = 0;
function prova(nome, cond, detalhe = "") {
  if (cond) ok++;
  else { falhou++; console.log("  ✗ " + nome + (detalhe ? " — " + detalhe : "")); }
}

rmSync(PERSIST, { recursive: true, force: true });
execFileSync(process.execPath, [WRANGLER, "d1", "migrations", "apply", "stepwise", "--local", "--persist-to", PERSIST], { cwd: RAIZ, stdio: "ignore", env: { ...process.env, CI: "1" } });
const vars = { IA_FALSA: "1", MODO_LOCAL: "1", CONTAS_LIBERADAS: "*", MAX_CONTAS: "2", LIMITE_TURNOS_DIA: "100", LIMITE_GLOBAL_DIA: "3", SESSAO_SEGREDO: "segredo-de-teste", DEEPSEEK_API_KEY: "" };
const servidor = spawn(process.execPath, [WRANGLER, "dev", "--port", String(PORTA), "--persist-to", PERSIST, "--log-level", "warn", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { cwd: RAIZ, stdio: "ignore" });
function derrubar() {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(servidor.pid), "/T", "/F"], { stdio: "ignore" });
    else servidor.kill("SIGTERM");
  } catch {}
}
process.on("exit", derrubar);

async function entrar(email) {
  const r = await fetch(BASE + "/entrar/local", { method: "POST", body: new URLSearchParams({ email }), redirect: "manual" });
  const c = r.headers.getSetCookie().find((x) => x.startsWith("sessao="));
  return { status: r.status, cookie: c ? c.split(";")[0] : null };
}
async function chamar(cookie, metodo, caminho, corpo, headers = {}) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { Cookie: cookie, ...headers }, body: corpo });
  let dados = null;
  try { dados = await r.json(); } catch {}
  return { status: r.status, dados };
}
const json = (o) => JSON.stringify(o);
const falar = (cookie, sid, frase) => chamar(cookie, "POST", `/api/sessoes/${sid}/turno`, new Uint8Array([1]), { "Content-Type": "audio/wav", "X-Teste-Fala": encodeURIComponent(frase) });

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + "/api/config")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const cfg = await (await fetch(BASE + "/api/config")).json();
  if (!cfg.iaFalsa) throw new Error("abortado: IA_FALSA não pegou");

  const a = await entrar("qualquer.pessoa@gmail.com");
  prova("com '*', e-mail desconhecido entra", a.status === 302 && !!a.cookie);
  const b = await entrar("outra.pessoa@gmail.com");
  prova("2ª conta entra (teto 2)", b.status === 302);
  prova("3ª conta nova é barrada pelo teto", (await entrar("terceira@gmail.com")).status === 403);
  prova("conta antiga entra de novo mesmo com o teto cheio", (await entrar("qualquer.pessoa@gmail.com")).status === 302);
  prova("e-mail vazio não entra", (await entrar("")).status === 403);

  const pa = (await chamar(a.cookie, "POST", "/api/perfis", json({ nome: "A" }), { "Content-Type": "application/json" })).dados;
  const pb = (await chamar(b.cookie, "POST", "/api/perfis", json({ nome: "B" }), { "Content-Type": "application/json" })).dados;
  const ca = (await chamar(a.cookie, "POST", `/api/perfis/${pa.id}/conversa`, json({}), { "Content-Type": "application/json" })).dados;
  const cb = (await chamar(b.cookie, "POST", `/api/perfis/${pb.id}/conversa`, json({}), { "Content-Type": "application/json" })).dados;
  prova("A fala 1", (await falar(a.cookie, ca.sessao_id, "hello one")).status === 200);
  prova("A fala 2", (await falar(a.cookie, ca.sessao_id, "hello two")).status === 200);
  prova("B fala 1 (3ª do dia somando todos)", (await falar(b.cookie, cb.sessao_id, "hello three")).status === 200);
  const barrado = await falar(b.cookie, cb.sessao_id, "hello four");
  prova("limite GLOBAL de 3 falas barra a 4ª, de outra conta", barrado.status === 429 && /limite de uso de hoje/.test(barrado.dados.erro), json(barrado));
  prova("e barra a conta A também", (await falar(a.cookie, ca.sessao_id, "hello five")).status === 429);
} catch (e) {
  falhou++;
  console.log("  ✗ exceção: " + (e && e.stack));
} finally {
  derrubar();
}

console.log(`\naberto: ${ok} provas ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
