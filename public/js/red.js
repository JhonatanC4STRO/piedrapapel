// Conexión con el servidor: eventos en vivo (SSE) + peticiones POST.

function nuevoId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b); // funciona también sin HTTPS, a diferencia de randomUUID
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export class Red {
  constructor(prefijo = 'j') {
    let cid = null;
    try {
      cid = sessionStorage.getItem('cid');
    } catch {
      /* almacenamiento bloqueado */
    }
    if (!cid) {
      cid = `${prefijo}${nuevoId()}`;
      try {
        sessionStorage.setItem('cid', cid);
      } catch {
        /* nada */
      }
    }
    this.cid = cid;
    this.manejadores = {};
    this.enLinea = false;
    this.desfase = 0; // reloj del servidor - reloj local
  }

  on(evento, fn) {
    (this.manejadores[evento] ||= []).push(fn);
  }

  emitir(evento, datos) {
    for (const fn of this.manejadores[evento] || []) fn(datos);
  }

  conectar(eventos = ['hola', 'ranking', 'salas', 'sala', 'nuevo', 'senal']) {
    this.fuente = new EventSource(`/api/stream?cid=${encodeURIComponent(this.cid)}`);
    for (const ev of eventos) {
      this.fuente.addEventListener(ev, (e) => {
        let datos;
        try {
          datos = JSON.parse(e.data);
        } catch {
          return;
        }
        if (datos && typeof datos.ahora === 'number') this.desfase = datos.ahora - Date.now();
        this.emitir(ev, datos);
      });
    }
    this.fuente.onopen = () => {
      this.enLinea = true;
      this.emitir('conexion', true);
    };
    this.fuente.onerror = () => {
      this.enLinea = false;
      this.emitir('conexion', false);
    };
  }

  /** Convierte una hora del servidor (ms epoch) a performance.now() local. */
  aLocal(tsServidor) {
    return performance.now() + (tsServidor - this.desfase - Date.now());
  }

  async get(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return r.json();
  }

  async post(url, cuerpo = {}) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid: this.cid, ...cuerpo }),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(datos.error || 'Error de conexión'), { estado: r.status });
    return datos;
  }
}
