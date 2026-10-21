// Servidor del juego: archivos estáticos, ranking, duelos entre laptops (SSE + POST).
// Sin dependencias externas: solo Node.js >= 20.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { limpiarNombre } from './lib/filtro.js';
import { esGesto, resultado } from './public/js/reglas.js';
import { CerebroRobi } from './public/js/ia.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));

// Tiempos de un duelo (ms). El navegador usa los mismos valores que le llegan en la sala.
export const TIEMPOS = {
  cuenta: 2400, // "piedra... papel... tijera..." antes del ¡YA!
  primeraPausa: 4000, // desde que se llena la sala hasta la primera cuenta (da tiempo a conectar el video)
  revelar: 5500, // duelo: tiempo mostrando el resultado (y las cámaras destapadas) antes de la siguiente ronda
  revelarSolo: 3200, // contra Robi y J1 vs J2
  espera: 2500, // margen después del ¡YA! para recibir las jugadas
  gracia: 15000, // tiempo para reconectarse antes de salir de la sala
  sinStream: 60000, // se olvida a quien hace peticiones sin abrir nunca los eventos en vivo
};

const MAX_FICHAS = 2000; // partidas contra Robi abiertas a la vez (las más viejas se descartan)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.task': 'application/octet-stream',
  '.map': 'application/json',
};

