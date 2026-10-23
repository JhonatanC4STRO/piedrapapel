# ✊✋✌️ Piedra, Papel o Tijera vs. Robi

Juego para la feria: el aprendiz muestra la mano a la cámara de la laptop y juega contra **Robi**, un robot 3D hecho en Blender. MediaPipe reconoce la mano en el navegador; no hay que tocar nada.

## Modos

| Modo | Cómo funciona |
|---|---|
| 🤖 **Contra Robi** | Escoges cuántas rondas jugar (3, 5, 7 o 10; los empates cuentan). Cada victoria es un punto para el ranking del día y para tu formación. Robi elige **antes** de ver tu mano, pero aprende tus mañas (lo que más sacas y lo que sacas después de cada jugada). |
| 💻⚔️💻 **Duelo entre laptops** | Uno crea una sala y el otro la elige desde otra laptop. La pantalla se divide: tu cámara y la del rival, que viaja directo entre las laptops por WebRTC. El servidor sincroniza el "¡YA!" y gana el primero en llegar a las victorias que escogió quien creó la sala (3, 5, 7 o 10). |
| 👥 **2 en esta laptop** | Un jugador a cada lado de la línea punteada de la cámara. Antes de empezar se escoge a cuántas victorias se juega. Robi hace de árbitro. |

Extras:
- **Robi habla** con la voz en español del navegador (`public/js/voz.js`, sin archivos de audio). Saluda, comenta cada resultado, da su veredicto al final y llama a la gente cuando nadie juega. No narra la cuenta regresiva, porque la voz tarda en arrancar y descuadraría el ¡YA! `M` también lo silencia.
- **"¿Robi te leyó la mente?"** al final de cada partida contra Robi: qué tanto sacaste cada jugada y cuántas veces Robi la predijo. Al azar acertaría 1 de cada 3.
- `/pantalla`: ranking en vivo para poner en un TV (mejores del día y "guerra de formaciones"), con una franja de **datos curiosos** que rota cada 7 s. Por ejemplo: "Cocina saca más piedra" o "Mecánica es la más impredecible".
- `/admin`: para borrar nombres groseros o puntajes sospechosos. Ya hay un filtro automático de groserías, pero algo se puede colar.
- **Modo teclado** (plan B si una cámara falla): en la pantalla de error de cámara, o abriendo `/?teclado`. Las teclas son 1/2/3 o A/S/D (jugador 1) y J/K/L (jugador 2).

Teclas:
- `Esc`, `P` o `Espacio` (o el botón ⏸): pausan contra Robi y en J1 vs J2. Al continuar, la ronda que iba empieza de nuevo. El duelo entre laptops no se puede pausar porque lo sincroniza el servidor; ahí `Esc` sale.
- `F`: pantalla completa. El modo J1 vs J2 la activa solo y quita a Robi para que la cámara ocupe toda la pantalla.
- `M`: silencio.
- `G`: diagnóstico de dedos. Muestra sobre la cámara el ángulo de cada dedo y si el juego lo ve estirado (▲) o doblado (▼). Sirve para entender por qué confunde un gesto. Los umbrales están en `UMBRAL`, en `public/js/gesto.js`.

Si nadie toca nada por 45 s en las pantallas finales (o 90 s en pausa), el juego vuelve solo al inicio.

## Correrlo en tu computador

Necesitas Node.js 20 o superior.

```bash
npm install
npm start
```

Luego abre http://localhost:3000. En `localhost` la cámara funciona sin HTTPS.

Pruebas automáticas:

```bash
npm test
```

## Publicarlo con Dokploy (recomendado si tu VPS ya tiene Dokploy)

1. **DNS:** registro `A` con nombre `robi` → IP del VPS.
2. **Código en Git** (GitHub, GitLab o Gitea), por ejemplo en un repo privado.
3. En Dokploy: **Project → Create Service → Application**.
   - *Provider:* tu repo y la rama `main`.
   - *Build Type:* **Dockerfile**, con *Docker File* `./Dockerfile`.
4. **Environment:** `ADMIN_KEY=una-clave-tuya`
5. **Advanced → Volumes:** tipo **Volume**, con nombre `robi-data` y *Mount Path* `/app/data`. Aquí quedan los puntajes; sin el volumen se borran en cada despliegue.
6. **Domains:** *Host* `robi.shona.lat`, *Path* `/`, *Container Port* `3000`, **HTTPS activado** y certificado **Let's Encrypt**.
7. **Deploy**, y revisa la pestaña *Logs* hasta ver `Juego listo en…`.

No subas las réplicas a más de 1: las salas de duelo viven en la memoria del servidor.

## Publicarlo en el VPS sin Dokploy (`robi.shona.lat`)

