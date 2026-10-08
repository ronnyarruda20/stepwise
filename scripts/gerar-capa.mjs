// Regera public/capa.jpg (1200×630), a imagem de compartilhamento do link, a partir de scripts/capa-compartilhar.html.
// Chrome sem janela tira a foto da página e o ffmpeg passa para JPEG: o PNG sai com ~500 KB e o WhatsApp não mostra
// prévia de imagem grande; o JPEG fica perto de 110 KB.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const raiz = resolve(import.meta.dirname, "..");
const fonte = join(raiz, "scripts", "capa-compartilhar.html");
const saida = join(raiz, "public", "capa.jpg");

const candidatos = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chrome = candidatos.find((c) => existsSync(c));
if (!chrome) throw new Error("Chrome não encontrado; aponte a variável CHROME para o executável.");

const tmp = mkdtempSync(join(tmpdir(), "stepwise-capa-"));
const png = join(tmp, "capa.png");
try {
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=1200,630", "--virtual-time-budget=4000", `--user-data-dir=${join(tmp, "perfil")}`,
    `--screenshot=${png}`, pathToFileURL(fonte).href,
  ], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", png, "-q:v", "3", saida], { stdio: "inherit" });
  console.log("ok:", saida);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
