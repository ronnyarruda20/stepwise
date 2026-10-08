/* Voz do Stepwise, pelo Workers AI (conta Cloudflare da Growth):
   - ouvir: Whisper large-v3-turbo — WAV 16 kHz mono (o app grava assim no iPhone e no Chrome, ver
     public/gravador.js), devolve o texto e o tempo de cada palavra (é daí que saem as medidas de fluência).
   - falar: Deepgram Aura-2 (inglês) — MP3. Se falhar, o app cai na voz do próprio aparelho (speechSynthesis).
   O áudio da pessoa nunca vai para a Anthropic: só o texto transcrito. */

const MODELO_OUVIR = "@cf/openai/whisper-large-v3-turbo";
const MODELO_FALAR = "@cf/deepgram/aura-2-en";

/* bytes: Uint8Array do WAV. Devolve { texto, palavras: [{ word, start, end }] }. */
export async function ouvir(env, bytes, { textoFalso } = {}) {
  if (env.__iaFalsa) return falsoOuvir(textoFalso);
  const r = await env.AI.run(MODELO_OUVIR, {
    audio: paraBase64(bytes),
    language: "en",
    task: "transcribe",
    // Sem VAD de propósito: ele corta os silêncios, e as pausas são medida de fluência.
    vad_filter: false,
    // Evita o laço de alucinação do Whisper em fala curta e hesitante.
    condition_on_previous_text: false,
  });
  const palavras = [];
  for (const s of r.segments || []) for (const w of s.words || []) palavras.push(w);
  return { texto: String(r.text || "").trim(), palavras };
}

/* Devolve o MP3 em base64, ou null se o Workers AI falhar (o app usa a voz do aparelho). */
export async function falar(env, texto) {
  if (env.__iaFalsa) return null;
  try {
    const r = await env.AI.run(MODELO_FALAR, { text: texto, speaker: env.VOZ || "thalia" });
    const buf = r instanceof ReadableStream ? await new Response(r).arrayBuffer() : r instanceof ArrayBuffer ? r : r && r.audio ? Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0)).buffer : null;
    return buf ? paraBase64(new Uint8Array(buf)) : null;
  } catch (e) {
    console.log("falar falhou:", e && e.message);
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
