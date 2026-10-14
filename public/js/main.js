// Controlador del juego: pantallas, modos (contra Robi, duelo entre laptops, 2 en la misma
// laptop) y el ciclo de cada ronda.
import { Manos } from './manos.js';
import { Robot } from './robot.js';
import { CerebroRobi } from './ia.js';
import { Red } from './red.js';
import { sfx, activarAudio, alternarSilencio } from './sonido.js';
import { resultado, ICONO } from './reglas.js';

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const esperarHasta = (t) => esperar(Math.max(0, t - performance.now()));

const NOMBRE = { piedra: 'PIEDRA', papel: 'PAPEL', tijera: 'TIJERA' };
const PALABRAS = ['PIEDRA…', 'PAPEL…', 'TIJERA…'];
const VENTANA = { antes: 150, despues: 450 }; // ms alrededor del ¡YA! en que se lee la mano
const INACTIVIDAD_MS = 45000;
const APODOS = ['Aprendiz Ninja', 'Mano Veloz', 'Turbo Tijera', 'Piedra Rodante', 'Papel Maestro', 'Puño de Acero'];

const red = new Red();
const manos = new Manos();
const robot = new Robot($('#robot'));
const camCanvas = $('#cam');
const camCtx = camCanvas.getContext('2d');
const capa = $('#capa');

const app = {
  config: null,
  ranking: null,
  salas: [],
  pid: null,
  perfil: { nombre: '', formacion: null },
  modo: null, // 'solo' | 'duelo' | 'local'
  pantalla: 'carga',
  cuenta: null, // { ya, ultimo }
  juego: null,
  sala: null,
  partida: 0, // cambia cada vez que se abandona una partida, para cortar sus ciclos
  ultimaActividad: performance.now(),
};

const vigente = (id) => app.partida === id;
const cuentaMs = () => app.config?.tiempos?.cuenta ?? 2400;
const revelarMs = () => app.config?.tiempos?.revelar ?? 3200;
const formacion = (id) => app.config?.formaciones.find((f) => f.id === id) || { id, nombre: id, icono: '⭐' };
const icono = (g) => (g ? ICONO[g] : '❓');

// ---------------------------------------------------------------------------
// Anuncios y marcador
// ---------------------------------------------------------------------------
function anunciar(texto, clase = '', sub = '') {
  const a = $('#anuncio');
  a.className = 'anuncio';
  a.innerHTML = texto ? `${esc(texto)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}` : '';
  if (texto) {
    void a.offsetWidth; // reinicia la animación
    a.className = `anuncio pop ${clase}`;
  }
}

function actualizarMarcador() {
  const m = $('#marcador');
  const j = app.juego;
  if (!j) {
    m.innerHTML = '';
    return;
  }
  if (app.modo === 'solo') {
    const vidas = Array.from({ length: app.config.vidas }, (_, i) =>
      i < j.vidas ? '❤️' : '<span class="perdida">❤️</span>'
    ).join('');
    m.innerHTML = `<span class="pill vidas">${vidas}</span>
      <span class="pill">⭐ ${j.puntos}</span>
      <span class="pill">🔥 ${j.racha}</span>`;
  } else if (app.modo === 'duelo' && app.sala) {
    const yo = app.sala.jugadores.find((x) => x.pid === app.pid);
    const otro = app.sala.jugadores.find((x) => x.pid !== app.pid);
    m.innerHTML = `<span class="pill">${esc(yo?.nombre || 'Tú')} ${yo?.victorias ?? 0}</span>
      <span>–</span>
      <span class="pill">${otro?.victorias ?? 0} ${esc(otro?.nombre || '¿?')}</span>
      <span class="pill">🏁 a ${app.sala.meta}</span>`;
  } else if (app.modo === 'local') {
    m.innerHTML = `<span class="pill">J1 ${j.v1}</span><span>–</span><span class="pill">${j.v2} J2</span>
      <span class="pill">🏁 a ${app.config.victoriasDuelo}</span>`;
  }
}

function etiquetas(modo) {
  const local = modo === 'local';
  $('#etq-jugador').textContent = local ? 'JUGADOR 1' : 'TÚ';
  $('#etq-jugador2').classList.toggle('oculto', !local);
  $('#gesto-vivo2').classList.toggle('oculto', !local);
  let rival = 'ROBI';
  if (local) rival = 'ROBI · ÁRBITRO';
  if (modo === 'duelo') rival = app.sala?.jugadores.find((x) => x.pid !== app.pid)?.nombre || 'RIVAL';
  $('#etq-rival').textContent = rival;
  // J1 vs J2: la cámara ocupa toda la pantalla y se quita a Robi
  $('#app').classList.toggle('modo-local', local);
  $('#btn-pausa').classList.toggle('oculto', modo !== 'solo' && modo !== 'local');
}

