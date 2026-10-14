// Reglas compartidas entre el navegador y el servidor.

export const GESTOS = ['piedra', 'papel', 'tijera'];

/** Lo que vence cada gesto. */
export const VENCE = { piedra: 'tijera', papel: 'piedra', tijera: 'papel' };

/** Lo que le gana a cada gesto. */
export const PIERDE_CONTRA = { piedra: 'papel', papel: 'tijera', tijera: 'piedra' };

export const ICONO = { piedra: '✊', papel: '✋', tijera: '✌️' };

export const esGesto = (g) => GESTOS.includes(g);

/**
 * 1 si gana `a`, -1 si gana `b`, 0 si empatan.
 * Quien no mostró un gesto válido pierde contra quien sí lo mostró.
 */
export function resultado(a, b) {
  const va = esGesto(a);
  const vb = esGesto(b);
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  if (a === b) return 0;
  return VENCE[a] === b ? 1 : -1;
}
