// Video del rival en el duelo entre laptops (WebRTC).
// El servidor solo reenvía las "señales" (oferta, respuesta y candidatos de red);
// el video viaja directo de laptop a laptop. Si la red no lo permite, el juego sigue sin video.

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export class VideoRival {
  /**
   * @param enviar  (datos) => Promise   manda una señal al rival por el servidor
   * @param video   <video> donde se muestra al rival
   * @param alEstado (estado) => void    'conectando' | 'conectado' | 'sin-video'
   */
  constructor(enviar, video, alEstado = () => {}) {
    this.enviar = enviar;
    this.video = video;
    this.alEstado = alEstado;
    this.pc = null;
    this.rival = null; // pid del rival con el que está armada la conexión
    this.pendientes = []; // candidatos que llegan antes que la oferta/respuesta
  }

  /** Arma la conexión con un rival. Solo uno de los dos (el iniciador) manda la oferta. */
  async conectar(rivalPid, streamLocal, iniciador, iceServers = ICE) {
    if (this.rival === rivalPid && this.pc) return;
    this.cerrar();
    this.rival = rivalPid;
    this.stream = streamLocal;
    this.iceServers = iceServers;
    this._crear();
    if (iniciador) await this._ofertar();
  }

  _crear() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers || ICE });
    this.pc = pc;
    this.pendientes = [];
    const pista = this.stream?.getVideoTracks()[0];
    if (pista) {
      const emisor = pc.addTrack(pista, this.stream);
      // calidad moderada: alcanza para ver la mano y no satura el wifi de la feria
      const p = emisor.getParameters();
      p.encodings = [{ ...(p.encodings?.[0] || {}), maxBitrate: 900_000, maxFramerate: 30 }];
      emisor.setParameters(p).catch(() => {});
    } else {
      pc.addTransceiver('video', { direction: 'recvonly' }); // modo teclado: solo recibe
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.enviar({ tipo: 'ice', c: e.candidate.toJSON() }).catch(() => {});
    };
    pc.ontrack = (e) => {
      this.video.srcObject = e.streams[0] || new MediaStream([e.track]);
      this.video.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') this.alEstado('conectado');
      else if (s === 'failed' || s === 'disconnected' || s === 'closed') this.alEstado('sin-video');
      else this.alEstado('conectando');
    };
    this.alEstado('conectando');
  }

  /** Si cambio de cámara a mitad del duelo, el rival empieza a ver la nueva sin reconectar. */
  async cambiarPista(pista) {
    this.stream = pista ? new MediaStream([pista]) : this.stream;
    const emisor = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    if (emisor && pista) await emisor.replaceTrack(pista).catch(() => {});
  }

  async _ofertar() {
    const oferta = await this.pc.createOffer();
    await this.pc.setLocalDescription(oferta);
    await this.enviar({ tipo: 'oferta', sdp: this.pc.localDescription.toJSON() });
  }

  /** Procesa una señal que llegó del rival por el servidor. */
  async recibir({ de, datos }) {
    if (!datos) return;
    try {
      if (datos.tipo === 'oferta') {
        if (!this.pc || this.rival !== de) {
          this.cerrar();
          this.rival = de;
          this._crear();
        }
        await this.pc.setRemoteDescription(datos.sdp);
        await this._vaciarPendientes();
        const respuesta = await this.pc.createAnswer();
        await this.pc.setLocalDescription(respuesta);
        await this.enviar({ tipo: 'respuesta', sdp: this.pc.localDescription.toJSON() });
      } else if (datos.tipo === 'respuesta' && this.pc && this.rival === de) {
        await this.pc.setRemoteDescription(datos.sdp);
        await this._vaciarPendientes();
      } else if (datos.tipo === 'ice' && this.rival === de) {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(datos.c);
        else this.pendientes.push(datos.c);
      }
    } catch (e) {
      console.warn('Video del rival:', e);
      this.alEstado('sin-video');
    }
  }

  async _vaciarPendientes() {
    for (const c of this.pendientes.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
  }

  cerrar() {
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.close();
    }
    this.pc = null;
    this.rival = null;
    this.pendientes = [];
    this.video.srcObject = null;
  }
}
