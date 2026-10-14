import test from 'node:test';
import assert from 'node:assert/strict';
import { clasificar, gestoDominante } from '../public/js/gesto.js';

// Mano sintética en metros: muñeca en el origen, dedos hacia +y.
// estirados = [índice, medio, anular, meñique]
function mano(estirados, { girar = 0 } = {}) {
  const p = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const xs = [-0.03, -0.01, 0.01, 0.03];
  const bases = [5, 9, 13, 17];
  bases.forEach((b, i) => {
    const x = xs[i];
    p[b] = { x, y: 0.09, z: 0 }; // nudillo
    if (estirados[i]) {
      p[b + 1] = { x, y: 0.125, z: 0 };
      p[b + 2] = { x, y: 0.15, z: 0 };
      p[b + 3] = { x, y: 0.175, z: 0 };
    } else {
      // dedo doblado hacia la palma
      p[b + 1] = { x, y: 0.11, z: -0.025 };
      p[b + 2] = { x, y: 0.09, z: -0.04 };
      p[b + 3] = { x, y: 0.07, z: -0.03 };
    }
  });
  // pulgar (no se usa para clasificar)
  p[1] = { x: -0.03, y: 0.03, z: 0 };
  p[2] = { x: -0.05, y: 0.05, z: 0 };
  p[3] = { x: -0.06, y: 0.07, z: 0 };
  p[4] = { x: -0.065, y: 0.09, z: 0 };
  if (!girar) return p;
  // rotar la mano completa (debe dar igual)
  const c = Math.cos(girar);
  const s = Math.sin(girar);
  return p.map(({ x, y, z }) => ({ x: x * c - y * s, y: x * s + y * c, z }));
}

test('reconoce piedra, papel y tijera', () => {
  assert.equal(clasificar(mano([false, false, false, false])), 'piedra');
  assert.equal(clasificar(mano([true, true, true, true])), 'papel');
  assert.equal(clasificar(mano([true, true, false, false])), 'tijera');
});

test('no le importa que la mano esté girada', () => {
  for (const ang of [0.5, 1.6, -2.4, Math.PI]) {
    assert.equal(clasificar(mano([false, false, false, false], { girar: ang })), 'piedra');
    assert.equal(clasificar(mano([true, true, true, true], { girar: ang })), 'papel');
    assert.equal(clasificar(mano([true, true, false, false], { girar: ang })), 'tijera');
  }
});

test('papel con un dedo medio doblado sigue siendo papel', () => {
  assert.equal(clasificar(mano([true, true, true, false])), 'papel');
});

test('tijera con el meñique suelto sigue siendo tijera', () => {
  assert.equal(clasificar(mano([true, true, false, true])), 'tijera');
});

test('tijera con los dedos un poco doblados (como la hace la gente)', () => {
  const p = mano([true, true, false, false]);
  // índice y medio levemente curvos (~25°), no perfectamente rectos
  for (const b of [5, 9]) {
    p[b + 2] = { ...p[b + 2], z: -0.008 };
    p[b + 3] = { ...p[b + 3], z: -0.02 };
  }
  assert.equal(clasificar(p), 'tijera');
});

test('gestos raros no cuentan', () => {
  assert.equal(clasificar(mano([true, false, false, false])), null); // señalar
  assert.equal(clasificar(mano([false, true, false, true])), null);
  assert.equal(clasificar(null), null);
  assert.equal(clasificar([]), null);
});

test('gestoDominante toma el más repetido en la ventana', () => {
  const lecturas = [
    { t: 0, gesto: 'papel' },
    { t: 100, gesto: 'piedra' },
    { t: 110, gesto: 'tijera' },
    { t: 120, gesto: 'tijera' },
    { t: 130, gesto: 'nada' },
    { t: 140, gesto: null },
    { t: 900, gesto: 'piedra' },
  ];
  assert.equal(gestoDominante(lecturas, 100, 500), 'tijera');
  assert.equal(gestoDominante(lecturas, 125, 145), null);
});