> ⚠️ **Los navegadores solo dejan usar la cámara con HTTPS.** Por eso el juego debe ir detrás de un dominio con certificado.

1. **DNS:** en el panel de tu dominio `shona.lat`, crea un registro `A` con nombre `robi` que apunte a la IP del VPS. Si quieres otro subdominio, cámbialo también en `deploy/Caddyfile`.
2. **Copiar el proyecto** al VPS, por ejemplo en `/opt/robi`. No hace falta copiar `node_modules`.
3. **Instalar** en el VPS:
   ```bash
   cd /opt/robi
   npm ci --omit=dev
   sudo mkdir -p data && sudo chown www-data:www-data data
   ```
4. **Servicio** que arranca solo y se reinicia si falla:
   ```bash
   sudo cp deploy/robi.service /etc/systemd/system/
   sudo nano /etc/systemd/system/robi.service   # cambia ADMIN_KEY
   sudo systemctl enable --now robi
   ```
5. **HTTPS con Caddy** (saca el certificado automáticamente):
   ```bash
   sudo apt install caddy
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
   Si tu VPS ya usa nginx, mejor usa `deploy/nginx.conf` + `certbot --nginx -d robi.shona.lat`.

Abre `https://robi.shona.lat` en cada laptop. La pantalla del TV va en `https://robi.shona.lat/pantalla`.

## En la feria

- Usa **Chrome o Edge** en pantalla completa (`F`). Para que nadie salga del juego y no se pida permiso de cámara a cada rato, puedes abrirlo en modo kiosco:
  ```bash
  chrome.exe --kiosk https://robi.shona.lat --use-fake-ui-for-media-stream
  ```
- **Luz de frente**: con una ventana o lámpara detrás de la persona, la detección falla.
- La etiqueta abajo a la izquierda de la cámara dice en vivo qué gesto está viendo el juego. Úsala para explicar cómo poner la mano.
- **Si se cae el internet:** corre `npm start` en cada laptop y abre `http://localhost:3000`. Así funcionan "Contra Robi" y "2 en esta laptop"; el duelo necesita un servidor compartido.

## Video del rival en el duelo (WebRTC)

El video va directo de una laptop a la otra; tu servidor solo les ayuda a encontrarse. Usa los servidores STUN públicos de Google y Cloudflare. Si las dos laptops están en la misma red wifi (lo normal en la feria), conecta casi siempre.

Si la red de la feria bloquea el video, en el lado del rival aparece su nombre y su formación, y se puede jugar igual. Para forzar que el video pase por esas redes hace falta un servidor TURN (por ejemplo coturn). Se agrega en `config.json`:

```json
"iceServers": [
  { "urls": "stun:stun.l.google.com:19302" },
  { "urls": "turn:turn.shona.lat:3478", "username": "feria", "credential": "clave" }
]
```

## Configuración

`config.json` tiene el título, las opciones de rondas (`opcionesRondas` y `rondasPorDefecto`) y **la lista de formaciones** (ajústala a las de tu centro). En `tiempos` (milisegundos) se ajusta cuánto dura cada cosa:
- `revelar`: el resultado en el duelo, con las cámaras destapadas.
- `primeraPausa`: la espera antes de la primera ronda del duelo, para que conecte el video.
- `revelarSolo`: el resultado contra Robi y en J1 vs J2. Variables de entorno del servidor: `PORT`, `HOST`, `ADMIN_KEY` y `DATA_DIR`. Los puntajes se guardan en `data/puntajes.jsonl`, una partida por línea.

## El robot (Blender)

`blender/crear_robot.py` construye a Robi por código y exporta `public/modelos/robot.glb`. Para regenerarlo después de cambiar colores o formas:

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python blender/crear_robot.py
```

El juego anima el robot moviendo sus partes por nombre (`Cabeza`, `Hombro_D`, `Mano_Piedra`…), así que no cambies esos nombres. `blender/robot.blend` queda para editarlo a mano.

## Estructura

```
server.js            servidor sin dependencias: archivos, ranking, salas de duelo (SSE)
lib/filtro.js        filtro de groserías para los nombres
config.json          formaciones, opciones de rondas, título
public/
  index.html         el juego
  pantalla.html      ranking en vivo para TV
  admin.html         panel de administración
  js/gesto.js        convierte los 21 puntos de la mano en piedra/papel/tijera
  js/manos.js        cámara + MediaPipe (y modo teclado)
  js/robot.js        Robi en Three.js: animaciones y expresiones
  js/ia.js           cómo elige Robi
  js/main.js         pantallas y flujo de cada modo
  modelos/           robot.glb (Blender) y hand_landmarker.task (MediaPipe)
blender/             script que genera el robot
deploy/              Caddyfile, nginx.conf y servicio systemd
test/                pruebas (npm test)
```
