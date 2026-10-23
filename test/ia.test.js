import test from 'node:test';
import assert from 'node:assert/strict';
import { CerebroRobi } from '../public/js/ia.js';
import { resultado, PIERDE_CONTRA } from '../public/js/reglas.js';

test('reglas básicas', () => {
  assert.equal(resultado('piedra', 'tijera'), 1);
  assert.equal(resultado('tijera', 'papel'), 1);
  assert.equal(resultado('papel', 'piedra'), 1);
  assert.equal(resultado('piedra', 'papel'), -1);
  assert.equal(resultado('papel', 'papel'), 0);
  assert.equal(resultado(null, 'papel'), -1);
  assert.equal(resultado('papel', null), 1);
  assert.equal(resultado(null, null), 0);
});

test('Robi lleva la cuenta de qué sacaste y cuántas veces te leyó la mente', () => {
  const robi = new CerebroRobi();
  for (const g of ['piedra', 'piedra', 'piedra', 'piedra', 'tijera']) robi.aprender(g);
  robi.aprender('pistola'); // los gestos inválidos no cuentan
  const l = robi.lectura;
  assert.deepEqual(l.jugadas, { piedra: 4, papel: 0, tijera: 1 });
  // predice desde la tercera jugada: piedra, piedra (acierta las dos) y luego tijera (falla)
  assert.equal(l.predicciones, 3);
  assert.equal(l.aciertos, 2);
  // la lectura es una copia: cambiarla no toca el cerebro
  l.jugadas.piedra = 99;
  assert.equal(robi.lectura.jugadas.piedra, 4);
});

test('Robi detecta a quien siempre saca lo mismo', () => {
  const robi = new CerebroRobi();
  for (let i = 0; i < 8; i++) robi.aprender('piedra');
  assert.equal(robi.prediccion(), 'piedra');
});

test('Robi detecta secuencias (piedra -> papel -> tijera -> ...)', () => {
  const robi = new CerebroRobi();
  const ciclo = ['piedra', 'papel', 'tijera'];
  for (let i = 0; i < 12; i++) robi.aprender(ciclo[i % 3]);
  // la última fue tijera (i=11), lo siguiente del ciclo es piedra
  assert.equal(robi.prediccion(), 'piedra');
});

test('contra alguien predecible, Robi gana más de lo que pierde', () => {
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  const robi = new CerebroRobi(azar);
  let gana = 0;
  let pierde = 0;
  for (let i = 0; i < 300; i++) {
    const jugador = ['piedra', 'piedra', 'papel'][i % 3];
    const r = resultado(robi.elegir(), jugador);
    if (r === 1) gana++;
    if (r === -1) pierde++;
    robi.aprender(jugador);
  }
  assert.ok(gana > pierde * 1.3, `gana ${gana} vs pierde ${pierde}`);
});

test('Robi sigue siendo vencible: casi la mitad de las veces juega al azar', () => {
  const robi = new CerebroRobi(() => 0.99); // el azar siempre supera la confianza
  for (let i = 0; i < 50; i++) robi.aprender('piedra');
  assert.ok(robi.confianza <= 0.55);
  assert.equal(robi.prediccion(), 'piedra');
  assert.notEqual(robi.elegir(), PIERDE_CONTRA.piedra); // eligió al azar, no lo que le gana
});
