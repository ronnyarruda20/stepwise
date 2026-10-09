/* Voz do Stepwise, pelo Workers AI (conta Cloudflare da Growth):
   - ouvir: Whisper large-v3-turbo — WAV 16 kHz mono (o app grava assim no iPhone e no Chrome, ver
     public/gravador.js), devolve o texto e o tempo de cada palavra (é daí que saem as medidas de fluência).
   - falar: MeloTTS (inglês) — MP3. Se falhar, o app cai na voz do próprio aparelho (speechSynthesis).
   O áudio da pessoa nunca vai para a IA de texto (DeepSeek): só o texto transcrito.

   Por que MeloTTS e não mais o Aura-2 (09/10): a cota grátis do Workers AI é de 10 mil neurônios por dia, e o
   Aura-2 custa 2.727 neurônios por mil caracteres — ~409 por resposta de 150 caracteres, contra ~8 do Whisper
   para 10 s de fala. Com ele a cota acabava em ~24 turnos por dia (acabou em 09/10). O MeloTTS custa 18,63 por
   minuto de áudio, ~3 por resposta: com o teto de 800 falas/dia, voz + transcrição cabem na cota grátis.
   VOZ_MOTOR (wrangler.jsonc) escolhe: "melotts" (padrão), "aura" ou "aparelho" (nenhuma voz no servidor). */

import { ErroIA } from "./ia.js";

const MODELO_OUVIR = "@cf/openai/whisper-large-v3-turbo";
const MODELO_MELO = "@cf/myshell-ai/melotts";
const MODELO_AURA = "@cf/deepgram/aura-2-en";

/* bytes: Uint8Array do WAV. Devolve { texto, palavras: [{ word, start, end }] }. */
export async function ouvir(env, bytes, { textoFalso } = {}) {
  if (env.__iaFalsa) return falsoOuvir(textoFalso);
  let r;
  try {
    r = await env.AI.run(MODELO_OUVIR, {
      audio: paraBase64(bytes),
      language: "en",
      task: "transcribe",
      // Sem VAD de propósito: ele corta os silêncios, e as pausas são medida de fluência.
      vad_filter: false,
      // Evita o laço de alucinação do Whisper em fala curta e hesitante.
      condition_on_previous_text: false,
    });
  } catch (e) {
    // 4006 = acabou a cota grátis do dia do Workers AI (10 mil neurônios, volta à 00h UTC). Antes, isto virava o
    // 500 genérico e a aluna via "tente de novo" sem chance de dar certo (iPhone da Maria, 09/10 15h41 BRT).
    const m = String(e && e.message);
    throw new ErroIA(m.includes("4006") ? "cota_voz" : "ouvir", m);
  }
  const palavras = [];
  for (const s of r.segments || []) for (const w of s.words || []) palavras.push(w);
  return { texto: String(r.text || "").trim(), palavras };
}

/* Devolve o MP3 em base64, ou null se o Workers AI falhar ou se a voz for a do aparelho (o app fala sozinho). */
export async function falar(env, texto) {
  if (env.__iaFalsa) return null;
  const motor = env.VOZ_MOTOR || "melotts";
  if (motor === "aparelho") return null;
  try {
    const r = motor === "aura"
      ? await env.AI.run(MODELO_AURA, { text: texto, speaker: env.VOZ || "thalia" })
      : await env.AI.run(MODELO_MELO, { prompt: texto, lang: "en" });
    if (r && typeof r.audio === "string") return r.audio; // MeloTTS devolve { audio: MP3 em base64 }
    const buf = r instanceof ReadableStream ? await new Response(r).arrayBuffer() : r instanceof ArrayBuffer ? r : null;
    return buf ? paraBase64(new Uint8Array(buf)) : null;
  } catch (e) {
    console.log("falar falhou:", motor, e && e.message);
    return null;
  }
}

export function paraBase64(bytes) {
  let s = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) s += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  return btoa(s);
}

/* No modo falso o teste manda o que "a aluna disse" num cabeçalho; as palavras ganham 0,4 s cada. */
function falsoOuvir(texto) {
  const t = String(texto || "").trim();
  const palavras = t ? t.split(/\s+/).map((w, i) => ({ word: " " + w, start: i * 0.4, end: i * 0.4 + 0.3 })) : [];
  return { texto: t, palavras };
}
