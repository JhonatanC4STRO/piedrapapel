// El "cerebro" de Robi. Elige ANTES de ver tu mano (eso lo hace justo),
// pero aprende tus mañas: qué sueles sacar y qué sacas después de cada jugada.
import { GESTOS, PIERDE_CONTRA } from './reglas.js';

export class CerebroRobi {
  constructor(azar = Math.random) {
    this.azar = azar;
    this.historial = [];
    this.frecuencia = { piedra: 1, papel: 1, tijera: 1 };
    this.despues = {}; // despues[jugadaAnterior][siguiente] = veces
    for (const a of GESTOS) this.despues[a] = { piedra: 1, papel: 1, tijera: 1 };
  }

  /** Qué tan seguido usa su predicción en vez de jugar al azar (sube con lo que te conoce). */
  get confianza() {
    return Math.min(0.55, 0.1 + this.historial.length * 0.06);
  }

  /** Lo que Robi cree que vas a sacar ahora. */
  prediccion() {
    const ultimo = this.historial.at(-1);
    const puntaje = { piedra: 0, papel: 0, tijera: 0 };
    const total = Object.values(this.frecuencia).reduce((a, b) => a + b, 0);
    for (const g of GESTOS) puntaje[g] += this.frecuencia[g] / total;
    if (ultimo) {
      const fila = this.despues[ultimo];
      const t = Object.values(fila).reduce((a, b) => a + b, 0);
      for (const g of GESTOS) puntaje[g] += (2 * fila[g]) / t;
    }
    return GESTOS.reduce((mejor, g) => (puntaje[g] > puntaje[mejor] ? g : mejor), GESTOS[0]);
  }

  elegir() {
    if (this.historial.length >= 2 && this.azar() < this.confianza) {
      return PIERDE_CONTRA[this.prediccion()];
    }
    return GESTOS[Math.floor(this.azar() * 3)];
  }

  /** Registrar lo que sacó el jugador. */
  aprender(gesto) {
    if (!GESTOS.includes(gesto)) return;
    const ultimo = this.historial.at(-1);
    if (ultimo) this.despues[ultimo][gesto] += 1;
    this.frecuencia[gesto] += 1;
    this.historial.push(gesto);
  }
}
