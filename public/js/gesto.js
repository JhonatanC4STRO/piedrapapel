// Convierte los 21 puntos de la mano de MediaPipe en piedra / papel / tijera.
//
// Puntos que usamos (https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker):
//   0 = muñeca
//   índice: 5 (nudillo) 6 (articulación media) 7 8 (punta)
//   medio:  9 / 10 / 11 / 12     anular: 13 / 14 / 15 / 16     meñique: 17 / 18 / 19 / 20
//
// Para cada dedo medimos dos cosas (en 3D, "world landmarks", así no importa si la mano
// está girada o inclinada):
//   - doblez: ángulo entre el hueso nudillo→articulación y articulación→punta.
//             Dedo recto ≈ 0–30°, dedo doblado ≈ 90–180°.
//   - alcance: qué tan lejos queda la punta de la muñeca comparado con la articulación media.
// Un dedo cuenta como estirado si está bastante recto Y su punta se aleja de la palma.

const DEDOS = [
  { nudillo: 5, medio: 6, punta: 8 },
  { nudillo: 9, medio: 10, punta: 12 },
  { nudillo: 13, medio: 14, punta: 16 },
  { nudillo: 17, medio: 18, punta: 20 },
];

export const UMBRAL = {
  doblezMax: 60, // grados: más que esto = dedo doblado
  alcanceMin: 1.08, // punta/articulación respecto a la muñeca
};

const resta = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const largo = (v) => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => largo(resta(a, b));

function angulo(u, v) {
  const l = largo(u) * largo(v);
  if (!l) return 0;
  const c = (u.x * v.x + u.y * v.y + u.z * v.z) / l;
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Datos de cada dedo [índice, medio, anular, meñique]: { doblez (°), alcance, estirado }. */
export function medirDedos(puntos) {
  const muneca = puntos[0];
  return DEDOS.map(({ nudillo, medio, punta }) => {
    const doblez = angulo(resta(puntos[medio], puntos[nudillo]), resta(puntos[punta], puntos[medio]));
    const alcance = dist(muneca, puntos[punta]) / (dist(muneca, puntos[medio]) || 1);
    return { doblez, alcance, estirado: doblez < UMBRAL.doblezMax && alcance > UMBRAL.alcanceMin };
  });
}

export function dedosEstirados(puntos) {
  return medirDedos(puntos).map((d) => d.estirado);
}

/** 'piedra' | 'papel' | 'tijera' | null (no se entiende). */
export function clasificar(puntos) {
  if (!puntos || puntos.length < 21) return null;
  const [indice, medio, anular, menique] = dedosEstirados(puntos);
  const n = [indice, medio, anular, menique].filter(Boolean).length;
  if (n === 0) return 'piedra';
  // Tijera: índice y medio arriba y el anular doblado. El meñique no importa
  // (mucha gente lo deja medio suelto al hacer la tijera).
  if (indice && medio && !anular) return 'tijera';
  if (n >= 3) return 'papel';
  return null;
}

/**
 * Gesto más repetido en una lista de lecturas [{t, gesto}] dentro de [desde, hasta].
 * Ignora los cuadros donde no se vio mano o no se entendió.
 */
export function gestoDominante(lecturas, desde, hasta) {
  const cuenta = { piedra: 0, papel: 0, tijera: 0 };
  for (const l of lecturas) {
    if (l.t >= desde && l.t <= hasta && l.gesto in cuenta) cuenta[l.gesto] += 1;
  }
  let mejor = null;
  let max = 0;
  for (const [g, c] of Object.entries(cuenta)) {
    if (c > max) {
      mejor = g;
      max = c;
    }
  }
  return mejor;
}