// ---------------------------------------------------------------------------
// Ciclo de dibujo
// ---------------------------------------------------------------------------
let ultimoCuadro = performance.now();

function ajustarCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(c.clientWidth * dpr);
  const h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

function textoGesto(g, hayMano) {
  if (g) return `${ICONO[g]} ${NOMBRE[g]}`;
  return hayMano ? '🤔 No entiendo esa mano' : '🖐️ Muestra tu mano';
}

function cuadro(ahora) {
  const dt = Math.min(0.05, (ahora - ultimoCuadro) / 1000);
  ultimoCuadro = ahora;

  manos.actualizar(ahora);
  ajustarCanvas(camCanvas);
  manos.dibujar(camCtx, camCanvas.width, camCanvas.height, { divisor: app.modo === 'local' });

  if (manos.listo) {
    if (app.modo === 'local') {
      $('#gesto-vivo').textContent = textoGesto(manos.actual('izq'), manos.hayMano('izq'));
      $('#gesto-vivo2').textContent = textoGesto(manos.actual('der'), manos.hayMano('der'));
    } else {
      $('#gesto-vivo').textContent = textoGesto(manos.actual('unica'), manos.hayMano('unica'));
    }
  }

  // "piedra… papel… tijera… ¡YA!"
  if (app.cuenta) {
    const beat = cuentaMs() / 3;
    const inicio = app.cuenta.ya - cuentaMs();
    const i = Math.floor((ahora - inicio) / beat);
    robot.pulso = Math.max(0, Math.min(2.999, (ahora - inicio) / beat));
    if (i !== app.cuenta.ultimo && i >= 0) {
      app.cuenta.ultimo = i;
      if (i < 3) {
        anunciar(PALABRAS[i]);
        sfx.golpe(i);
      } else if (i === 3) {
        anunciar('¡YA!');
        sfx.ya();
      }
    }
  }

  if (app.modo !== 'local') {
    robot.actualizar(dt);
    robot.dibujar();
  }

  const quieto = ahora - app.ultimaActividad;
  if (
    (['finSolo', 'finDuelo', 'finLocal', 'perfil', 'lobby'].includes(app.pantalla) && quieto > INACTIVIDAD_MS) ||
    (app.pantalla === 'pausa' && quieto > 2 * INACTIVIDAD_MS)
  ) {
    irTitulo();
  }
  requestAnimationFrame(cuadro);
}

/** Devuelve false si se pausó a mitad de la cuenta (la ronda se repite al continuar). */
async function cuentaRegresiva(ya) {
  app.cuenta = { ya, ultimo: -1 };
  robot.poner('cuenta');
  const fin = ya + VENTANA.despues;
  while (performance.now() < fin) {
    if (app.pausado) {
      app.cuenta = null;
      robot.poner('quieto');
      return false;
    }
    await esperar(Math.min(40, fin - performance.now()));
  }
  app.cuenta = null;
  return true;
}

/** Si el juego está en pausa, espera aquí hasta que continúe. */
async function puerta(id) {
  while (vigente(id) && app.pausado) await esperar(100);
}

// ---------------------------------------------------------------------------
// Pausa (solo contra Robi y J1 vs J2; el duelo lo sincroniza el servidor)
// ---------------------------------------------------------------------------
const sePuedePausar = () => (app.modo === 'solo' || app.modo === 'local') && app.pantalla === 'juego';

function pausar() {
  if (app.pausado || !sePuedePausar()) return;
  app.pausado = true;
  app.cuenta = null;
  anunciar('');
  mostrar(
    `<div class="tarjeta">
      <h1>⏸ Pausa</h1>
      <p class="tenue">La ronda que iba empieza de nuevo al continuar.</p>
      <div class="botones">
        <button class="btn verde" id="seguir">▶ Continuar</button>
        <button class="btn gris" id="menu">🏠 Salir al menú</button>
      </div>
    </div>`,
    'pausa'
  );
  $('#seguir').onclick = reanudar;
  $('#menu').onclick = irTitulo;
}

function reanudar() {
  if (!app.pausado) return;
  app.pausado = false;
  mostrar('');
}

function alternarPausa() {
  if (app.pausado) reanudar();
  else pausar();
}

const leer = (lado, ya) => manos.leer(lado, ya - VENTANA.antes, ya + VENTANA.despues);

