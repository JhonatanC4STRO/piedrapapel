"""
Genera a "Robi", el rival de Piedra, Papel o Tijera, y lo exporta como GLB.

Uso (desde la carpeta del proyecto):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --python blender/crear_robot.py

Salidas:
  public/modelos/robot.glb   -> modelo que usa el juego (Three.js)
  blender/robot.blend        -> archivo editable
  blender/preview.png        -> render de prueba

El juego anima los nodos por nombre, asi que no cambies estos nombres:
  Robot, Cuerpo, Cabeza, Ojo_I, Ojo_D, Boca, Antena_Bola,
  Hombro_D, Codo_D, Mano, Mano_Piedra, Mano_Papel, Mano_Tijera, Hombro_I
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA_GLB = os.path.join(RAIZ, "public", "modelos", "robot.glb")
SALIDA_BLEND = os.path.join(RAIZ, "blender", "robot.blend")
SALIDA_PNG = os.path.join(RAIZ, "blender", "preview.png")

# --------------------------------------------------------------------------
# Escena limpia
# --------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
escena = bpy.context.scene


def material(nombre, color, rugosidad=0.4, metal=0.0, emision=None, fuerza=0.0):
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rugosidad
    bsdf.inputs["Metallic"].default_value = metal
    if emision:
        bsdf.inputs["Emission Color"].default_value = (*emision, 1.0)
        bsdf.inputs["Emission Strength"].default_value = fuerza
    return m


MAT = {
    "blanco": material("Blanco", (0.90, 0.88, 0.84), 0.35),
    "naranja": material("Naranja", (1.00, 0.36, 0.08), 0.45),
    "oscuro": material("Pantalla", (0.02, 0.025, 0.05), 0.15),
    "gris": material("Metal", (0.45, 0.48, 0.54), 0.3, 0.7),
    "cian": material("Luz", (0.20, 0.95, 1.00), 0.3, 0.0, (0.20, 0.95, 1.00), 4.0),
    "ambar": material("LuzAntena", (1.00, 0.55, 0.10), 0.3, 0.0, (1.00, 0.55, 0.10), 5.0),
}


def asignar(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def suavizar(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def caja_redonda(nombre, tam, pos, mat, radio=0.08, segmentos=4, rot=(0, 0, 0)):
    """Cubo con bordes redondeados (bevel aplicado al exportar)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos, rotation=rot)
    o = bpy.context.active_object
    o.name = nombre
    o.scale = tam
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    b = o.modifiers.new("Bevel", "BEVEL")
    b.width = min(radio, min(tam) * 0.49)
    b.segments = segmentos
    b.limit_method = "NONE"
    suavizar(o)
    asignar(o, mat)
    return o


def esfera(nombre, radio, pos, mat, escala=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radio, location=pos, segments=32, ring_count=16)
    o = bpy.context.active_object
    o.name = nombre
    o.scale = escala
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    suavizar(o)
    asignar(o, mat)
    return o