export function crearServidor(opciones = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
  const dirDatos = opciones.dirDatos || process.env.DATA_DIR || path.join(RAIZ, 'data');
  const archivoPuntajes = path.join(dirDatos, 'puntajes.jsonl');
  const claveAdmin = String(opciones.claveAdmin || process.env.ADMIN_KEY || crypto.randomBytes(4).toString('hex'));
  // config.json puede cambiar los tiempos (en milisegundos): "tiempos": { "revelar": 6000, ... }
  const t = { ...TIEMPOS, ...(config.tiempos || {}), ...(opciones.tiempos || {}) };

  const formacionesValidas = new Set(config.formaciones.map((f) => f.id));
  const victoriasMeta = config.victoriasDuelo || 3;
  const configPublica = {
    titulo: config.titulo,
    vidas: config.vidas || 3,
    victoriasDuelo: victoriasMeta,
    formaciones: config.formaciones,
    tiempos: { cuenta: t.cuenta, revelar: t.revelarSolo, revelarDuelo: t.revelar },
    // opcional: servidores STUN/TURN propios para el video del duelo (formato de RTCPeerConnection)
    iceServers: config.iceServers || null,
  };

  const formatoDia = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.zonaHoraria || 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const diaDe = (ts) => formatoDia.format(new Date(ts));

  const carpetas = [
    ['/vendor/three/', path.join(RAIZ, 'node_modules', 'three', 'build')],
    ['/vendor/three-addons/', path.join(RAIZ, 'node_modules', 'three', 'examples', 'jsm')],
    ['/vendor/mediapipe/', path.join(RAIZ, 'node_modules', '@mediapipe', 'tasks-vision')],
    ['/', path.join(RAIZ, 'public')],
  ];

  // ------------------------------------------------------------------
  // Puntajes (archivo JSONL: una línea por partida, {del:id} para borrar)
  // ------------------------------------------------------------------
  fs.mkdirSync(dirDatos, { recursive: true });
  let puntajes = [];
  if (fs.existsSync(archivoPuntajes)) {
    const borrados = new Set();
    for (const linea of fs.readFileSync(archivoPuntajes, 'utf8').split('\n')) {
      if (!linea.trim()) continue;
      try {
        const o = JSON.parse(linea);
        if (o.del) borrados.add(o.del);
        else puntajes.push(o);
      } catch {
        /* línea dañada: se ignora */
      }
    }
    puntajes = puntajes.filter((p) => !borrados.has(p.id));
  }
  const anotar = (o) => fs.appendFileSync(archivoPuntajes, JSON.stringify(o) + '\n');

  const publico = (p) => ({
    id: p.id,
    nombre: p.nombre,
    formacion: p.formacion,
    puntos: p.puntos,
    racha: p.racha,
    ts: p.ts,
  });
  const clave = (p) => p.nombre.toLowerCase() + '|' + p.formacion;

  function mejoresPorJugador(lista) {
    const mejores = new Map();
    for (const p of lista) {
      const k = clave(p);
      const actual = mejores.get(k);
      if (!actual || p.puntos > actual.puntos || (p.puntos === actual.puntos && p.ts < actual.ts)) mejores.set(k, p);
    }
    return [...mejores.values()].sort((a, b) => b.puntos - a.puntos || a.ts - b.ts);
  }

  let cacheRanking = null;
  function ranking() {
    const hoy = diaDe(Date.now());
    if (cacheRanking?.hoy === hoy) return cacheRanking;
    const deHoy = puntajes.filter((p) => p.dia === hoy);
    const porFormacion = new Map();
    for (const p of deHoy) {
      const f = porFormacion.get(p.formacion) || { id: p.formacion, puntos: 0, partidas: 0 };
      f.puntos += p.puntos;
      f.partidas += 1;
      porFormacion.set(p.formacion, f);
    }
    cacheRanking = {
      hoy,
      partidasHoy: deHoy.length,
      top: mejoresPorJugador(deHoy).slice(0, 10).map(publico),
      historico: mejoresPorJugador(puntajes).slice(0, 10).map(publico),
      formaciones: [...porFormacion.values()].sort((a, b) => b.puntos - a.puntos || b.partidas - a.partidas),
      recientes: deHoy.slice(-8).reverse().map(publico),
    };
    return cacheRanking;
  }

  // A medianoche el ranking del día queda vacío: avisar a las pantallas sin esperar una partida.
  const cambioDia = setInterval(() => {
    if (cacheRanking && cacheRanking.hoy !== diaDe(Date.now())) difundir('ranking', ranking());
  }, 60000);
  cambioDia.unref();

  // ------------------------------------------------------------------
  // Clientes conectados por SSE
  // ------------------------------------------------------------------
  const clientes = new Map(); // cid -> { cid, pid, res, sala, temporizador }
  const cidValido = (cid) => typeof cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(cid);

  /** Si el cliente sigue sin conexión SSE pasado `ms`, sale de su sala y se olvida. */
  function olvidarSinConexion(c, ms) {
    clearTimeout(c.temporizador);
    c.temporizador = setTimeout(() => {
      if (c.res) return;
      salirDeSala(c);
      clientes.delete(c.cid);
    }, ms);
  }

  function cliente(cid) {
    let c = clientes.get(cid);
    if (!c) {
      c = { cid, pid: crypto.randomBytes(5).toString('hex'), res: null, sala: null, temporizador: null };
      clientes.set(cid, c);
      // creado por un POST sin abrir nunca el stream: no debe quedarse para siempre
      olvidarSinConexion(c, t.sinStream);
    }
    return c;
  }

  function enviar(res, evento, datos) {
    if (!res) return;
    try {
      res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
    } catch {
      /* conexión cerrada */
    }
  }
  const difundir = (evento, datos) => {
    for (const c of clientes.values()) enviar(c.res, evento, datos);
  };

  const latido = setInterval(() => {
    for (const c of clientes.values()) {
      if (!c.res) continue;
      try {
        c.res.write(': ping\n\n');
      } catch {
        /* nada */
      }
    }
  }, 20000);

  // ------------------------------------------------------------------
  // Salas de duelo (2 jugadores, cada uno en su laptop)
  // ------------------------------------------------------------------
  const salas = new Map();
  const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nuevoCodigo = () => {
    let c;
    do c = Array.from({ length: 4 }, () => LETRAS[crypto.randomInt(LETRAS.length)]).join('');
    while (salas.has(c));
    return c;
  };

  function salaPublica(s) {
    return {
      codigo: s.codigo,
      estado: s.estado,
      ronda: s.ronda,
      ya: s.ya,
      ahora: Date.now(),
      jugadores: s.jugadores.map((j) => ({
        pid: j.pid,
        nombre: j.nombre,
        formacion: j.formacion,
        victorias: j.victorias,
        conectado: j.conectado,
        listo: s.jugadas.has(j.pid),
      })),
      ultima: s.historial.at(-1) || null,
      ganador: s.ganador,
      abandono: s.abandono,
      meta: victoriasMeta,
    };
  }

  function resumenSalas() {
    return [...salas.values()].map((s) => ({
      codigo: s.codigo,
      estado: s.estado,
      jugadores: s.jugadores.map((j) => ({ nombre: j.nombre, formacion: j.formacion, victorias: j.victorias })),
    }));
  }

  let avisoSalas = null;
  function salaCambio(s) {
    if (s) {
      const datos = salaPublica(s);
      for (const j of s.jugadores) enviar(clientes.get(j.cid)?.res, 'sala', datos);
    }
    clearTimeout(avisoSalas);
    avisoSalas = setTimeout(() => difundir('salas', resumenSalas()), 80);
  }

  function iniciarRonda(s, pausa) {
    clearTimeout(s.reloj);
    s.estado = 'jugando';
    s.ronda += 1;
    s.jugadas = new Map();
    s.ya = Date.now() + pausa + t.cuenta;
    s.reloj = setTimeout(() => resolverRonda(s), s.ya - Date.now() + t.espera);
    salaCambio(s);
  }

  function resolverRonda(s) {
    if (s.estado !== 'jugando' || s.jugadores.length < 2) return;
    clearTimeout(s.reloj);
    const [a, b] = s.jugadores;
    const ga = s.jugadas.get(a.pid) || null;
    const gb = s.jugadas.get(b.pid) || null;
    const r = resultado(ga, gb);
    const ganador = r === 1 ? a.pid : r === -1 ? b.pid : null;
    if (ganador) s.jugadores.find((j) => j.pid === ganador).victorias += 1;
    s.historial.push({ ronda: s.ronda, jugadas: { [a.pid]: ga, [b.pid]: gb }, ganador });
    const campeon = s.jugadores.find((j) => j.victorias >= victoriasMeta);
    if (campeon) {
      s.estado = 'terminada';
      s.ganador = campeon.pid;
      salaCambio(s);
      return;
    }
    salaCambio(s);
    s.reloj = setTimeout(() => iniciarRonda(s, 0), t.revelar);
  }

  function salirDeSala(c) {
    const s = c.sala && salas.get(c.sala);
    c.sala = null;
    if (!s) return;
    s.jugadores = s.jugadores.filter((j) => j.pid !== c.pid);
    if (s.jugadores.length === 0) {
      clearTimeout(s.reloj);
      salas.delete(s.codigo);
      salaCambio(null);
      return;
    }
    if (s.estado === 'jugando') {
      clearTimeout(s.reloj);
      s.estado = 'terminada';
      s.ganador = s.jugadores[0].pid;
      s.abandono = true;
    }
    salaCambio(s);
  }

  function reiniciarSala(s) {
    s.ronda = 0;
    s.historial = [];
    s.ganador = null;
    s.abandono = false;
    s.jugadas = new Map();
    for (const j of s.jugadores) j.victorias = 0;
  }

  function accionSala(c, cuerpo) {
    const perfil = () => ({
      nombre: limpiarNombre(cuerpo.nombre),
      formacion: formacionesValidas.has(cuerpo.formacion) ? cuerpo.formacion : 'otra',
    });
    const nuevoJugador = () => ({ pid: c.pid, cid: c.cid, ...perfil(), victorias: 0, conectado: !!c.res });
    switch (cuerpo.accion) {
      case 'crear': {
        salirDeSala(c);
        const s = {
          codigo: nuevoCodigo(),
          estado: 'esperando',
          jugadores: [nuevoJugador()],
          ronda: 0,
          ya: null,
          jugadas: new Map(),
          historial: [],
          ganador: null,
          abandono: false,
          reloj: null,
        };
        salas.set(s.codigo, s);
        c.sala = s.codigo;
        salaCambio(s);
        return { ok: true, sala: salaPublica(s) };
      }
      case 'unirse': {
        const s = salas.get(String(cuerpo.codigo || '').toUpperCase().trim());
        if (!s) return { error: 'Esa sala no existe', codigo: 404 };
        if (s.jugadores.some((j) => j.pid === c.pid)) return { ok: true, sala: salaPublica(s) };
        if (s.jugadores.length >= 2) return { error: 'La sala ya está llena', codigo: 409 };
        salirDeSala(c);
        s.jugadores.push(nuevoJugador());
        c.sala = s.codigo;
        reiniciarSala(s);
        iniciarRonda(s, t.primeraPausa);
        return { ok: true, sala: salaPublica(s) };
      }
      case 'salir':
        salirDeSala(c);
        return { ok: true };
      case 'jugada': {
        const s = c.sala && salas.get(c.sala);
        if (!s || s.estado !== 'jugando') return { error: 'No hay ronda en juego', codigo: 409 };
        if (cuerpo.ronda !== s.ronda) return { error: 'Ronda equivocada', codigo: 409 };
        // la jugada se lee en el ¡YA!; antes de eso sería hacer trampa
        if (Date.now() < s.ya - Math.min(400, t.cuenta / 3)) return { error: 'Muy pronto', codigo: 409 };
        if (!s.jugadas.has(c.pid)) s.jugadas.set(c.pid, esGesto(cuerpo.gesto) ? cuerpo.gesto : null);
        if (s.jugadores.every((j) => s.jugadas.has(j.pid))) resolverRonda(s);
        else salaCambio(s);
        return { ok: true };
      }
      case 'senal': {
        // WebRTC: el servidor solo pasa los mensajes para que las dos laptops se conecten;
        // el video viaja directo entre ellas.
        const s = c.sala && salas.get(c.sala);
        if (!s) return { error: 'No estás en una sala', codigo: 409 };
        const otro = s.jugadores.find((j) => j.pid !== c.pid);
        if (otro) enviar(clientes.get(otro.cid)?.res, 'senal', { de: c.pid, datos: cuerpo.datos });
        return { ok: true };
      }
      case 'revancha': {
        const s = c.sala && salas.get(c.sala);
        if (!s || s.estado !== 'terminada') return { error: 'No se puede pedir revancha ahora', codigo: 409 };
        reiniciarSala(s);
        if (s.jugadores.length === 2) iniciarRonda(s, t.primeraPausa);
        else {
          s.estado = 'esperando';
          salaCambio(s);
        }
        return { ok: true, sala: salaPublica(s) };
      }
      default:
        return { error: 'Acción desconocida', codigo: 400 };
    }
  }

  // ------------------------------------------------------------------
  // Partidas contra Robi: el servidor elige por Robi y lleva la cuenta,
  // así nadie puede mandar un puntaje inventado.
  // ------------------------------------------------------------------
  const fichas = new Map(); // ficha -> { ts, ultima, usada, cerebro, vidas, puntos, racha, mejorRacha }
  const limpiezaFichas = setInterval(() => {
    const limite = Date.now() - 3 * 3600 * 1000;
    for (const [k, v] of fichas) if (v.ts < limite) fichas.delete(k);
  }, 600000);
  limpiezaFichas.unref();

  function nuevaFicha() {
    // el Map guarda el orden de llegada: la primera es la más vieja
    while (fichas.size >= MAX_FICHAS) fichas.delete(fichas.keys().next().value);
    const ficha = crypto.randomBytes(12).toString('hex');
    fichas.set(ficha, {
      ts: Date.now(),
      ultima: 0,
      usada: false,
      cerebro: new CerebroRobi(),
      vidas: configPublica.vidas,
      puntos: 0,
      racha: 0,
      mejorRacha: 0,
    });
    return ficha;
  }

  function jugarRonda(cuerpo) {
    const ficha = fichas.get(String(cuerpo.ficha || ''));
    if (!ficha) return { error: 'Partida no válida', codigo: 400 };
    if (ficha.usada || ficha.vidas <= 0) return { error: 'La partida ya terminó', codigo: 409 };
    if (!esGesto(cuerpo.gesto)) return { error: 'Gesto inválido', codigo: 400 };
    // una ronda real dura al menos la cuenta regresiva
    const ahora = Date.now();
    if (ahora - ficha.ultima < t.cuenta) return { error: 'Muy rápido', codigo: 429 };
    ficha.ultima = ahora;
    // Robi elige sin mirar el gesto que acaba de llegar; solo aprende de él después.
    const robi = ficha.cerebro.elegir();
    ficha.cerebro.aprender(cuerpo.gesto);
    const r = resultado(cuerpo.gesto, robi);
    if (r === 1) {
      ficha.puntos += 1;
      ficha.racha += 1;
      ficha.mejorRacha = Math.max(ficha.mejorRacha, ficha.racha);
    } else if (r === -1) {
      ficha.vidas -= 1;
      ficha.racha = 0;
    }
    return { ok: true, robi, resultado: r, puntos: ficha.puntos, vidas: ficha.vidas };
  }

  function guardarPuntaje(cuerpo) {
    const ficha = fichas.get(String(cuerpo.ficha || ''));
    if (!ficha) return { error: 'Partida no válida', codigo: 400 };
    if (ficha.usada) return { error: 'Ese puntaje ya se guardó', codigo: 409 };
    // los puntos son los que contó el servidor, no los que dice el navegador
    const { puntos, mejorRacha: racha } = ficha;
    ficha.usada = true;
    const ahora = Date.now();
    const p = {
      id: crypto.randomBytes(6).toString('hex'),
      nombre: limpiarNombre(cuerpo.nombre),
      formacion: formacionesValidas.has(cuerpo.formacion) ? cuerpo.formacion : 'otra',
      puntos,
      racha,
      ts: ahora,
      dia: diaDe(ahora),
    };
    puntajes.push(p);
    anotar(p);
    cacheRanking = null;
    const r = ranking();
    difundir('ranking', r);
    difundir('nuevo', publico(p));

    const deHoy = mejoresPorJugador(puntajes.filter((x) => x.dia === p.dia));
    const puesto = deHoy.filter((x) => x.puntos > p.puntos && clave(x) !== clave(p)).length + 1;
    const idx = r.formaciones.findIndex((f) => f.id === p.formacion);
    return {
      ok: true,
      puntaje: publico(p),
      nombre: p.nombre,
      puesto,
      jugadoresHoy: deHoy.length,
      formacion: { ...r.formaciones[idx], puesto: idx + 1 },
    };
  }

  // ------------------------------------------------------------------
  // HTTP
  // ------------------------------------------------------------------
  const json = (res, datos, estado = 200) => {
    res.writeHead(estado, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(datos));
  };

  const leerCuerpo = (req) =>
    new Promise((ok, mal) => {
      let datos = '';
      req.setEncoding('utf8');
      req.on('data', (trozo) => {
        datos += trozo;
        if (datos.length > 65536) { // las ofertas de video (SDP) pesan unos KB
          mal(new Error('demasiado grande'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          ok(datos ? JSON.parse(datos) : {});
        } catch (e) {
          mal(e);
        }
      });
      req.on('error', mal);
    });

  const claveCorrecta = (k) => {
    const a = Buffer.from(String(k || ''));
    const b = Buffer.from(claveAdmin);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  // Archivos comprimidos en memoria (brotli/gzip). El motor de MediaPipe pasa de 13 MB a 3 MB.
  const COMPRIMIBLES = /\.(html|js|mjs|css|json|svg|wasm|glb|task|map)$/;
  const comprimidos = new Map(); // `${archivo}|${mtime}|${codificacion}` -> Promise<Buffer>

  function comprimido(archivo, mtime, codificacion) {
    const k = `${archivo}|${mtime}|${codificacion}`;
    if (!comprimidos.has(k)) {
      const p = fs.promises.readFile(archivo).then(
        (datos) =>
          new Promise((ok, mal) => {
            const listo = (e, r) => (e ? mal(e) : ok(r));
            if (codificacion === 'br') {
              zlib.brotliCompress(datos, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: datos.length } }, listo);
            } else zlib.gzip(datos, { level: 9 }, listo);
          })
      );
      p.catch(() => comprimidos.delete(k));
      comprimidos.set(k, p);
    }
    return comprimidos.get(k);
  }

  function resolverArchivo(ruta) {
    if (ruta === '/') ruta = '/index.html';
    if (ruta === '/pantalla') ruta = '/pantalla.html';
    if (ruta === '/admin') ruta = '/admin.html';
    for (const [prefijo, dir] of carpetas) {
      if (!ruta.startsWith(prefijo)) continue;
      const candidato = path.normalize(path.join(dir, ruta.slice(prefijo.length)));
      return candidato.startsWith(dir + path.sep) ? candidato : null;
    }
    return null;
  }

  function servirArchivo(req, res, ruta) {
    const archivo = resolverArchivo(ruta);
    if (!archivo) return json(res, { error: 'No encontrado' }, 404);
    fs.stat(archivo, async (err, st) => {
      if (err || !st.isFile()) return json(res, { error: 'No encontrado' }, 404);
      const modificado = st.mtime.toUTCString();
      const pesado = /\.(task|wasm|glb)$/.test(archivo) || ruta.startsWith('/vendor/');
      const cabeceras = {
        'Content-Type': MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream',
        'Last-Modified': modificado,
        // Modelos y librerías no cambian: el navegador los guarda una semana.
        // El código del juego sí cambia, así que siempre se revalida.
        'Cache-Control': pesado ? 'public, max-age=604800' : 'no-cache',
        Vary: 'Accept-Encoding',
        'X-Tamano-Original': String(st.size), // para la barra de progreso del navegador
      };
      if (req.headers['if-modified-since'] === modificado) {
        res.writeHead(304, cabeceras);
        return res.end();
      }
      const acepta = String(req.headers['accept-encoding'] || '');
      const codificacion = /\bbr\b/.test(acepta) ? 'br' : /\bgzip\b/.test(acepta) ? 'gzip' : null;
      if (codificacion && COMPRIMIBLES.test(archivo) && st.size > 1024) {
        try {
          const cuerpo = await comprimido(archivo, st.mtimeMs, codificacion);
          res.writeHead(200, { ...cabeceras, 'Content-Encoding': codificacion, 'Content-Length': cuerpo.length });
          return res.end(req.method === 'HEAD' ? undefined : cuerpo);
        } catch {
          /* si falla la compresión, se manda sin comprimir */
        }
      }
      res.writeHead(200, { ...cabeceras, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(archivo).pipe(res);
    });
  }

  // Comprimir de una vez lo más pesado, para que la primera laptop no espere.
  for (const ruta of ['/vendor/mediapipe/wasm/vision_wasm_internal.wasm', '/modelos/hand_landmarker.task', '/vendor/three/three.core.js']) {
    const archivo = resolverArchivo(ruta);
    fs.stat(archivo, (err, st) => {
      if (!err) comprimido(archivo, st.mtimeMs, 'br').catch(() => {});
    });
  }

  function abrirStream(req, res, url) {
    const cid = url.searchParams.get('cid');
    if (!cidValido(cid)) return json(res, { error: 'cid inválido' }, 400);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const c = cliente(cid);
    if (c.res && c.res !== res) c.res.end();
    c.res = res;
    clearTimeout(c.temporizador);
    const s = c.sala && salas.get(c.sala);
    const yo = s?.jugadores.find((j) => j.pid === c.pid);
    if (yo) yo.conectado = true;
    enviar(res, 'hola', { pid: c.pid, ahora: Date.now() });
    enviar(res, 'ranking', ranking());
    enviar(res, 'salas', resumenSalas());
    if (s) salaCambio(s);

    req.on('close', () => {
      if (c.res !== res) return;
      c.res = null;
      const sala = c.sala && salas.get(c.sala);
      const j = sala?.jugadores.find((x) => x.pid === c.pid);
      if (j) {
        j.conectado = false;
        salaCambio(sala);
      }
      olvidarSinConexion(c, t.gracia);
    });
  }

  const servidor = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return json(res, { error: 'URL inválida' }, 400);
    }
    const ruta = url.pathname;
    try {
      if (req.method === 'HEAD' && !ruta.startsWith('/api/')) return servirArchivo(req, res, decodeURIComponent(ruta));
      if (req.method === 'GET') {
        if (ruta === '/api/stream') return abrirStream(req, res, url);
        if (ruta === '/api/config') return json(res, configPublica);
        if (ruta === '/api/ranking') return json(res, ranking());
        if (ruta === '/api/salas') return json(res, resumenSalas());
        if (ruta === '/api/admin/puntajes') {
          if (!claveCorrecta(url.searchParams.get('clave'))) return json(res, { error: 'Clave incorrecta' }, 403);
          const dia = url.searchParams.get('dia') || diaDe(Date.now());
          return json(res, { dia, puntajes: puntajes.filter((p) => p.dia === dia).reverse().map(publico) });
        }
        if (ruta.startsWith('/api/')) return json(res, { error: 'No encontrado' }, 404);
        return servirArchivo(req, res, decodeURIComponent(ruta));
      }
      if (req.method !== 'POST') return json(res, { error: 'Método no permitido' }, 405);

      const cuerpo = await leerCuerpo(req);
      if (ruta === '/api/admin/borrar') {
        if (!claveCorrecta(cuerpo.clave)) return json(res, { error: 'Clave incorrecta' }, 403);
        const antes = puntajes.length;
        puntajes = puntajes.filter((p) => p.id !== cuerpo.id);
        if (puntajes.length === antes) return json(res, { error: 'No existe' }, 404);
        anotar({ del: cuerpo.id });
        cacheRanking = null;
        difundir('ranking', ranking());
        return json(res, { ok: true });
      }
      if (!cidValido(cuerpo.cid)) return json(res, { error: 'cid inválido' }, 400);
      if (ruta === '/api/ficha') return json(res, { ficha: nuevaFicha() });
      if (ruta === '/api/ronda') {
        const r = jugarRonda(cuerpo);
        return json(res, r, r.codigo || 200);
      }
      if (ruta === '/api/puntaje') {
        const r = guardarPuntaje(cuerpo);
        return json(res, r, r.codigo || 200);
      }
      if (ruta === '/api/sala') {
        const r = accionSala(cliente(cuerpo.cid), cuerpo);
        return json(res, r, r.codigo || 200);
      }
      return json(res, { error: 'No encontrado' }, 404);
    } catch (e) {
      if (!res.headersSent) json(res, { error: 'Petición inválida' }, 400);
      else res.end();
    }
  });

  servidor.on('close', () => {
    clearInterval(latido);
    clearInterval(cambioDia);
    clearInterval(limpiezaFichas);
    for (const s of salas.values()) clearTimeout(s.reloj);
    for (const c of clientes.values()) clearTimeout(c.temporizador);
  });

  return { servidor, claveAdmin, config: configPublica };
}

// Arranque directo: `node server.js`
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { servidor, claveAdmin } = crearServidor();
  const puerto = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  servidor.listen(puerto, host, () => {
    console.log(`Juego listo en http://localhost:${puerto}`);
    console.log(`  Pantalla para TV:  http://localhost:${puerto}/pantalla`);
    console.log(`  Administración:    http://localhost:${puerto}/admin   (clave: ${claveAdmin})`);
    if (!process.env.ADMIN_KEY) console.log('  Tip: define ADMIN_KEY para que la clave no cambie al reiniciar.');
  });
  const cerrar = () => {
    servidor.close(() => process.exit(0));
    servidor.closeAllConnections(); // las conexiones SSE no se cierran solas
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}
