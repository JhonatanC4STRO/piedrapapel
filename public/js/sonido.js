// Efectos de sonido sintetizados con WebAudio (no hay archivos de audio).
let ctx = null;
let salida = null;
let silencio = false;

export function activarAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    salida = ctx.createGain();
    salida.gain.value = 0.32;
    salida.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function alternarSilencio() {
  silencio = !silencio;
  if (salida) salida.gain.value = silencio ? 0 : 0.32;
  return silencio;
}

function tono(f, dur, { tipo = 'square', vol = 0.3, retraso = 0, hasta = null } = {}) {
  if (!ctx || silencio) return;
  const t0 = ctx.currentTime + retraso;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(f, t0);
  if (hasta) o.frequency.exponentialRampToValueAtTime(hasta, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(salida);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function ruido(dur, { vol = 0.25, retraso = 0, filtro = 1200 } = {}) {
  if (!ctx || silencio) return;
  const t0 = ctx.currentTime + retraso;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filtro;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(salida);
  src.start(t0);
}

export const sfx = {
  clic: () => tono(660, 0.06, { tipo: 'triangle', vol: 0.2 }),
  golpe: (n) => {
    ruido(0.12, { vol: 0.35, filtro: 500 });
    tono([330, 392, 494][n] || 330, 0.14, { tipo: 'square', vol: 0.18 });
  },
  ya: () => {
    ruido(0.2, { vol: 0.4, filtro: 2500 });
    tono(784, 0.25, { tipo: 'square', vol: 0.22 });
  },
  gana: () => [523, 659, 784, 1047].forEach((f, i) => tono(f, 0.16, { tipo: 'square', vol: 0.2, retraso: i * 0.09 })),
  pierde: () => [392, 330, 262].forEach((f, i) => tono(f, 0.22, { tipo: 'sawtooth', vol: 0.16, retraso: i * 0.13 })),
  empate: () => {
    tono(440, 0.12, { tipo: 'triangle', vol: 0.22 });
    tono(440, 0.12, { tipo: 'triangle', vol: 0.22, retraso: 0.15 });
  },
  nada: () => tono(200, 0.3, { tipo: 'sawtooth', vol: 0.15, hasta: 120 }),
  fin: () => [784, 659, 523, 392, 523].forEach((f, i) => tono(f, 0.2, { tipo: 'triangle', vol: 0.22, retraso: i * 0.12 })),
  campeon: () =>
    [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) =>
      tono(f, 0.14, { tipo: 'square', vol: 0.2, retraso: i * 0.1 })
    ),
};
