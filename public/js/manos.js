// Cámara + MediaPipe Hand Landmarker. Guarda un historial corto de gestos por "lado":
//   'unica' -> la mano principal (modo contra Robi y duelo)
//   'izq' / 'der' -> cada mitad de la imagen (2 jugadores en la misma laptop)
import { FilesetResolver, HandLandmarker } from '/vendor/mediapipe/vision_bundle.mjs';
import { clasificar, gestoDominante, medirDedos } from './gesto.js';

const CONEXIONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const COLOR_GESTO = { piedra: '#ff7b3a', papel: '#3ad1ff', tijera: '#c77dff' };
const HISTORIA_MS = 3000;

// Cámaras "de mentira" que instalan apps como Iriun, OBS o DroidCam: si están apagadas
// solo muestran un aviso, así que preferimos la cámara real cuando hay una.
const CAMARA_VIRTUAL = /iriun|virtual|\bobs\b|droidcam|epoccam|manycam|snap camera|xsplit|\bcamo\b|\bndi\b|e2esoft|splitcam/i;

export class Manos {
  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.detector = null;
    this.manos = []; // [{puntos, gesto, x, y}] en coordenadas de pantalla (espejo)
    this.lecturas = { unica: [], izq: [], der: [] };
    this.ultimoTiempoVideo = -1;
    this.fps = 0;
    this.listo = false;
  }

  /**
   * Descarga el detector, pide la cámara (al mismo tiempo, para no perder tiempo) y arranca.
   * alProgreso(texto) para mensajes; alDescarga(bajado, total) para la barra de progreso.
   */
  async iniciar(alProgreso = () => {}, alDescarga = () => {}) {
    const camara = this._abrirCamara();
    camara.catch(() => {}); // el error se reporta abajo, cuando lo esperamos
    alProgreso('Descargando el detector de manos…');
    await this._precargar(alDescarga);
    alProgreso('Preparando el detector de manos…');
    await this._cargarDetector();
    alProgreso('Encendiendo la cámara…');
    await camara;
    this.listo = true;
  }

  async _abrirCamara() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'El navegador no deja usar la cámara. Abre el juego con https:// (o en localhost) y usa Chrome o Edge.'
      );
    }
    let guardada = null;
    try {
      guardada = localStorage.getItem('camara');
    } catch {
      /* almacenamiento bloqueado */
    }
    let stream = await this._pedirCamara(guardada).catch(() => this._pedirCamara(null));
    // Si Chrome eligió una cámara virtual (Iriun, OBS, DroidCam…) y hay una real, usar la real.
    if (!guardada && CAMARA_VIRTUAL.test(stream.getVideoTracks()[0]?.label || '')) {
      const real = (await this.camaras()).find((c) => !CAMARA_VIRTUAL.test(c.label));
      if (real) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await this._pedirCamara(real.deviceId);
      }
    }
    this.video.srcObject = stream;
    await this.video.play();
  }

  _pedirCamara(deviceId) {
    return navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 540 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
      },
      audio: false,
    });
  }

  /** Cámaras disponibles: [{ deviceId, label }]. */
  async camaras() {
    const lista = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
    return (lista || []).filter((d) => d.kind === 'videoinput').map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Cámara ${i + 1}`,
    }));
  }

  camaraActual() {
    return this.video.srcObject?.getVideoTracks()[0]?.getSettings().deviceId || null;
  }

  /** Cambia de cámara y la recuerda en esta laptop. Devuelve la pista de video nueva. */
  async cambiarCamara(deviceId) {
    const nuevo = await this._pedirCamara(deviceId);
    this.video.srcObject?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = nuevo;
    await this.video.play().catch(() => {});
    try {
      localStorage.setItem('camara', deviceId);
    } catch {
      /* nada */
    }
    return nuevo.getVideoTracks()[0];
  }

  /**
   * Baja el motor (wasm) y el modelo de la mano mostrando el progreso. El wasm queda en la
   * caché del navegador, así que MediaPipe lo toma de ahí sin volver a descargarlo.
   */
  async _precargar(alDescarga) {
    const urls = ['/vendor/mediapipe/wasm/vision_wasm_internal.wasm', '/modelos/hand_landmarker.task'];
    const estado = urls.map(() => ({ bajado: 0, total: 0 }));
    const informar = () =>
      alDescarga(
        estado.reduce((a, e) => a + e.bajado, 0),
        estado.reduce((a, e) => a + e.total, 0)
      );
    const bajar = async (url, i) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`No se pudo descargar ${url} (error ${r.status})`);
      // tamaño real, porque el servidor lo manda comprimido
      estado[i].total = Number(r.headers.get('X-Tamano-Original') || r.headers.get('Content-Length')) || 0;
      const lector = r.body.getReader();
      const trozos = [];
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        trozos.push(value);
        estado[i].bajado += value.length;
        informar();
      }
      return new Uint8Array(await new Blob(trozos).arrayBuffer());
    };
    const [, modelo] = await Promise.all(urls.map(bajar));
    this.modelo = modelo;
  }

  /**
   * Plan B sin cámara: 1/2/3 (o A/S/D) = piedra/papel/tijera del jugador 1,
   * J/K/L = jugador 2. Sirve para probar y por si una cámara falla en la feria.
   */
  usarTeclado() {
    const MAPA = {
      Digit1: ['izq', 'piedra'], Digit2: ['izq', 'papel'], Digit3: ['izq', 'tijera'],
      Numpad1: ['izq', 'piedra'], Numpad2: ['izq', 'papel'], Numpad3: ['izq', 'tijera'],
      KeyA: ['izq', 'piedra'], KeyS: ['izq', 'papel'], KeyD: ['izq', 'tijera'],
      KeyJ: ['der', 'piedra'], KeyK: ['der', 'papel'], KeyL: ['der', 'tijera'],
    };
    this.teclas = { izq: null, der: null };
    const presionar = (e, abajo) => {
      if (e.target instanceof HTMLInputElement) return;
      const m = MAPA[e.code];
      if (!m) return;
      if (abajo) this.teclas[m[0]] = m[1];
      else if (this.teclas[m[0]] === m[1]) this.teclas[m[0]] = null;
    };
    window.addEventListener('keydown', (e) => presionar(e, true));
    window.addEventListener('keyup', (e) => presionar(e, false));
    this.modoTeclado = true;
    this.listo = true;
  }

  async _cargarDetector() {
    const archivos = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    const opciones = (delegate) => ({
      baseOptions: this.modelo
        ? { modelAssetBuffer: this.modelo.slice(), delegate } // ya lo bajamos con barra de progreso
        : { modelAssetPath: '/modelos/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.detector = await HandLandmarker.createFromOptions(archivos, opciones('GPU'));
    } catch {
      this.detector = await HandLandmarker.createFromOptions(archivos, opciones('CPU'));
    }
  }

  /** Llamar una vez por cuadro. Detecta solo si llegó un cuadro nuevo de la cámara. */
  actualizar(ahora = performance.now()) {
    if (this.modoTeclado) {
      const { izq, der } = this.teclas;
      this._anotar('izq', ahora, izq ?? 'nada');
      this._anotar('der', ahora, der ?? 'nada');
      this._anotar('unica', ahora, izq ?? der ?? 'nada');
      return;
    }
    if (!this.listo || this.video.readyState < 2) return;
    if (this.video.currentTime === this.ultimoTiempoVideo) return;
    this.ultimoTiempoVideo = this.video.currentTime;

    const r = this.detector.detectForVideo(this.video, ahora);
    this.manos = (r.landmarks || []).map((puntos, i) => {
      const mundo = r.worldLandmarks?.[i];
      const base = mundo && mundo.length === 21 ? mundo : puntos;
      const gesto = clasificar(base);
      const dedos = this.depurar ? medirDedos(base) : null;
      // La imagen se muestra en espejo: x de pantalla = 1 - x de cámara
      const xs = puntos.map((p) => 1 - p.x);
      const ys = puntos.map((p) => p.y);
      const ancho = Math.max(...xs) - Math.min(...xs);
      const alto = Math.max(...ys) - Math.min(...ys);
      return { puntos, gesto, dedos, x: 1 - puntos[0].x, y: puntos[9].y, tam: ancho * alto };
    });

    const principal = [...this.manos].sort((a, b) => b.tam - a.tam)[0];
    this._anotar('unica', ahora, principal?.gesto ?? 'nada');
    const izq = this.manos.filter((m) => m.x < 0.5).sort((a, b) => b.tam - a.tam)[0];
    const der = this.manos.filter((m) => m.x >= 0.5).sort((a, b) => b.tam - a.tam)[0];
    this._anotar('izq', ahora, izq?.gesto ?? 'nada');
    this._anotar('der', ahora, der?.gesto ?? 'nada');

    this._cuadros = (this._cuadros || 0) + 1;
    if (!this._inicioFps || ahora - this._inicioFps > 1000) {
      this.fps = this._cuadros;
      this._cuadros = 0;
      this._inicioFps = ahora;
    }
  }

  _anotar(lado, t, gesto) {
    const lista = this.lecturas[lado];
    lista.push({ t, gesto });
    while (lista.length && lista[0].t < t - HISTORIA_MS) lista.shift();
  }

  /** Gesto más estable de un lado en la ventana [desde, hasta] (ms de performance.now()). */
  leer(lado, desde, hasta) {
    return gestoDominante(this.lecturas[lado], desde, hasta);
  }

  /** Gesto actual (últimos ~250 ms), para mostrar en vivo. */
  actual(lado = 'unica') {
    const ahora = performance.now();
    return this.leer(lado, ahora - 250, ahora);
  }

  hayMano(lado = 'unica') {
    const l = this.lecturas[lado].at(-1);
    return !!l && l.gesto !== 'nada';
  }

  /** Dibuja el video en espejo (recortado para llenar) y el esqueleto de las manos. */
  dibujar(ctx, ancho, alto, { divisor = false } = {}) {
    const v = this.video;
    ctx.save();
    ctx.clearRect(0, 0, ancho, alto);
    if (this.modoTeclado) this._dibujarTeclado(ctx, ancho, alto, divisor);
    else if (v.videoWidth) {
      const escala = Math.max(ancho / v.videoWidth, alto / v.videoHeight);
      const w = v.videoWidth * escala;
      const h = v.videoHeight * escala;
      const ox = (ancho - w) / 2;
      const oy = (alto - h) / 2;
      ctx.translate(ancho, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, ox, oy, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // puntos normalizados -> pantalla (en espejo, con el mismo recorte)
      const aPantalla = (p) => [ancho - (ox + p.x * w), oy + p.y * h];
      for (const m of this.manos) {
        const color = COLOR_GESTO[m.gesto] || '#ffffff';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(4, ancho * 0.008);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        this._lineas(ctx, m.puntos, aPantalla, 3);
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        this._lineas(ctx, m.puntos, aPantalla, 0);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        for (const p of m.puntos) {
          const [x, y] = aPantalla(p);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(3, ancho * 0.005), 0, Math.PI * 2);
          ctx.fill();
        }
        if (m.dedos) this._dibujarDiagnostico(ctx, m, aPantalla, alto);
      }
    }
    if (divisor) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.setLineDash([16, 14]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ancho / 2, 0);
      ctx.lineTo(ancho / 2, alto);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** Tecla G: muestra cómo ve el juego cada dedo (para ajustar en la feria). */
  _dibujarDiagnostico(ctx, m, aPantalla, alto) {
    const NOMBRES = ['Índice', 'Medio', 'Anular', 'Meñique'];
    const [x, y] = aPantalla(m.puntos[0]);
    const tam = Math.max(12, Math.round(alto * 0.03));
    const filaAlto = tam * 1.35;
    const ancho = tam * 11;
    const x0 = Math.min(Math.max(8, x - ancho / 2), ctx.canvas.width - ancho - 8);
    let y0 = y + tam;
    if (y0 + filaAlto * 5.4 > alto) y0 = alto - filaAlto * 5.4 - 8;
    ctx.fillStyle = 'rgba(13,11,31,0.82)';
    ctx.fillRect(x0, y0, ancho, filaAlto * 5.2);
    ctx.font = `800 ${tam}px Nunito, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`Veo: ${m.gesto ? m.gesto.toUpperCase() : '¿?'}`, x0 + 8, y0 + 6);
    m.dedos.forEach((d, i) => {
      ctx.fillStyle = d.estirado ? '#2ee88a' : '#ff4d5e';
      ctx.fillText(
        `${d.estirado ? '▲' : '▼'} ${NOMBRES[i]} ${Math.round(d.doblez)}° ×${d.alcance.toFixed(2)}`,
        x0 + 8,
        y0 + 6 + filaAlto * (i + 1)
      );
    });
  }

  _dibujarTeclado(ctx, ancho, alto, dos) {
    const ICONOS = { piedra: '✊', papel: '✋', tijera: '✌️' };
    const lados = dos ? [['izq', ancho * 0.25, '1 / A  ✊   2 / S  ✋   3 / D  ✌️'], ['der', ancho * 0.75, 'J  ✊   K  ✋   L  ✌️']]
      : [['unica', ancho / 2, 'Mantén  1 ✊   2 ✋   3 ✌️']];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [lado, x, ayuda] of lados) {
      const g = lado === 'unica' ? this.teclas.izq ?? this.teclas.der : this.teclas[lado];
      ctx.font = `${Math.round(alto * 0.32)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.globalAlpha = g ? 1 : 0.25;
      ctx.fillText(g ? ICONOS[g] : '⌨️', x, alto * 0.45);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${Math.round(alto * (dos ? 0.04 : 0.05))}px Nunito, sans-serif`;
      ctx.fillText(ayuda, x, alto * 0.8);
    }
  }

  _lineas(ctx, puntos, aPantalla, extra) {
    const grosor = ctx.lineWidth;
    ctx.lineWidth = grosor + extra;
    ctx.beginPath();
    for (const [a, b] of CONEXIONES) {
      const [x1, y1] = aPantalla(puntos[a]);
      const [x2, y2] = aPantalla(puntos[b]);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.lineWidth = grosor;
  }
}
