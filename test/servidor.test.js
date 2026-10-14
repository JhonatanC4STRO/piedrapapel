import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearServidor } from '../server.js';
import { esGrosero, limpiarNombre } from '../lib/filtro.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function levantar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-'));
  const { servidor } = crearServidor({
    dirDatos: dir,
    claveAdmin: 'secreta',
    tiempos: { cuenta: 100, primeraPausa: 50, revelar: 100, espera: 300, gracia: 200 },
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  t.after(() => {
    servidor.closeAllConnections();
    servidor.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = async (ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: 'POST', body: JSON.stringify(cuerpo) });
    return { estado: r.status, datos: await r.json() };
  };
  const get = async (ruta) => (await fetch(base + ruta)).json();
  return { base, post, get, dir };
}

test('filtro de nombres', () => {
  assert.ok(esGrosero('hijueputa'));
  assert.ok(esGrosero('P U T A'));
  assert.ok(esGrosero('gonorr3a'));
  assert.ok(esGrosero('puuuuto'));
  assert.ok(!esGrosero('Maricela'));
  assert.ok(!esGrosero('Computador'));
  assert.ok(!esGrosero('Ana María'));
  assert.notEqual(limpiarNombre('malparido'), 'malparido');
  assert.equal(limpiarNombre('  Laura   Gómez  '), 'Laura Gómez');
  assert.equal(limpiarNombre('<script>'), 'script');
  assert.equal(limpiarNombre('Nombre larguísimo de verdad').length, 14);
});

test('sirve el juego, el modelo y las librerías', async (t) => {
  const { base, get } = await levantar(t);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/modelos/robot.glb')).headers.get('content-type'), 'model/gltf-binary');
  assert.equal((await fetch(base + '/vendor/three/three.module.js')).status, 200);
  assert.equal((await fetch(base + '/vendor/three-addons/loaders/GLTFLoader.js')).status, 200);
  assert.equal((await fetch(base + '/vendor/mediapipe/vision_bundle.mjs')).status, 200);
  assert.equal((await fetch(base + '/vendor/mediapipe/wasm/vision_wasm_internal.wasm')).headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(base + '/%2e%2e/server.js')).status, 404);
  const config = await get('/api/config');
  assert.ok(config.formaciones.length > 5);
  assert.equal(config.adminKey, undefined);
});

test('puntajes: valida la ficha y arma el ranking', async (t) => {
  const { post, get } = await levantar(t);
  const cid = 'prueba12345';
  const { datos: f1 } = await post('/api/ficha', { cid });
  // 5 victorias en 0 segundos es imposible
  let r = await post('/api/puntaje', { cid, ficha: f1.ficha, nombre: 'Tramposo', formacion: 'software', puntos: 5 });
  assert.equal(r.estado, 400);
  // 0 puntos sí se puede
  r = await post('/api/puntaje', { cid, ficha: f1.ficha, nombre: 'Ana', formacion: 'cocina', puntos: 0 });
  assert.equal(r.estado, 200);
  // la misma ficha no sirve dos veces
  r = await post('/api/puntaje', { cid, ficha: f1.ficha, nombre: 'Ana', formacion: 'cocina', puntos: 0 });
  assert.equal(r.estado, 409);
  // ficha inventada
  r = await post('/api/puntaje', { cid, ficha: 'nada', nombre: 'X', formacion: 'cocina', puntos: 0 });
  assert.equal(r.estado, 400);

  const ranking = await get('/api/ranking');
  assert.equal(ranking.partidasHoy, 1);
  assert.equal(ranking.top[0].nombre, 'Ana');
  assert.equal(ranking.formaciones[0].id, 'cocina');

  // borrar desde admin
  const id = ranking.top[0].id;
  assert.equal((await post('/api/admin/borrar', { clave: 'mala', id })).estado, 403);
  assert.equal((await post('/api/admin/borrar', { clave: 'secreta', id })).estado, 200);
  assert.equal((await get('/api/ranking')).partidasHoy, 0);
});

