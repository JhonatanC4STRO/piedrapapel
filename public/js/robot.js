// Robi en 3D: carga el modelo hecho en Blender (public/modelos/robot.glb) y lo anima
// moviendo sus nodos por nombre (ver blender/crear_robot.py).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const COLORES_CARA = {
  normal: new THREE.Color(0.2, 0.95, 1.0),
  feliz: new THREE.Color(0.35, 1.0, 0.45),
  triste: new THREE.Color(1.0, 0.25, 0.3),
  pensando: new THREE.Color(1.0, 0.8, 0.2),
};

export class Robot {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.escena = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camara = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camara.position.set(0.15, 1.55, 7.6);
    this.camara.lookAt(0.25, 1.45, 0);

    const clave = new THREE.DirectionalLight(0xffffff, 2.2);
    clave.position.set(3, 5, 6);
    this.escena.add(clave);
    const contra = new THREE.DirectionalLight(0x9db4ff, 1.4);
    contra.position.set(-4, 3, -4);
    this.escena.add(contra);
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x445066, 0.6));

    this.nodos = {};
    this.base = {};
    this.estado = 'quieto';
    this.tEstado = 0;
    this.t = 0;
    this.gesto = 'piedra';
    this.pulso = 0; // 0..1 durante la cuenta ("piedra, papel, tijera")
    this.parpadeo = 2;
    this._pop = 0;
    this.hablando = false;
  }

  async cargar(url = '/modelos/robot.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.modelo = gltf.scene;
    this.escena.add(this.modelo);
    const nombres = [
      'Robot', 'Cabeza', 'Ojo_I', 'Ojo_D', 'Boca', 'Antena_Bola', 'Hombro_D', 'Codo_D', 'Mano',
      'Mano_Piedra', 'Mano_Papel', 'Mano_Tijera', 'Hombro_I',
    ];
    for (const n of nombres) {
      const o = this.modelo.getObjectByName(n);
      if (!o) throw new Error(`El modelo no tiene el nodo "${n}"`);
      this.nodos[n] = o;
      this.base[n] = { pos: o.position.clone(), rot: o.rotation.clone(), esc: o.scale.clone() };
    }
    this.materialCara = null;
    this.modelo.traverse((o) => {
      if (o.isMesh && o.material?.name === 'Luz') this.materialCara = o.material;
    });
    this.mostrarGesto('piedra');
    this.ajustarTamano();
  }

  ajustarTamano() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    // si el panel es angosto, alejamos la cámara para que quepa el brazo
    this.camara.position.z = w / h < 0.85 ? 7.6 * (0.85 / (w / h)) : 7.6;
    this.camara.updateProjectionMatrix();
  }

  mostrarGesto(gesto) {
    this.gesto = gesto;
    this.nodos.Mano_Piedra.visible = gesto === 'piedra';
    this.nodos.Mano_Papel.visible = gesto === 'papel';
    this.nodos.Mano_Tijera.visible = gesto === 'tijera';
  }

  /**
   * Estados: 'quieto', 'cuenta' (agita el puño), 'revelar', 'gana', 'pierde', 'empate', 'pensando'.
   */
  poner(estado, gesto) {
    this.estado = estado;
    this.tEstado = 0;
    if (estado === 'cuenta') this.mostrarGesto('piedra');
    if (gesto) {
      this.mostrarGesto(gesto);
      this._pop = 1;
    }
  }

  actualizar(dt) {
    if (!this.modelo) return;
    this.t += dt;
    this.tEstado += dt;
    const { t, tEstado: te, nodos: n, base: b } = this;
    const reset = (k) => {
      n[k].position.copy(b[k].pos);
      n[k].rotation.copy(b[k].rot);
      n[k].scale.copy(b[k].esc);
    };
    Object.keys(n).forEach(reset);

    // respiración y flotación
    n.Robot.position.y += Math.sin(t * 2.2) * 0.04;
    n.Cabeza.rotation.z += Math.sin(t * 1.3) * 0.04;
    n.Antena_Bola.scale.multiplyScalar(1 + Math.sin(t * 6) * 0.12);
    n.Hombro_I.rotation.z += Math.sin(t * 1.8) * 0.08;

    let cara = 'normal';
    let ojosY = 1;
    let bocaX = 1;

    switch (this.estado) {
      case 'cuenta': {
        // un golpe de puño por cada palabra
        const golpe = Math.sin(Math.PI * (this.pulso % 1));
        n.Hombro_D.rotation.z -= golpe * 0.42;
        n.Codo_D.rotation.z += golpe * 0.25;
        n.Robot.position.y -= golpe * 0.05;
        cara = 'pensando';
        break;
      }
      case 'revelar':
        n.Hombro_D.rotation.z += 0.08;
        break;
      case 'gana': {
        cara = 'feliz';
        ojosY = 0.35;
        bocaX = 1.7;
        n.Robot.position.y += Math.abs(Math.sin(te * 9)) * 0.25 * Math.max(0, 1 - te / 2.5);
        n.Robot.rotation.y += Math.sin(te * 5) * 0.25;
        n.Hombro_D.rotation.z += 0.25 + Math.sin(te * 12) * 0.15;
        n.Hombro_I.rotation.z -= 0.9 + Math.sin(te * 12) * 0.2;
        break;
      }
      case 'pierde': {
        cara = 'triste';
        ojosY = 0.55;
        bocaX = 0.6;
        const caida = Math.min(1, te * 3);
        n.Cabeza.rotation.x += 0.28 * caida;
        n.Cabeza.position.y -= 0.06 * caida;
        n.Hombro_D.rotation.z -= 0.35 * caida;
        n.Robot.rotation.z += Math.sin(te * 20) * 0.03 * Math.max(0, 1 - te);
        break;
      }
      case 'empate':
        n.Cabeza.rotation.z += 0.18 * Math.min(1, te * 4);
        cara = 'pensando';
        break;
      case 'pensando':
        n.Cabeza.rotation.z += Math.sin(t * 3) * 0.12;
        cara = 'pensando';
        break;
      default:
        break;
    }

    // "pop" de la mano al revelar
    if (this._pop > 0) {
      this._pop = Math.max(0, this._pop - dt * 3);
      n.Mano.scale.multiplyScalar(1 + Math.sin(this._pop * Math.PI) * 0.35);
    }

    // parpadeo
    this.parpadeo -= dt;
    if (this.parpadeo < 0) this.parpadeo = 2 + Math.random() * 3;
    if (this.parpadeo < 0.12 && cara !== 'feliz') ojosY *= 0.1;
    n.Ojo_I.scale.y *= ojosY;
    n.Ojo_D.scale.y *= ojosY;
    n.Boca.scale.x *= bocaX;
    // mientras habla, la boca se abre y se cierra
    if (this.hablando) n.Boca.scale.y *= 1 + 2.4 * Math.abs(Math.sin(t * 17));

    if (this.materialCara) {
      this.materialCara.emissive.lerp(COLORES_CARA[cara], Math.min(1, dt * 8));
      this.materialCara.color.copy(this.materialCara.emissive);
    }
  }

  dibujar() {
    this.renderer.render(this.escena, this.camara);
  }
}