def cilindro(nombre, radio, alto, pos, mat, rot=(0, 0, 0), vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(radius=radio, depth=alto, location=pos, rotation=rot, vertices=vertices)
    o = bpy.context.active_object
    o.name = nombre
    b = o.modifiers.new("Bevel", "BEVEL")
    b.width = min(radio * 0.3, 0.02)
    b.segments = 2
    suavizar(o)
    asignar(o, mat)
    return o


def vacio(nombre, pos):
    o = bpy.data.objects.new(nombre, None)
    o.location = pos
    o.empty_display_size = 0.15
    escena.collection.objects.link(o)
    return o


def emparentar(hijo, padre):
    bpy.context.view_layer.update()
    mundo = hijo.matrix_world.copy()
    hijo.parent = padre
    hijo.matrix_world = mundo


# --------------------------------------------------------------------------
# Cuerpo
# Blender: Z arriba, el robot mira hacia -Y (hacia la camara).
# --------------------------------------------------------------------------
robot = vacio("Robot", (0, 0, 0))

cuerpo = caja_redonda("Cuerpo", (1.10, 0.80, 1.00), (0, 0, 0.95), MAT["blanco"], radio=0.28, segmentos=6)
panza = caja_redonda("Panel", (0.62, 0.06, 0.42), (0, -0.40, 0.92), MAT["naranja"], radio=0.08)
for i, x in enumerate((-0.16, 0.0, 0.16)):
    esfera(f"Boton_{i}", 0.055, (x, -0.44, 0.98), MAT["cian"] if i == 1 else MAT["blanco"], (1, 0.5, 1))
rejilla = [caja_redonda(f"Rejilla_{i}", (0.42, 0.03, 0.035), (0, -0.43, 0.80 - i * 0.06), MAT["oscuro"], radio=0.012)
           for i in range(3)]
base = cilindro("Base", 0.48, 0.22, (0, 0, 0.30), MAT["gris"])
aro = cilindro("Aro", 0.56, 0.08, (0, 0, 0.18), MAT["naranja"])
cuello = cilindro("Cuello", 0.16, 0.18, (0, 0, 1.52), MAT["gris"])

for o in [cuerpo, panza, base, aro, cuello, *rejilla] + [bpy.data.objects[f"Boton_{i}"] for i in range(3)]:
    emparentar(o, robot)

# --------------------------------------------------------------------------
# Cabeza con pantalla y cara
# --------------------------------------------------------------------------
cabeza = vacio("Cabeza", (0, 0, 1.62))
emparentar(cabeza, robot)

craneo = caja_redonda("Craneo", (1.30, 0.95, 0.90), (0, 0, 2.05), MAT["blanco"], radio=0.30, segmentos=6)
pantalla = caja_redonda("Visor", (1.06, 0.10, 0.64), (0, -0.44, 2.05), MAT["oscuro"], radio=0.18, segmentos=5)
oreja_i = cilindro("Oreja_I", 0.17, 0.14, (-0.70, 0, 2.05), MAT["naranja"], rot=(0, math.radians(90), 0))
oreja_d = cilindro("Oreja_D", 0.17, 0.14, (0.70, 0, 2.05), MAT["naranja"], rot=(0, math.radians(90), 0))
ojo_i = esfera("Ojo_I", 0.115, (-0.24, -0.50, 2.12), MAT["cian"], (1, 0.35, 1.25))
ojo_d = esfera("Ojo_D", 0.115, (0.24, -0.50, 2.12), MAT["cian"], (1, 0.35, 1.25))
boca = caja_redonda("Boca", (0.30, 0.04, 0.06), (0, -0.50, 1.88), MAT["cian"], radio=0.025)
mejilla_i = esfera("Mejilla_I", 0.06, (-0.40, -0.49, 1.92), MAT["ambar"], (1.2, 0.3, 0.7))
mejilla_d = esfera("Mejilla_D", 0.06, (0.40, -0.49, 1.92), MAT["ambar"], (1.2, 0.3, 0.7))
antena = cilindro("Antena", 0.025, 0.32, (0, 0, 2.62), MAT["gris"], vertices=12)
antena_bola = esfera("Antena_Bola", 0.085, (0, 0, 2.80), MAT["ambar"])

for o in (craneo, pantalla, oreja_i, oreja_d, ojo_i, ojo_d, boca, mejilla_i, mejilla_d, antena, antena_bola):
    emparentar(o, cabeza)

# --------------------------------------------------------------------------
# Brazo derecho del robot (a la izquierda de la pantalla del jugador no:
# el robot mira hacia nosotros, su derecha queda a nuestra izquierda).
# Usamos X+ para que quede a la derecha de la pantalla.
# --------------------------------------------------------------------------
hombro_d = vacio("Hombro_D", (0.66, 0, 1.22))
emparentar(hombro_d, robot)
esfera("Hombro_D_Bola", 0.17, (0.66, 0, 1.22), MAT["naranja"])
cilindro("Brazo_D", 0.10, 0.60, (0.92, 0, 1.085), MAT["gris"], rot=(0, math.radians(-63), 0))
emparentar(bpy.data.objects["Hombro_D_Bola"], hombro_d)
emparentar(bpy.data.objects["Brazo_D"], hombro_d)

codo_d = vacio("Codo_D", (1.18, 0, 0.95))
emparentar(codo_d, hombro_d)
esfera("Codo_D_Bola", 0.12, (1.18, 0, 0.95), MAT["blanco"])
cilindro("Antebrazo_D", 0.11, 0.62, (1.21, -0.06, 1.24), MAT["blanco"], rot=(math.radians(10), 0, 0))
emparentar(bpy.data.objects["Codo_D_Bola"], codo_d)
emparentar(bpy.data.objects["Antebrazo_D"], codo_d)

# La mano: palma mirando a la camara (-Y), dedos hacia +Z.
MANO_POS = Vector((1.22, -0.10, 1.55))
mano = vacio("Mano", tuple(MANO_POS))
emparentar(mano, codo_d)
cilindro("Muneca", 0.12, 0.10, tuple(MANO_POS + Vector((0, 0, -0.02))), MAT["gris"])
emparentar(bpy.data.objects["Muneca"], mano)


def p(x, y, z):
    """Posicion relativa a la mano."""
    return tuple(MANO_POS + Vector((x, y, z)))


DEDOS_X = (-0.135, -0.045, 0.045, 0.135)   # indice ... menique (de izquierda a derecha en pantalla)
LARGOS = (0.30, 0.34, 0.31, 0.25)


def palma(grupo, sufijo):
    o = caja_redonda(f"Palma_{sufijo}", (0.38, 0.16, 0.34), p(0, 0, 0.22), MAT["naranja"], radio=0.07)
    emparentar(o, grupo)


def dedo_estirado(grupo, sufijo, i, angulo=0.0):
    largo = LARGOS[i]
    x = DEDOS_X[i]
    base_z = 0.38
    centro = Vector((x, 0, base_z + largo / 2))
    # rotar alrededor de la base del dedo (eje Y) para abrir en V
    piv = Vector((x, 0, base_z))
    rot = Matrix.Rotation(math.radians(angulo), 3, "Y")
    centro = piv + rot @ (centro - piv)
    o = caja_redonda(f"Dedo{i}_{sufijo}", (0.082, 0.10, largo), p(*centro), MAT["naranja"], radio=0.04,
                     rot=(0, math.radians(angulo), 0))
    emparentar(o, grupo)
    # yema clara
    punta = piv + rot @ Vector((0, 0, largo - 0.03))
    u = esfera(f"Yema{i}_{sufijo}", 0.036, p(punta.x + 0, -0.035, punta.z), MAT["blanco"], (1, 0.6, 1))
    emparentar(u, grupo)


def dedo_doblado(grupo, sufijo, i):
    x = DEDOS_X[i]
    o = caja_redonda(f"Nudillo{i}_{sufijo}", (0.086, 0.17, 0.12), p(x, -0.06, 0.40), MAT["naranja"], radio=0.045)
    emparentar(o, grupo)


def pulgar(grupo, sufijo, abierto):
    if abierto:
        o = caja_redonda(f"Pulgar_{sufijo}", (0.09, 0.10, 0.22), p(-0.25, -0.02, 0.24), MAT["naranja"], radio=0.042,
                         rot=(0, math.radians(-45), 0))
    else:
        o = caja_redonda(f"Pulgar_{sufijo}", (0.24, 0.09, 0.09), p(-0.04, -0.13, 0.28), MAT["naranja"], radio=0.042,
                         rot=(0, math.radians(8), 0))
    emparentar(o, grupo)


def crear_gesto(nombre, extendidos, angulos, pulgar_abierto):
    grupo = vacio(nombre, tuple(MANO_POS))
    emparentar(grupo, mano)
    suf = nombre.split("_")[1][:2]
    palma(grupo, suf)
    for i in range(4):
        if extendidos[i]:
            dedo_estirado(grupo, suf, i, angulos[i])
        else:
            dedo_doblado(grupo, suf, i)
    pulgar(grupo, suf, pulgar_abierto)
    return grupo


g_piedra = crear_gesto("Mano_Piedra", (False, False, False, False), (0, 0, 0, 0), False)
g_papel = crear_gesto("Mano_Papel", (True, True, True, True), (-10, -3, 3, 10), True)
g_tijera = crear_gesto("Mano_Tijera", (True, True, False, False), (-18, 12, 0, 0), False)

# Mano mas grande para que el gesto se lea desde lejos (crece desde la muneca)
mano.scale = (1.45, 1.45, 1.45)

# --------------------------------------------------------------------------
# Brazo izquierdo descansando
# --------------------------------------------------------------------------
hombro_i = vacio("Hombro_I", (-0.66, 0, 1.22))
emparentar(hombro_i, robot)
for o in (
    esfera("Hombro_I_Bola", 0.17, (-0.66, 0, 1.22), MAT["naranja"]),
    cilindro("Brazo_I", 0.10, 0.62, (-0.80, 0, 0.92), MAT["gris"], rot=(0, math.radians(20), 0)),
    esfera("Mano_I", 0.16, (-0.90, 0, 0.62), MAT["naranja"]),
):
    emparentar(o, hombro_i)

# --------------------------------------------------------------------------
# Guardar y exportar
# --------------------------------------------------------------------------
os.makedirs(os.path.dirname(SALIDA_GLB), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=SALIDA_BLEND)

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(
    filepath=SALIDA_GLB,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
)

# --------------------------------------------------------------------------
# Render de prueba (opcional)
# --------------------------------------------------------------------------
if "--sin-render" not in sys.argv:
    g_piedra.hide_render = True
    g_tijera.hide_render = True
    cam_data = bpy.data.cameras.new("Camara")
    cam = bpy.data.objects.new("Camara", cam_data)
    escena.collection.objects.link(cam)
    cam.location = (1.6, -6.2, 2.4)
    direccion = Vector((0.15, 0, 1.45)) - cam.location
    cam.rotation_euler = direccion.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 50
    escena.camera = cam

    for nombre, energia, pos in (("Clave", 900, (3, -4, 5)), ("Relleno", 300, (-4, -3, 2)), ("Contra", 500, (0, 4, 4))):
        luz = bpy.data.lights.new(nombre, "AREA")
        luz.energy = energia
        luz.size = 3
        lo = bpy.data.objects.new(nombre, luz)
        lo.location = pos
        lo.rotation_euler = (Vector((0, 0, 1.2)) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        escena.collection.objects.link(lo)

    mundo = bpy.data.worlds.new("Mundo")
    mundo.use_nodes = True
    mundo.node_tree.nodes["Background"].inputs["Color"].default_value = (0.10, 0.10, 0.22, 1)
    escena.world = mundo

    for motor in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            escena.render.engine = motor
            break
        except TypeError:
            continue
    if escena.render.engine == "CYCLES":
        escena.cycles.samples = 32
    escena.render.resolution_x = 600
    escena.render.resolution_y = 600
    gestos = {"papel": g_papel, "piedra": g_piedra, "tijera": g_tijera}

    def ocultar(grupo, valor):
        grupo.hide_render = valor
        for h in grupo.children_recursive:
            h.hide_render = valor

    for nombre, grupo in gestos.items():
        for g in gestos.values():
            ocultar(g, g is not grupo)
        escena.render.filepath = SALIDA_PNG if nombre == "papel" else SALIDA_PNG.replace(".png", f"_{nombre}.png")
        bpy.ops.render.render(write_still=True)

print("LISTO:", SALIDA_GLB)