/** Espera (máx. 6 s) a que aparezca una mano antes de la primera ronda. */
async function prepararMano(id, lados, texto) {
  anunciar('¡Levanta la mano!', '', texto);
  const limite = performance.now() + 6000;
  while (vigente(id) && performance.now() < limite) {
    if (lados.every((l) => manos.hayMano(l))) break;
    await esperar(100);
  }
  await esperar(500);
}

// ---------------------------------------------------------------------------
// Modo 1: contra Robi
// ---------------------------------------------------------------------------
async function jugarSolo() {
  const id = ++app.partida;
  app.modo = 'solo';
  mostrar('');
  etiquetas('solo');
  const j = (app.juego = { vidas: app.config.vidas, puntos: 0, racha: 0, mejorRacha: 0, ficha: null });
  red.post('/api/ficha').then((r) => (j.ficha = r.ficha)).catch(() => {});
  actualizarMarcador();
  const cerebro = new CerebroRobi();
  robot.poner('quieto');

  await prepararMano(id, ['unica'], 'Muéstrale a la cámara piedra, papel o tijera');
  let sinMano = 0;
  while (vigente(id) && j.vidas > 0) {
    await puerta(id);
    if (!vigente(id)) return;
    const eleccion = cerebro.elegir(); // Robi decide ANTES de verte
    const ya = performance.now() + 400 + cuentaMs();
    anunciar('');
    if (!(await cuentaRegresiva(ya))) continue; // se pausó: repetir la ronda
    if (!vigente(id)) return;

    const g = leer('unica', ya);
    if (!g) {
      sinMano += 1;
      robot.poner('pensando');
      sfx.nada();
      anunciar('¡No vi tu mano!', 'empate', 'Ponla frente a la cámara en el ¡YA!');
      if (sinMano >= 3) break;
      await esperar(1800);
      continue;
    }
    sinMano = 0;
    cerebro.aprender(g);
    const r = resultado(g, eleccion);
    const duelo = `${ICONO[g]} vs ${ICONO[eleccion]}`;
    if (r === 1) {
      j.puntos += 1;
      j.racha += 1;
      j.mejorRacha = Math.max(j.mejorRacha, j.racha);
      robot.poner('pierde', eleccion);
      sfx.gana();
      anunciar('¡GANASTE!', 'gana', `${duelo} · ${NOMBRE[g]} le gana a ${NOMBRE[eleccion]}`);
    } else if (r === -1) {
      j.vidas -= 1;
      j.racha = 0;
      robot.poner('gana', eleccion);
      sfx.pierde();
      anunciar('¡ROBI GANA!', 'pierde', `${duelo} · ${NOMBRE[eleccion]} le gana a ${NOMBRE[g]}`);
    } else {
      robot.poner('empate', eleccion);
      sfx.empate();
      anunciar('¡EMPATE!', 'empate', `${duelo} · los dos sacaron ${NOMBRE[g]}`);
    }
    actualizarMarcador();
    await esperar(revelarMs());
  }
  if (!vigente(id)) return;

  anunciar('');
  robot.poner(j.puntos >= 3 ? 'pierde' : 'gana');
  sfx.fin();
  mostrar(`<div class="tarjeta"><h2>Guardando tu puntaje…</h2><div class="carga-barra"><div></div></div></div>`, 'guardando');
  const envio = await enviarPuntaje(j);
  if (vigente(id)) pantallaFinSolo(j, envio);
}

