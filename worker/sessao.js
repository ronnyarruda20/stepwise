/* Sessão em cookie assinado por HMAC e login com o Google — copiado do Bola Alta (Projetos/bolaalta/worker/sessao.js,
   que veio do painel da secretária e passou pela revisão de segurança de 23/09/2026). Única troca: a tabela é
   `conta`, não `usuario`. Sem estado no servidor: o cookie carrega e-mail + validade. */

export const ROTAS_SESSAO = { entrar: "/entrar", callback: "/entrar/volta", sair: "/sair" };
export const DURACAO_SESSAO = 30 * 24 * 60 * 60 * 1000;
const DURACAO_ESTADO = 10 * 60 * 1000;

export function irParaGoogle(url, env) {
  const estado = aleatorio();
  const destino = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  destino.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  destino.searchParams.set("redirect_uri", url.origin + ROTAS_SESSAO.callback);
  destino.searchParams.set("response_type", "code");
  destino.searchParams.set("scope", "openid email profile");
  destino.searchParams.set("state", estado);
  destino.searchParams.set("prompt", "select_account");
  // ?volta=/caminho — só caminho local
  const volta = voltaValida(url.searchParams.get("volta"));
  const cabecalhos = [["Location", destino.toString()], ["Set-Cookie", cookie("estado", estado, DURACAO_ESTADO / 1000)]];
  if (volta) cabecalhos.push(["Set-Cookie", cookie("volta", encodeURIComponent(volta), DURACAO_ESTADO / 1000)]);
  return new Response(null, { status: 302, headers: cabecalhos });
}

/* Destino pós-login: só caminho do próprio site ("/x"), nunca "//outro.site" nem "/\\" (redirecionamento aberto). */
export function voltaValida(v) {
  const s = String(v || "");
  return /^\/(?![\/\\])[\w\-\/.~%?=&]*$/.test(s) && s.length <= 200 ? s : null;
}

/* O destino guardado no cookie `volta` pelo irParaGoogle, já validado; null se não há. */
export function lerVolta(requisicao) {
  const c = lerCookie(requisicao, "volta");
  if (!c) return null;
  try { return voltaValida(decodeURIComponent(c)); } catch { return null; }
}

/* Devolve { email, nome } ou { erro: "mensagem" }. Quem decide o que fazer com o e-mail é o index. */
export async function voltarDoGoogle(requisicao, url, env) {
  const codigo = url.searchParams.get("code");
  const estado = url.searchParams.get("state") || "";
  const esperado = lerCookie(requisicao, "estado");
  if (!codigo || !estado || !esperado || estado !== esperado) return { erro: "O login não pôde ser confirmado (estado inválido). Tente de novo." };
  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: codigo, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + ROTAS_SESSAO.callback, grant_type: "authorization_code" }),
  });
  if (!t.ok) return { erro: "O Google recusou o código. Confira o redirect URI do cliente OAuth: " + url.origin + ROTAS_SESSAO.callback };
  const { access_token } = await t.json();
  const p = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + access_token } });
  if (!p.ok) return { erro: "O Google aceitou o código mas recusou a leitura do perfil." };
  const perfil = await p.json();
  const email = normalizar(perfil.email);
  if (!perfil.email_verified || !email) return { erro: "Esta conta Google não tem e-mail verificado." };
  return { email, nome: perfil.name || "" };
}

export async function respostaComSessao(email, env, destino = "/", duracao = DURACAO_SESSAO) {
  return new Response(null, {
    status: 302,
    headers: [["Location", destino], ["Set-Cookie", cookie("estado", "", 0)], ["Set-Cookie", cookie("volta", "", 0)], ["Set-Cookie", cookie("sessao", await assinar(email, env, duracao), duracao / 1000)]],
  });
}

/* Sair REVOGA (revisão de 23/09, item 3): grava conta.sessao_desde = agora, e lerSessao recusa qualquer cookie
   assinado antes disso — inclusive um roubado, em outro aparelho. É "sair de todos os aparelhos", de propósito: sem
   estado por sessão, é a única forma de um cookie morrer antes do fim (30 dias aqui: no iPhone, login todo dia afasta a aluna). Um GET vindo de OUTRO site (Sec-Fetch-Site:
   cross-site — um <img src="/sair"> numa página alheia) não desloga ninguém: só volta para a landing. */
export async function sair(requisicao, env) {
  const de = requisicao.headers.get("Sec-Fetch-Site");
  if (de === "cross-site") return new Response(null, { status: 302, headers: { Location: "/" } });
  const sessao = await lerSessao(requisicao, env);
  if (sessao) await env.DB.prepare("UPDATE conta SET sessao_desde = ? WHERE email = ?").bind(new Date().toISOString(), sessao.email).run();
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": cookie("sessao", "", 0) } });
}

/* duracao: DURACAO_SESSAO (30 dias) para quem entra pelo Google. */
export async function assinar(email, env, duracao = DURACAO_SESSAO) {
  const agora = Date.now();
  const corpo = b64u(JSON.stringify({ email, iat: agora, exp: agora + duracao }));
  return corpo + "." + b64u(await hmac(corpo, env.SESSAO_SEGREDO));
}

/* Assinatura, validade e — a revogação: cookie sem `iat`, ou com `iat` anterior ao último
   "Sair" da pessoa (conta.sessao_desde), é recusado. Quem nunca saiu não tem sessao_desde, e o cookie vale até o exp. */
export async function lerSessao(requisicao, env) {
  const c = lerCookie(requisicao, "sessao");
  if (!c || !c.includes(".")) return null;
  const [corpo, assinatura] = c.split(".");
  const esperada = b64u(await hmac(corpo, env.SESSAO_SEGREDO));
  if (!igual(assinatura, esperada)) return null;
  let dados;
  try { dados = JSON.parse(deB64u(corpo)); } catch { return null; }
  if (!dados || typeof dados.email !== "string" || !dados.exp || dados.exp < Date.now()) return null;
  const u = await env.DB.prepare("SELECT sessao_desde FROM conta WHERE email = ?").bind(dados.email).first();
  if (u && u.sessao_desde && (!(dados.iat > 0) || dados.iat < Date.parse(u.sessao_desde))) return null;
  return dados;
}

export async function hmac(texto, segredo) {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(texto)));
}

function igual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function b64u(x) {
  const bytes = typeof x === "string" ? new TextEncoder().encode(x) : x;
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64u(t) {
  const p = t.replace(/-/g, "+").replace(/_/g, "/");
  return new TextDecoder().decode(Uint8Array.from(atob(p + "=".repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0)));
}

function aleatorio() {
  return b64u(crypto.getRandomValues(new Uint8Array(24)));
}

export function cookie(nome, valor, segundos) {
  return nome + "=" + valor + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + segundos;
}

export function lerCookie(requisicao, nome) {
  for (const pedaco of (requisicao.headers.get("Cookie") || "").split(";")) {
    const [k, ...resto] = pedaco.trim().split("=");
    if (k === nome) return resto.join("=");
  }
  return null;
}

export function normalizar(e) {
  return String(e || "").trim().toLowerCase();
}
