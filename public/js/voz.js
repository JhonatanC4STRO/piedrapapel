// La voz de Robi: usa la voz en español que ya trae el navegador (speechSynthesis),
// así que no hay archivos de audio. Si el navegador no tiene voces, Robi simplemente no habla.

let voz = null;
let silencio = false;
let hablando = false;
let ultimaVez = 0;

const PREFERIDAS = ['es-CO', 'es-MX', 'es-US', 'es-419', 'es-ES'];

function elegirVoz() {
  const voces = window.speechSynthesis?.getVoices() || [];
  const enEspanol = voces.filter((v) => v.lang?.toLowerCase().startsWith('es'));
  for (const idioma of PREFERIDAS) {
    const v = enEspanol.find((x) => x.lang.toLowerCase() === idioma.toLowerCase());
    if (v) return (voz = v);
  }
  voz = enEspanol[0] || null;
}

if (window.speechSynthesis) {
  elegirVoz();
  window.speechSynthesis.addEventListener?.('voiceschanged', elegirVoz);
}

/** true mientras Robi está hablando (para moverle la boca). */
export const estaHablando = () => hablando;

/** Milisegundos desde la última vez que Robi habló. */
export const desdeQueHablo = () => performance.now() - ultimaVez;

export function silenciarVoz(valor) {
  silencio = valor;
  if (silencio) window.speechSynthesis?.cancel();
}

/**
 * Robi dice una frase. Si recibe una lista, escoge una al azar.
 * `interrumpir` corta lo que estuviera diciendo antes.
 */
export function decir(frases, { interrumpir = true } = {}) {
  const s = window.speechSynthesis;
  if (!s || silencio) return;
  const texto = Array.isArray(frases) ? frases[Math.floor(Math.random() * frases.length)] : frases;
  if (!texto) return;
  if (interrumpir) s.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  if (voz) u.voice = voz;
  u.lang = voz?.lang || 'es-CO';
  u.pitch = 1.45; // un poco más aguda: suena a robot simpático
  u.rate = 1.05;
  u.onstart = () => (hablando = true);
  u.onend = u.onerror = () => (hablando = false);
  ultimaVez = performance.now();
  s.speak(u);
}

/** Frases de Robi. {nombre} y los números se reemplazan al usarlas. */
export const FRASES = {
  saludo: [
    '¡Hola, {nombre}! A ver si me ganas.',
    '¡Qué más, {nombre}! Te advierto que aprendo rápido.',
    '{nombre}, muéstrame tu mano. Te voy a leer la mente.',
  ],
  roboGana: [
    '¡Te leí la mente!',
    '¡Ja! Demasiado fácil.',
    'Punto para Robi.',
    'Sabía que ibas a sacar eso.',
    'Soy un robot, no me puedes engañar.',
  ],
  roboPierde: [
    '¡No puede ser!',
    'Bien jugado, humano.',
    'Tuviste suerte. La próxima es mía.',
    'Ay, eso me dolió en los circuitos.',
    '¿Cómo hiciste eso?',
  ],
  empate: ['¡Pensamos igual!', 'Empate. Somos tal para cual.', 'Grandes mentes piensan igual.'],
  sinMano: ['¿Dónde está tu mano? No la veo.', 'Pon la mano frente a la cámara, por favor.'],
  invitacion: [
    '¡Ey, tú! ¿Te atreves a jugar contra mí?',
    'Soy Robi. Ven y trata de ganarme.',
    'Muéstrame tu mano y te leo la mente.',
    '¿Quién es el más valiente de su formación? Venga, juguemos.',
    'Llevo todo el día ganando. ¿Alguien me detiene?',
  ],
  // al final, según qué tan bien predijo Robi (ver ia.js)
  predecible: 'Eres muy predecible. Te leí la mente en {aciertos} de {predicciones} jugadas.',
  medio: 'Te leí la mente en {aciertos} de {predicciones} jugadas. A veces caes en tus mañas.',
  impredecible: '¡Eres impredecible! Solo te leí la mente en {aciertos} de {predicciones} jugadas.',
};

/** Reemplaza {clave} por su valor. */
export const completar = (texto, valores) => texto.replace(/\{(\w+)\}/g, (_, k) => valores[k] ?? '');
