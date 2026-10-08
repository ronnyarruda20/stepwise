/* Processador de áudio: só repassa as amostras do microfone (Float32, taxa do aparelho) para o gravador.js.
   Fica num arquivo próprio porque o Safari do iPhone carrega worklet por URL. */
class Captura extends AudioWorkletProcessor {
  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (canal && canal.length) this.port.postMessage(canal.slice(0));
    return true;
  }
}
registerProcessor("captura", Captura);