async function enviarPuntaje(j) {
  try {
    if (!j.ficha) j.ficha = (await red.post('/api/ficha')).ficha;
    return await red.post('/api/puntaje', {
      ficha: j.ficha,
      nombre: app.perfil.nombre,
      formacion: app.perfil.formacion,
      puntos: j.puntos,
      racha: j.mejorRacha,
    });
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Modo 2: dos jugadores en la misma laptop
// ---------------------------------------------------------------------------
async function jugarLocal() {
  const id = ++app.partida;
  app.modo = 'local';
  mostrar('');
  etiquetas('local');
  const j = (app.juego = { v1: 0, v2: 0 });
  const meta = app.config.victoriasDuelo;
  actualizarMarcador();
  robot.poner('quieto');

  await prepararMano(id, ['izq', 'der'], 'Jugador 1 a la izquierda, jugador 2 a la derecha');
  while (vigente(id) && Math.max(j.v1, j.v2) < meta) {
    await puerta(id);
    if (!vigente(id)) return;
    const ya = performance.now() + 400 + cuentaMs();
    anunciar('');
    if (!(await cuentaRegresiva(ya))) continue; // se pausó: repetir la ronda
    if (!vigente(id)) return;

    const g1 = leer('izq', ya);
    const g2 = leer('der', ya);
    if (!g1 && !g2) {
      robot.poner('pensando');
      sfx.nada();
      anunciar('¡No vi las manos!', 'empate', 'Una mano a cada lado de la línea');
      await esperar(1800);
      continue;
    }
    const r = resultado(g1, g2);
    const duelo = `${icono(g1)} vs ${icono(g2)}`;
    if (r === 0) {
      robot.poner('empate');
      sfx.empate();
      anunciar('¡EMPATE!', 'empate', duelo);
    } else {
      if (r === 1) j.v1 += 1;
      else j.v2 += 1;
      robot.poner('gana');
      sfx.gana();
      anunciar(r === 1 ? '¡PUNTO PARA J1!' : '¡PUNTO PARA J2!', 'gana', duelo);
    }
    actualizarMarcador();
    await esperar(revelarMs());
  }
  if (!vigente(id)) return;
  anunciar('');
  sfx.campeon();
  pantallaFinLocal(j.v1 > j.v2 ? 1 : 2);
}

// ---------------------------------------------------------------------------
// Modo 3: duelo entre laptops (el servidor sincroniza el ¡YA! y guarda las jugadas)
// ---------------------------------------------------------------------------
function nuevoDuelo() {
  app.modo = 'duelo';
  app.juego = { rondaEnCurso: 0, ultimaRevelada: 0, finProgramado: false, partida: ++app.partida };
}

function alSala(s) {
  if (app.modo !== 'duelo' || !app.juego) return;
  const yo = s.jugadores.find((x) => x.pid === app.pid);
  if (!yo) return;
  // revancha: la sala volvió a empezar
  if (s.ronda < app.juego.rondaEnCurso) {
    app.juego.rondaEnCurso = 0;
    app.juego.ultimaRevelada = 0;
    app.juego.finProgramado = false;
  }
  app.sala = s;
  etiquetas('duelo');
  actualizarMarcador();

  if (s.estado === 'esperando') {
    pantallaEspera();
    return;
  }
  if (s.ultima && s.ultima.ronda > app.juego.ultimaRevelada) revelarDuelo(s);

  if (s.estado === 'jugando' && s.ronda > app.juego.rondaEnCurso && (!s.ultima || s.ultima.ronda < s.ronda)) {
    rondaDuelo(s);
  }
  if (s.estado === 'terminada' && !app.juego.finProgramado) {
    app.juego.finProgramado = true;
    const id = app.juego.partida;
    setTimeout(() => {
      if (vigente(id) && app.modo === 'duelo') pantallaFinDuelo();
    }, s.abandono ? 300 : 2600);
  }
}

async function rondaDuelo(s) {
  const id = app.juego.partida;
  const ronda = s.ronda;
  app.juego.rondaEnCurso = ronda;
  mostrar('');
  const ya = red.aLocal(s.ya);
  if (ronda === 1) {
    const rival = s.jugadores.find((x) => x.pid !== app.pid);
    anunciar('¡A JUGAR!', '', `contra ${rival?.nombre || 'tu rival'}`);
  } else anunciar('');
  await cuentaRegresiva(ya);
  if (!vigente(id) || app.sala?.ronda !== ronda || app.sala?.estado !== 'jugando') return;

  const g = leer('unica', ya);
  robot.poner('pensando');
  if (app.juego.ultimaRevelada < ronda) {
    anunciar(icono(g), '', g ? 'Esperando a tu rival…' : '¡No vi tu mano!');
  }
  try {
    await red.post('/api/sala', { accion: 'jugada', ronda, gesto: g });
  } catch {
    /* si falla, el servidor la cuenta como "sin mano" */
  }
}

function revelarDuelo(s) {
  const u = s.ultima;
  app.juego.ultimaRevelada = u.ronda;
  const rival = s.jugadores.find((x) => x.pid !== app.pid);
  const mia = u.jugadas[app.pid];
  const suya = rival ? u.jugadas[rival.pid] : null;
  const duelo = `${icono(mia)} vs ${icono(suya)}`;
  if (!u.ganador) {
    robot.poner('empate', suya || undefined);
    sfx.empate();
    anunciar('¡EMPATE!', 'empate', duelo);
  } else if (u.ganador === app.pid) {
    robot.poner('pierde', suya || undefined);
    sfx.gana();
    anunciar('¡GANASTE LA RONDA!', 'gana', duelo);
  } else {
    robot.poner('gana', suya || undefined);
    sfx.pierde();
    anunciar('¡PERDISTE LA RONDA!', 'pierde', duelo);
  }
}

async function crearSala() {
  pantallaCompleta(true, true);
  try {
    nuevoDuelo();
    const r = await red.post('/api/sala', { accion: 'crear', ...perfilEnvio() });
    app.sala = r.sala;
    pantallaEspera();
  } catch (e) {
    mostrarError(e.message);
  }
}

async function unirseSala(codigo) {
  pantallaCompleta(true, true);
  try {
    nuevoDuelo();
    const r = await red.post('/api/sala', { accion: 'unirse', codigo, ...perfilEnvio() });
    alSala(r.sala);
  } catch (e) {
    app.modo = null;
    mostrarError(e.message);
  }
}

const perfilEnvio = () => ({ nombre: app.perfil.nombre, formacion: app.perfil.formacion });

function mostrarError(msg) {
  const e = capa.querySelector('.error');
  if (e) e.textContent = msg;
}

// ---------------------------------------------------------------------------
// Pantallas (capa de menú)
// ---------------------------------------------------------------------------
function mostrar(html, nombre = 'juego') {
  app.pantalla = nombre;
  capa.innerHTML = html;
}

function pantallaCarga(msg) {
  // si ya está la pantalla de carga, solo cambia el texto (no reinicia la barra)
  const titulo = app.pantalla === 'carga' && $('#carga-titulo');
  if (titulo) {
    titulo.textContent = msg;
    return;
  }
  mostrar(
    `<div class="tarjeta"><h2 id="carga-titulo">${esc(msg)}</h2>
      <p class="tenue">Si el navegador pregunta, dale <b>Permitir</b> a la cámara.</p>
      <div class="carga-barra" id="carga-barra"><div></div></div>
      <p class="tenue" id="carga-detalle">&nbsp;</p></div>`,
    'carga'
  );
}

/** Barra de progreso real mientras baja el detector de manos (solo la primera vez; luego queda en caché). */
function progresoDescarga(bajado, total) {
  const barra = $('#carga-barra');
  if (!barra || !total) return;
  const pct = Math.min(100, Math.round((100 * bajado) / total));
  barra.classList.add('real');
  barra.firstElementChild.style.width = `${pct}%`;
  $('#carga-detalle').textContent = `${pct}% · ${(bajado / 1e6).toFixed(1)} de ${(total / 1e6).toFixed(1)} MB`;
}

function pantallaError(e) {
  const nombre = e?.name || '';
  let msg = e?.message || String(e);
  if (nombre === 'NotAllowedError') msg = 'No hay permiso para usar la cámara. Haz clic en el candado de la barra de direcciones y permite la cámara.';
  if (nombre === 'NotFoundError') msg = 'No encontré ninguna cámara conectada.';
  if (nombre === 'NotReadableError') msg = 'La cámara está ocupada por otra aplicación (Meet, Zoom, Teams…). Ciérrala y vuelve a intentar.';
  mostrar(
    `<div class="tarjeta"><h2>😵 Algo falló con la cámara</h2><p>${esc(msg)}</p>
      <div class="botones">
        <button class="btn" id="reintentar">Reintentar</button>
        <button class="btn gris" id="teclado">⌨️ Jugar con el teclado</button>
      </div></div>`,
    'error'
  );
  $('#reintentar').onclick = () => location.reload();
  $('#teclado').onclick = () => {
    manos.usarTeclado();
    irTitulo();
  };
}

function listaRanking(top, resaltar) {
  if (!top?.length) return '<p class="vacio">Nadie ha jugado hoy. ¡Sé el primero!</p>';
  return `<ol class="lista">${top
    .slice(0, 5)
    .map(
      (p, i) => `<li class="${p.id === resaltar ? 'yo' : ''}"><span class="pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
        <span>${formacion(p.formacion).icono}</span><span class="nombre">${esc(p.nombre)}</span>
        <span class="pts">${p.puntos}</span></li>`
    )
    .join('')}</ol>`;
}

function listaFormaciones(lista, resaltar) {
  if (!lista?.length) return '<p class="vacio">Todavía no hay puntos.</p>';
  return `<ol class="lista">${lista
    .slice(0, 5)
    .map((f, i) => {
      const info = formacion(f.id);
      return `<li class="${f.id === resaltar ? 'yo' : ''}"><span class="pos">${i + 1}</span><span>${info.icono}</span>
        <span class="nombre">${esc(info.nombre)}</span><span class="pts">${f.puntos}</span></li>`;
    })
    .join('')}</ol>`;
}

function pantallaTitulo() {
  const r = app.ranking;
  mostrar(
    `<div class="tarjeta">
      <h1 class="titulo-grande">¡Reta a Robi!</h1>
      <p>Juega piedra, papel o tijera con tu mano frente a la cámara. Sin tocar nada.</p>
      <div class="modos">
        <button class="btn rosa" data-modo="solo"><span class="icono">🤖</span>Contra Robi
          <span class="detalle">Robi aprende tus mañas · 3 vidas</span></button>
        <button class="btn azul" data-modo="duelo"><span class="icono">💻⚔️💻</span>Duelo entre laptops
          <span class="detalle">Reta a alguien en otra laptop</span></button>
        <button class="btn verde" data-modo="local"><span class="icono">👥</span>2 en esta laptop
          <span class="detalle">Uno a cada lado de la cámara</span></button>
      </div>
      <div class="columnas">
        <div class="caja"><h3>🏆 Mejores de hoy</h3>${listaRanking(r?.top)}</div>
        <div class="caja"><h3>⚔️ Guerra de formaciones</h3>${listaFormaciones(r?.formaciones)}</div>
      </div>
    </div>`,
    'titulo'
  );
  capa.querySelectorAll('[data-modo]').forEach((b) => {
    b.onclick = () => {
      sfx.clic();
      const m = b.dataset.modo;
      if (m === 'solo') pantallaPerfil(jugarSolo);
      if (m === 'duelo') pantallaPerfil(pantallaLobby);
      if (m === 'local') {
        pantallaCompleta(true, true);
        jugarLocal();
      }
    };
  });
}

function pantallaPerfil(siguiente) {
  const p = app.perfil;
  mostrar(
    `<div class="tarjeta">
      <h2>¿Quién juega?</h2>
      <div class="fila-nombre">
        <input id="nombre" class="campo" maxlength="14" placeholder="Tu nombre o apodo" autocomplete="off" spellcheck="false" value="${esc(p.nombre)}">
        <button class="btn chico gris" id="dado" title="Apodo al azar">🎲</button>
      </div>
      <p style="margin-top:2vh">¿Qué formación estudias?</p>
      <div class="formaciones">${app.config.formaciones
        .map(
          (f) => `<button class="formacion ${f.id === p.formacion ? 'sel' : ''}" data-f="${esc(f.id)}">
            <span class="ic">${f.icono}</span>${esc(f.nombre)}</button>`
        )
        .join('')}</div>
      <div class="error"></div>
      <div class="botones">
        <button class="btn gris" id="volver">← Volver</button>
        <button class="btn verde" id="listo" ${p.formacion ? '' : 'disabled'}>¡Listo!</button>
      </div>
    </div>`,
    'perfil'
  );
  const nombre = $('#nombre');
  const listo = $('#listo');
  nombre.focus();
  $('#dado').onclick = () => {
    nombre.value = APODOS[Math.floor(Math.random() * APODOS.length)];
  };
  capa.querySelectorAll('[data-f]').forEach((b) => {
    b.onclick = () => {
      sfx.clic();
      p.formacion = b.dataset.f;
      capa.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('sel', x === b));
      listo.disabled = false;
    };
  });
  const confirmar = () => {
    if (!p.formacion) {
      capa.querySelector('.error').textContent = 'Elige tu formación 👆';
      return;
    }
    p.nombre = nombre.value.trim() || APODOS[Math.floor(Math.random() * APODOS.length)];
    sfx.clic();
    siguiente();
  };
  listo.onclick = confirmar;
  nombre.onkeydown = (e) => {
    if (e.key === 'Enter') confirmar();
  };
  $('#volver').onclick = irTitulo;
}

function pantallaLobby() {
  const abiertas = app.salas.filter((s) => s.estado === 'esperando' && s.jugadores.length === 1);
  mostrar(
    `<div class="tarjeta">
      <h2>⚔️ Duelo entre laptops</h2>
      <p class="tenue">Crea una sala y tu rival la elige desde otra laptop.</p>
      <div class="botones"><button class="btn rosa" id="crear">➕ Crear sala</button></div>
      <div class="salas">${
        abiertas.length
          ? abiertas
              .map((s) => {
                const j = s.jugadores[0];
                return `<div class="sala-item"><span class="codigo">${esc(s.codigo)}</span>
                  <span class="quien">${formacion(j.formacion).icono} ${esc(j.nombre)} te está esperando</span>
                  <button class="btn chico verde" data-codigo="${esc(s.codigo)}">Retar</button></div>`;
              })
              .join('')
          : '<p class="vacio">No hay salas abiertas. ¡Crea una!</p>'
      }</div>
      <div class="fila-codigo">
        <input id="codigo" class="campo" maxlength="4" placeholder="CÓDIGO" autocomplete="off">
        <button class="btn chico azul" id="unirse">Unirme</button>
      </div>
      <div class="error"></div>
      <div class="botones"><button class="btn gris" id="volver">← Volver</button></div>
    </div>`,
    'lobby'
  );
  $('#crear').onclick = crearSala;
  capa.querySelectorAll('[data-codigo]').forEach((b) => (b.onclick = () => unirseSala(b.dataset.codigo)));
  const codigo = $('#codigo');
  const unirse = () => codigo.value.trim() && unirseSala(codigo.value.trim().toUpperCase());
  $('#unirse').onclick = unirse;
  codigo.onkeydown = (e) => {
    if (e.key === 'Enter') unirse();
  };
  $('#volver').onclick = irTitulo;
}

function pantallaEspera() {
  const s = app.sala;
  mostrar(
    `<div class="tarjeta">
      <h2>Tu sala</h2>
      <div class="codigo-gigante">${esc(s?.codigo || '····')}</div>
      <p>Dile a tu rival que entre a <b>Duelo entre laptops</b> y elija esta sala.</p>
      <p class="tenue">Esperando rival…</p>
      <div class="carga-barra"><div></div></div>
      <div class="botones"><button class="btn gris" id="cancelar">Cancelar</button></div>
    </div>`,
    'espera'
  );
  $('#cancelar').onclick = irTitulo;
}

function pantallaFinSolo(j, envio) {
  const f = formacion(app.perfil.formacion);
  const ok = envio && !envio.error;
  const puesto = ok
    ? `<span class="insignia">🏆 Puesto ${envio.puesto} de ${envio.jugadoresHoy} hoy</span>
       <span class="insignia verde">${f.icono} ${esc(f.nombre)}: ${envio.formacion?.puntos ?? j.puntos} pts (${envio.formacion?.puesto}º)</span>`
    : `<span class="insignia">⚠️ No se pudo guardar el puntaje${envio?.error ? `: ${esc(envio.error)}` : ''}</span>`;
  mostrar(
    `<div class="tarjeta">
      <h2>${j.puntos >= 5 ? '¡Le diste una paliza a Robi!' : j.puntos >= 2 ? '¡Bien jugado!' : '¡Robi te leyó la mente!'}</h2>
      <div class="puntaje-gigante">${j.puntos}</div>
      <p>victorias contra Robi · mejor racha 🔥 ${j.mejorRacha}</p>
      <div class="insignias">${puesto}</div>
      <div class="columnas">
        <div class="caja"><h3>🏆 Mejores de hoy</h3>${listaRanking(app.ranking?.top, envio?.puntaje?.id)}</div>
        <div class="caja"><h3>⚔️ Guerra de formaciones</h3>${listaFormaciones(app.ranking?.formaciones, app.perfil.formacion)}</div>
      </div>
      <div class="botones">
        <button class="btn verde" id="otra">🔁 Jugar otra vez</button>
        <button class="btn azul" id="otro">👤 Otro jugador</button>
        <button class="btn gris" id="menu">🏠 Menú</button>
      </div>
    </div>`,
    'finSolo'
  );
  $('#otra').onclick = jugarSolo;
  $('#otro').onclick = () => {
    app.perfil = { nombre: '', formacion: null };
    pantallaPerfil(jugarSolo);
  };
  $('#menu').onclick = irTitulo;
}

function pantallaFinDuelo() {
  const s = app.sala;
  if (!s) return irTitulo();
  const gane = s.ganador === app.pid;
  const rival = s.jugadores.find((x) => x.pid !== app.pid);
  robot.poner(gane ? 'pierde' : 'gana');
  if (gane) sfx.campeon();
  anunciar('');
  mostrar(
    `<div class="tarjeta">
      <h1>${gane ? '🏆 ¡GANASTE EL DUELO!' : '😵 Perdiste el duelo'}</h1>
      <p>${s.abandono ? 'Tu rival abandonó la sala.' : s.jugadores.map((j) => `${esc(j.nombre)}: ${j.victorias}`).join(' · ')}</p>
      <div class="error"></div>
      <div class="botones">
        ${rival ? '<button class="btn verde" id="revancha">🔁 Revancha</button>' : ''}
        <button class="btn gris" id="salir">🏠 Salir</button>
      </div>
    </div>`,
    'finDuelo'
  );
  $('#salir').onclick = irTitulo;
  const rev = $('#revancha');
  if (rev) {
    rev.onclick = async () => {
      try {
        app.juego.finProgramado = false;
        await red.post('/api/sala', { accion: 'revancha' });
      } catch (e) {
        mostrarError(e.message);
      }
    };
  }
}

function pantallaFinLocal(ganador) {
  robot.poner('gana');
  mostrar(
    `<div class="tarjeta">
      <h1>🏆 ¡Gana el Jugador ${ganador}!</h1>
      <p>${ganador === 1 ? 'El de la izquierda' : 'El de la derecha'} se lleva la victoria ${app.juego.v1} a ${app.juego.v2}.</p>
      <div class="botones">
        <button class="btn verde" id="otra">🔁 Otra vez</button>
        <button class="btn gris" id="menu">🏠 Menú</button>
      </div>
    </div>`,
    'finLocal'
  );
  $('#otra').onclick = jugarLocal;
  $('#menu').onclick = irTitulo;
}

/** Pantalla completa del navegador. `auto` = la puso el juego (y la quita al volver al menú). */
function pantallaCompleta(activar, auto = false) {
  if (activar && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().then(() => (app.completaAuto = auto)).catch(() => {});
  } else if (!activar && document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

function irTitulo() {
  app.partida += 1;
  app.pausado = false;
  if (app.completaAuto) {
    app.completaAuto = false;
    pantallaCompleta(false);
  }
  if (app.sala) red.post('/api/sala', { accion: 'salir' }).catch(() => {});
  app.sala = null;
  app.modo = null;
  app.cuenta = null;
  app.juego = null;
  app.perfil = { nombre: '', formacion: null };
  app.ultimaActividad = performance.now();
  robot.poner('quieto');
  anunciar('');
  etiquetas(null);
  actualizarMarcador();
  pantallaTitulo();
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
function teclas(e) {
  app.ultimaActividad = performance.now();
  activarAudio();
  if (e.target instanceof HTMLInputElement) return;
  const tecla = e.key.toLowerCase();
  // Esc, P o Espacio pausan contra Robi y en J1 vs J2; en el duelo Esc sale.
  if (tecla === 'escape' || tecla === 'p' || e.code === 'Space') {
    if (app.pantalla === 'pausa' || sePuedePausar()) {
      e.preventDefault();
      alternarPausa();
      return;
    }
    if (tecla === 'escape' && app.pantalla !== 'titulo') irTitulo();
    return;
  }
  if (tecla === 'm') $('#btn-sonido').click();
  if (tecla === 'f') $('#btn-pantalla').click();
  if (tecla === 'g') manos.depurar = !manos.depurar; // diagnóstico de dedos
}

async function iniciar() {
  window.addEventListener('keydown', teclas);
  window.addEventListener('pointerdown', () => {
    app.ultimaActividad = performance.now();
    activarAudio();
  });
  $('#btn-sonido').onclick = () => {
    $('#btn-sonido').textContent = alternarSilencio() ? '🔇' : '🔊';
  };
  $('#btn-pantalla').onclick = () => {
    app.completaAuto = false;
    pantallaCompleta(!document.fullscreenElement);
  };
  $('#btn-pausa').onclick = alternarPausa;
  new ResizeObserver(() => robot.ajustarTamano()).observe($('#robot'));

  red.on('hola', (d) => (app.pid = d.pid));
  red.on('conexion', (ok) => $('#red').classList.toggle('ok', ok));
  red.on('ranking', (r) => {
    app.ranking = r;
    if (app.pantalla === 'titulo') pantallaTitulo();
  });
  red.on('salas', (s) => {
    app.salas = s;
    if (app.pantalla === 'lobby') {
      const codigo = $('#codigo')?.value;
      pantallaLobby();
      if (codigo) $('#codigo').value = codigo;
    }
  });
  red.on('sala', alSala);

  pantallaCarga('Conectando con el servidor…');
  red.conectar();
  for (;;) {
    try {
      app.config = await red.get('/api/config');
      break;
    } catch {
      await esperar(2000);
    }
  }
  document.title = app.config.titulo;
  requestAnimationFrame(cuadro);

  try {
    pantallaCarga('Despertando a Robi…');
    // Robi, el detector y la cámara cargan al mismo tiempo
    const teclado = new URLSearchParams(location.search).has('teclado');
    await Promise.all([
      robot.cargar(),
      teclado ? manos.usarTeclado() : manos.iniciar(pantallaCarga, progresoDescarga),
    ]);
  } catch (e) {
    console.error(e);
    pantallaError(e);
    return;
  }
  irTitulo();
}

window.__juego = { app, manos, robot, red }; // para depurar desde la consola
iniciar();