test('duelo completo entre dos laptops', async (t) => {
  const { post } = await levantar(t);
  const a = { cid: 'laptopA1234', nombre: 'Ana', formacion: 'cocina' };
  const b = { cid: 'laptopB1234', nombre: 'Luis', formacion: 'mecanica' };
  const { datos: c } = await post('/api/sala', { ...a, accion: 'crear' });
  assert.equal(c.sala.estado, 'esperando');
  const codigo = c.sala.codigo;
  const { datos: u } = await post('/api/sala', { ...b, accion: 'unirse', codigo: codigo.toLowerCase() });
  assert.equal(u.sala.estado, 'jugando');
  assert.equal(u.sala.ronda, 1);

  // una tercera persona no cabe
  const lleno = await post('/api/sala', { cid: 'laptopC1234', nombre: 'Eva', formacion: 'otra', accion: 'unirse', codigo });
  assert.equal(lleno.estado, 409);

  // jugar antes del ¡YA! no se acepta
  const pronto = await post('/api/sala', { ...a, accion: 'jugada', ronda: 1, gesto: 'piedra' });
  assert.equal(pronto.estado, 409);

  let sala = u.sala;
  for (let ronda = 1; ronda <= 3; ronda++) {
    await espera(Math.max(0, sala.ya - sala.ahora) + 20);
    await post('/api/sala', { ...a, accion: 'jugada', ronda, gesto: 'piedra' });
    const r = await post('/api/sala', { ...b, accion: 'jugada', ronda, gesto: 'tijera' });
    assert.equal(r.estado, 200);
    await espera(150); // pausa de revelar
    const { datos } = await post('/api/sala', { ...a, accion: 'unirse', codigo });
    sala = datos.sala;
  }
  assert.equal(sala.estado, 'terminada');
  const ana = sala.jugadores.find((j) => j.nombre === 'Ana');
  assert.equal(sala.ganador, ana.pid);
  assert.equal(ana.victorias, 3);

  // revancha
  const rev = await post('/api/sala', { ...b, accion: 'revancha' });
  assert.equal(rev.datos.sala.estado, 'jugando');
  assert.equal(rev.datos.sala.jugadores.every((j) => j.victorias === 0), true);
});

test('si nadie juega, la ronda se resuelve sola y quien no jugó pierde', async (t) => {
  const { post } = await levantar(t);
  const a = { cid: 'laptopA5678', nombre: 'Ana', formacion: 'cocina' };
  const b = { cid: 'laptopB5678', nombre: 'Luis', formacion: 'mecanica' };
  const { datos: c } = await post('/api/sala', { ...a, accion: 'crear' });
  const { datos: u } = await post('/api/sala', { ...b, accion: 'unirse', codigo: c.sala.codigo });
  await espera(u.sala.ya - u.sala.ahora + 20);
  await post('/api/sala', { ...a, accion: 'jugada', ronda: 1, gesto: 'papel' });
  await espera(400); // pasa el tiempo de espera sin jugada de Luis
  const { datos } = await post('/api/sala', { ...a, accion: 'unirse', codigo: c.sala.codigo });
  const ana = datos.sala.jugadores.find((j) => j.nombre === 'Ana');
  assert.equal(ana.victorias, 1);
});

test('si un jugador se va a mitad del duelo, gana el otro', async (t) => {
  const { post } = await levantar(t);
  const a = { cid: 'laptopA9999', nombre: 'Ana', formacion: 'cocina' };
  const b = { cid: 'laptopB9999', nombre: 'Luis', formacion: 'mecanica' };
  const { datos: c } = await post('/api/sala', { ...a, accion: 'crear' });
  await post('/api/sala', { ...b, accion: 'unirse', codigo: c.sala.codigo });
  await post('/api/sala', { ...b, accion: 'salir' });
  const { datos } = await post('/api/sala', { ...a, accion: 'unirse', codigo: c.sala.codigo });
  assert.equal(datos.sala.estado, 'terminada');
  assert.equal(datos.sala.abandono, true);
});
