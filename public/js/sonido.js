// Efectos de sonido sintetizados con WebAudio, más las voces de risa y enojo, que son
// archivos de public/sonidos (si no cargan, se usa la versión sintetizada).
let ctx = null;
let salida = null;
let silencio = false;

const ARCHIVOS = { risa: '/sonidos/risa.mp3', enojo: '/sonidos/enojo.mp3' };
const grabaciones = {}; // nombre -> AudioBuffer

function cargarGrabaciones() {
  for (const [nombre, url] of Object.entries(ARCHIVOS)) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((datos) => ctx.decodeAudioData(datos))
      .then((buf) => (grabaciones[nombre] = buf))
      .catch(() => {}); // sin archivo, suena la voz sintetizada
  }
}

/** Reproduce una grabación ya cargada. Devuelve false si todavía no está. */
function grabacion(nombre, retraso = 0, vol = 1.6) {
  const buf = grabaciones[nombre];
  if (!buf) return false;
  if (!ctx || silencio) return true;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vol; // la salida general va al 32%: las voces se suben para que se oigan sobre la música
  src.connect(g).connect(salida);
  src.start(ctx.currentTime + retraso);
  return true;
}

export function activarAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    salida = ctx.createGain();
    salida.gain.value = 0.32;
    salida.connect(ctx.destination);
    cargarGrabaciones();
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

// Formantes (Hz) de las vocales: el filtro que convierte un zumbido en algo parecido a una voz.
const VOCAL = { a: [800, 1200], e: [500, 1800], o: [500, 900] };

/**
 * Una "sílaba" de voz caricaturesca: zumbido de sierra pasado por los formantes de una vocal.
 * `gruñido` (Hz) hace temblar el volumen, como un "grrr".
 */
function silaba({ desde, hasta = desde, dur, vocal = 'a', vol = 0.5, retraso = 0, gruñido = 0, aire = 0.12 }) {
  if (!ctx || silencio) return;
  const t0 = ctx.currentTime + retraso;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(desde, t0);
  o.frequency.exponentialRampToValueAtTime(hasta, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  env.gain.setValueAtTime(vol, t0 + dur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  for (const f of VOCAL[vocal]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 6;
    o.connect(bp).connect(env);
  }
  let lfo = null;
  if (gruñido) {
    // el volumen sube y baja muy rápido: suena a garganta rasposa
    const temblor = ctx.createGain();
    temblor.gain.value = 0.5;
    lfo = ctx.createOscillator();
    lfo.frequency.value = gruñido;
    const prof = ctx.createGain();
    prof.gain.value = 0.5;
    lfo.connect(prof).connect(temblor.gain);
    env.connect(temblor).connect(salida);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.02);
  } else env.connect(salida);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  if (aire) ruido(0.05, { vol: aire, retraso, filtro: 3000 }); // la "j" del "ja"
}

export const sfx = {
  /** Carcajada (sonidos/risa.mp3; si no está, "¡JA-JA-JA-JA-JA!" sintetizado que baja de tono). */
  risa: (retraso = 0) => {
    if (grabacion('risa', retraso)) return;
    [520, 500, 470, 440, 400].forEach((f, i) =>
      silaba({ desde: f * 1.15, hasta: f, dur: 0.11, vocal: i % 2 ? 'a' : 'e', retraso: retraso + i * 0.135 })
    );
  },
  /** Enojo (sonidos/enojo.mp3; si no está, un "grrr" sintetizado que explota en "¡AAAGH!"). */
  enojo: (retraso = 0) => {
    if (grabacion('enojo', retraso)) return;
    silaba({ desde: 95, hasta: 120, dur: 0.38, vocal: 'o', vol: 0.45, retraso, gruñido: 32, aire: 0 });
    silaba({ desde: 210, hasta: 130, dur: 0.42, vocal: 'a', vol: 0.6, retraso: retraso + 0.36, gruñido: 24, aire: 0.2 });
  },
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
