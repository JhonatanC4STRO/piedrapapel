// Filtro de nombres para que no aparezcan groserías en el ranking de la feria.
// No es perfecto: para lo que se cuele está el panel /admin.

const EXACTAS = [
  'puta', 'puto', 'putas', 'putos', 'culo', 'culos', 'verga', 'vergas', 'pene', 'penes', 'mierda',
  'marica', 'maricon', 'maricones', 'perra', 'perras', 'zorra', 'zorras', 'pendejo', 'pendeja',
  'imbecil', 'idiota', 'estupido', 'estupida', 'hp', 'hpta', 'gonorrea', 'malparido', 'malparida',
  'cagada', 'cagado', 'mamon', 'mamona', 'huevon', 'guevon', 'weon', 'cabron', 'cabrona', 'polla',
  'follar', 'sexo', 'porno', 'nazi', 'hitler', 'violador', 'violar', 'teta', 'tetas', 'vagina', 'pito',
  'culiar', 'culear', 'monda', 'pirobo', 'piroba', 'chimba', 'carechimba', 'careverga', 'caremonda',
  'lameculos', 'mamaguevo', 'mamahuevo', 'picha', 'pichar', 'chupala', 'chupamela', 'mamamela',
];

const RAICES = [
  'hijueput', 'hijodeput', 'malparid', 'gonorre', 'careverg', 'carechimb', 'caremond', 'mamaguev',
  'mamahuev', 'hpta', 'gonorr', 'pirob', 'chupamel', 'mamamel', 'lameculo', 'puticl',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$]/g, (c) => LEET[c])
    .replace(/(.)\1+/g, '$1'); // "puuuta" -> "puta"
}

const EXACTAS_N = new Set(EXACTAS.map(normalizar));
const RAICES_N = RAICES.map(normalizar);

export function esGrosero(nombre) {
  const n = normalizar(String(nombre || ''));
  const palabras = n.split(/[^a-zñ]+/).filter(Boolean);
  const junto = palabras.join('');
  if (EXACTAS_N.has(junto)) return true;
  if (palabras.some((p) => EXACTAS_N.has(p))) return true;
  return RAICES_N.some((r) => junto.includes(r));
}

const APODOS = [
  'Aprendiz Ninja', 'Mano Veloz', 'Turbo Tijera', 'Piedra Rodante', 'Papel Maestro',
  'Rayo Aprendiz', 'Super Aprendiz', 'Puño de Acero', 'Mano Mágica', 'Tijera Ninja',
];

export function apodoAleatorio() {
  return APODOS[Math.floor(Math.random() * APODOS.length)];
}

export function limpiarNombre(crudo) {
  let n = String(crudo ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14)
    .trim();
  if (!n || esGrosero(n)) n = apodoAleatorio();
  return n;
}
