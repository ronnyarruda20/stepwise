/* Gravador de voz → WAV 16 kHz mono, igual no iPhone (Safari) e no Chrome.
   Por que não MediaRecorder: no iPhone ele grava em mp4/AAC e no Chrome em webm/Opus; um formato só (WAV) tira
   a dúvida de o Whisper aceitar cada um. O preço é o tamanho (~32 KB por segundo), e um minuto cabe folgado.

   Regras do iPhone que este arquivo respeita:
   - o AudioContext nasce e é retomado DENTRO do toque (preparar() é síncrono, chamado no clique);
   - o microfone é desligado ao fim de cada fala (track.stop()): com ele aberto o iOS manda o som para o alto-falante
     de ligação, baixinho, e a voz da IA some. */

export const TAXA = 16000;
export const MAX_SEGUNDOS = 60;

export class Gravador {
  constructor() {
    this.ctx = null;
    this.carregado = false;
    this.gravando = false;
  }

  /* Chame no próprio toque, antes de qualquer await. */
  preparar() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state !== "running") this.ctx.resume();
  }

  async iniciar() {
    this.preparar();
    if (!this.carregado) {
      await this.ctx.audioWorklet.addModule("/gravador-worklet.js");
      this.carregado = true;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.pedacos = [];
    this.fonte = this.ctx.createMediaStreamSource(this.stream);
    this.no = new AudioWorkletNode(this.ctx, "captura");
    this.volume = 0;
    this.no.port.onmessage = (e) => {
      this.pedacos.push(e.data);
      // volume (0–1) para o orbe da tela reagir à voz: RMS do pedaço, suavizado
      let s = 0;
      for (let i = 0; i < e.data.length; i++) s += e.data[i] * e.data[i];
      const rms = Math.min(1, Math.sqrt(s / e.data.length) * 6);
      this.volume = this.volume * 0.7 + rms * 0.3;
    };
    // ligado a um ganho zero no destino: sem isso alguns navegadores não "puxam" o nó e ele não processa
    this.mudo = this.ctx.createGain();
    this.mudo.gain.value = 0;
    this.fonte.connect(this.no);
    this.no.connect(this.mudo);
    this.mudo.connect(this.ctx.destination);
    this.inicio = performance.now();
    this.gravando = true;
  }

  segundos() {
    return this.gravando ? (performance.now() - this.inicio) / 1000 : 0;
  }

  /* Devolve um Blob audio/wav (ou null se não gravou nada). */
  async parar() {
    if (!this.gravando) return null;
    this.gravando = false;
    this.volume = 0;
    try { this.fonte.disconnect(); this.no.disconnect(); this.mudo.disconnect(); } catch {}
    for (const t of this.stream.getTracks()) t.stop();
    const taxa = this.ctx.sampleRate;
    const total = this.pedacos.reduce((s, p) => s + p.length, 0);
    if (!total) return null;
    const tudo = new Float32Array(total);
    let o = 0;
    for (const p of this.pedacos) { tudo.set(p, o); o += p.length; }
    this.pedacos = [];
    return paraWav(reamostrar(tudo, taxa, TAXA), TAXA);
  }
}

/* Média por janela: suficiente para fala (o Whisper trabalha a 16 kHz de qualquer jeito). */
function reamostrar(amostras, de, para) {
  if (de === para) return amostras;
  const razao = de / para;
  const n = Math.floor(amostras.length / razao);
  const saida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * razao), b = Math.min(amostras.length, Math.floor((i + 1) * razao));
    let s = 0;
    for (let k = a; k < b; k++) s += amostras[k];
    saida[i] = s / Math.max(1, b - a);
  }
  return saida;
}

function paraWav(amostras, taxa) {
  const buf = new ArrayBuffer(44 + amostras.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + amostras.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, amostras.length * 2, true);
  for (let i = 0; i < amostras.length; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
