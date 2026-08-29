"""Build the presentation-room-v1 review candidate from project-authored primitives."""

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


SCENE_ID = "presentation-room-v1"
REVIEW_VIEWS = ("entry", "audience", "presenter", "diagonal-overview")


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--review-dir", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def semantic_to_blender(position):
    """Map semantic Y-up coordinates to Blender Z-up coordinates."""
    x, y, z = position
    return (x, z, y)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item)


def material(name, color, roughness=0.6, metallic=0.0, emission=None, emission_strength=0.0):
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    value.diffuse_color = (*color, 1.0)
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission is not None:
        emission_input = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        if emission_input:
            emission_input.default_value = (*emission, 1.0)
        strength_input = shader.inputs.get("Emission Strength")
        if strength_input:
            strength_input.default_value = emission_strength
    return value


def assign_material(obj, value):
    obj.data.materials.append(value)


def bevel_object(obj, width=0.04, segments=3):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new(name="crafted-edge", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def box(name, dimensions, position, value, bevel=0.03, rotation=(0.0, 0.0, 0.0), parent=None):
    bpy.ops.mesh.primitive_cube_add(location=semantic_to_blender(position))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (dimensions[0], dimensions[2], dimensions[1])
    obj.rotation_euler = (rotation[0], rotation[2], rotation[1])
    if bevel:
        bevel_object(obj, min(bevel, min(dimensions) * 0.22))
    assign_material(obj, value)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def cylinder(name, radius, depth, position, value, vertices=24, rotation=(0.0, 0.0, 0.0), parent=None):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=semantic_to_blender(position),
        rotation=(rotation[0], rotation[2], rotation[1]),
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, value)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def tube(name, points, radius, value, parent=None):
    curve = bpy.data.curves.new(name=f"{name}.curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.resolution_u = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = semantic_to_blender(coordinate)
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, value)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def empty(name, position, properties=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.18
    obj.location = semantic_to_blender(position)
    bpy.context.collection.objects.link(obj)
    for key, value in (properties or {}).items():
        obj[key] = value
    return obj


def point_at(obj, target):
    direction = Vector(semantic_to_blender(target)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def create_chair(seat_id, position, upholstery, rust, metal, ash):
    x, _, z = position
    root = empty(f"chair.{seat_id}", position, {"seatId": seat_id, "role": "audience-seat"})

    # Layered cushion and curved shell make the chair read as assembled furniture.
    box(f"chair.{seat_id}.seat-shell", (0.78, 0.09, 0.68), (x, 0.43, z), ash, 0.07, parent=root)
    box(f"chair.{seat_id}.seat-cushion", (0.68, 0.12, 0.58), (x, 0.50, z - 0.015), upholstery, 0.09, parent=root)
    box(
        f"chair.{seat_id}.back-shell",
        (0.76, 0.70, 0.10),
        (x, 0.88, z + 0.27),
        ash,
        0.07,
        rotation=(math.radians(-8), 0.0, 0.0),
        parent=root,
    )
    box(
        f"chair.{seat_id}.back-cushion",
        (0.66, 0.54, 0.10),
        (x, 0.90, z + 0.205),
        rust,
        0.08,
        rotation=(math.radians(-8), 0.0, 0.0),
        parent=root,
    )

    for side, offset in (("left", -0.31), ("right", 0.31)):
        tube(
            f"chair.{seat_id}.sled-{side}",
            [
                (x + offset, 0.46, z - 0.22),
                (x + offset, 0.08, z - 0.23),
                (x + offset, 0.04, z + 0.25),
                (x + offset, 0.44, z + 0.27),
            ],
            0.026,
            metal,
            parent=root,
        )
        tube(
            f"chair.{seat_id}.arm-{side}",
            [
                (x + offset, 0.55, z + 0.08),
                (x + offset, 0.72, z - 0.02),
                (x + offset, 0.72, z - 0.23),
            ],
            0.024,
            metal,
            parent=root,
        )
        box(
            f"chair.{seat_id}.arm-pad-{side}",
            (0.09, 0.055, 0.27),
            (x + offset, 0.735, z - 0.12),
            upholstery,
            0.025,
            parent=root,
        )
    return root


def create_architecture(materials):
    mineral = materials["mineral"]
    mineral_dark = materials["mineral-dark"]
    ash = materials["ash"]
    blue = materials["blue"]
    rust = materials["rust"]
    metal = materials["metal"]
    carpet = materials["carpet"]
    screen = materials["screen"]
    glow = materials["glow"]
    control = materials["control"]

    box("architecture.floor", (10.8, 0.18, 11.8), (0, -0.09, 0), ash, 0.02)
    box("architecture.audience-carpet.left", (3.7, 0.035, 5.6), (-2.8, 0.025, 1.6), carpet, 0.025)
    box("architecture.audience-carpet.right", (3.7, 0.035, 5.6), (2.8, 0.025, 1.6), carpet, 0.025)
    box("architecture.center-aisle-inlay", (1.45, 0.045, 7.5), (0, 0.03, 1.3), mineral_dark, 0.018)
    box("architecture.center-aisle-edge.left", (0.045, 0.035, 7.5), (-0.75, 0.052, 1.3), rust, 0.012)
    box("architecture.center-aisle-edge.right", (0.045, 0.035, 7.5), (0.75, 0.052, 1.3), rust, 0.012)
    for index, z in enumerate((4.25, 2.85, 1.45, 0.05)):
        for side in (-1, 1):
            box(
                f"functional.aisle-marker.{index + 1:02d}.{'left' if side < 0 else 'right'}",
                (0.09, 0.025, 0.22),
                (side * 0.61, 0.067, z),
                glow,
                0.012,
            )

    box("architecture.wall.left", (0.20, 4.4, 11.8), (-5.4, 2.2, 0), mineral, 0.025)
    box("architecture.wall.right", (0.20, 4.4, 11.8), (5.4, 2.2, 0), mineral, 0.025)
    box("architecture.wall.focal", (10.8, 4.4, 0.20), (0, 2.2, -5.9), mineral, 0.025)
    box("architecture.wall.rear-left", (4.45, 4.4, 0.20), (-3.175, 2.2, 5.9), mineral, 0.025)
    box("architecture.wall.rear-right", (4.45, 4.4, 0.20), (3.175, 2.2, 5.9), mineral, 0.025)
    box("architecture.entry-header", (1.9, 1.7, 0.20), (0, 3.55, 5.9), mineral, 0.025)

    box("architecture.stage", (8.8, 0.24, 1.8), (0, 0.12, -4.25), ash, 0.035)
    box("architecture.stage-step", (6.4, 0.12, 0.48), (0, 0.06, -3.13), ash, 0.025)
    box("architecture.stage-apron", (8.8, 0.19, 0.12), (0, 0.125, -3.30), blue, 0.022)
    box("architecture.stage-rust-line", (8.2, 0.055, 0.07), (0, 0.255, -3.25), rust, 0.016)

    # The physical screen face is exactly 5.12 x 2.88 and sits at semantic z=-5.33.
    box("screen-surround.backdrop", (7.18, 3.92, 0.14), (0, 2.48, -5.68), blue, 0.045)
    box("media.debug-main", (5.12, 2.88, 0.06), (0, 2.48, -5.36), screen, 0.025)
    box("screen-surround.left-pier", (0.50, 3.65, 0.34), (-2.93, 2.34, -5.51), ash, 0.055)
    box("screen-surround.right-pier", (0.50, 3.65, 0.34), (2.93, 2.34, -5.51), ash, 0.055)
    box("screen-surround.header", (6.28, 0.42, 0.34), (0, 4.13, -5.55), blue, 0.055)
    box("screen-surround.sill", (6.28, 0.23, 0.40), (0, 0.94, -5.50), ash, 0.045)
    box("screen-surround.light-slot", (5.7, 0.055, 0.08), (0, 3.96, -5.31), glow, 0.012)
    box("screen-surround.rust-reveal.left", (0.055, 3.02, 0.05), (-2.62, 2.48, -5.30), rust, 0.012)
    box("screen-surround.rust-reveal.right", (0.055, 3.02, 0.05), (2.62, 2.48, -5.30), rust, 0.012)

    # Side acoustic fins and upholstered panels frame the audience without narrowing aisles.
    for side in (-1, 1):
        x = side * 5.17
        box(
            f"acoustic.backing.{'left' if side < 0 else 'right'}",
            (0.12, 3.22, 9.25),
            (side * 5.30, 2.05, 0),
            mineral_dark,
            0.035,
        )
        for index, z in enumerate((-4.5, -3.65, -2.8, -1.95, -1.1, -0.25, 0.6, 1.45, 2.3, 3.15, 4.0)):
            box(
                f"acoustic.fin.{'left' if side < 0 else 'right'}.{index + 1:02d}",
                (0.16, 2.55, 0.12),
                (x, 2.0, z),
                ash,
                0.025,
                rotation=(0.0, math.radians(side * 13), 0.0),
            )
        for index, (z, value) in enumerate(((-2.4, blue), (0.05, rust), (2.55, blue))):
            box(
                f"acoustic.panel.{'left' if side < 0 else 'right'}.{index + 1:02d}",
                (0.13, 1.05, 1.55),
                (side * 5.25, 2.0, z),
                value,
                0.09,
            )
        box(
            f"acoustic.rail.{'left' if side < 0 else 'right'}.lower",
            (0.16, 0.09, 9.1),
            (side * 5.12, 0.71, 0),
            rust,
            0.025,
        )
        box(
            f"acoustic.rail.{'left' if side < 0 else 'right'}.upper",
            (0.16, 0.09, 9.1),
            (side * 5.12, 3.37, 0),
            ash,
            0.025,
        )

    # Layered ceiling rafts and light channels establish a presentation-room rhythm.
    box("ceiling.perimeter.left", (1.25, 0.26, 10.9), (-4.72, 4.24, 0), mineral_dark, 0.04)
    box("ceiling.perimeter.right", (1.25, 0.26, 10.9), (4.72, 4.24, 0), mineral_dark, 0.04)
    for index, z in enumerate((-3.8, -2.25, -0.7, 0.85, 2.4, 3.95)):
        box(f"ceiling.raft.{index + 1:02d}", (7.2, 0.16, 0.76), (0, 4.18, z), mineral_dark, 0.06)
        box(f"ceiling.raft-trim.{index + 1:02d}", (7.0, 0.055, 0.06), (0, 4.075, z - 0.32), ash, 0.014)
        box(f"ceiling.light.{index + 1:02d}", (5.8, 0.045, 0.11), (0, 4.075, z), glow, 0.018)

    # A faceted lectern gives the presenter zone a clear purpose.
    box("furniture.lectern.base", (0.92, 0.12, 0.64), (-3.35, 0.34, -4.15), metal, 0.05)
    box(
        "furniture.lectern.stem",
        (0.56, 1.02, 0.34),
        (-3.35, 0.86, -4.17),
        blue,
        0.07,
        rotation=(math.radians(-6), 0.0, 0.0),
    )
    box(
        "furniture.lectern.top",
        (0.95, 0.10, 0.52),
        (-3.35, 1.38, -4.10),
        ash,
        0.05,
        rotation=(math.radians(-10), 0.0, 0.0),
    )
    box("furniture.lectern.accent", (0.10, 0.56, 0.04), (-3.35, 0.94, -3.97), rust, 0.025)
    box(
        "functional.presenter-monitor",
        (0.52, 0.31, 0.045),
        (-3.35, 1.56, -4.10),
        control,
        0.025,
        rotation=(math.radians(-18), 0.0, 0.0),
    )
    cylinder("functional.presenter-control", 0.075, 0.045, (-3.02, 1.48, -4.02), rust, vertices=24)

    box("functional.stage-av-credenza", (1.32, 0.66, 0.48), (3.65, 0.57, -4.58), blue, 0.07)
    box("functional.stage-av-credenza.top", (1.42, 0.09, 0.56), (3.65, 0.945, -4.58), ash, 0.04)
    for side in (-1, 1):
        box(
            f"functional.stage-av-credenza.pull.{'left' if side < 0 else 'right'}",
            (0.045, 0.24, 0.035),
            (3.65 + side * 0.28, 0.60, -4.325),
            rust,
            0.014,
        )

    for side in (-1, 1):
        box(f"rear.console.{'left' if side < 0 else 'right'}", (1.7, 0.72, 0.48), (side * 4.15, 0.36, 4.92), blue, 0.08)
        box(f"rear.console.top.{'left' if side < 0 else 'right'}", (1.82, 0.10, 0.58), (side * 4.15, 0.77, 4.92), ash, 0.045)


def create_lighting(materials):
    glow = materials["glow"]
    metal = materials["metal"]

    world = bpy.context.scene.world or bpy.data.worlds.new("presentation-room.world")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.045, 0.055, 0.075, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.16

    def area(name, position, target, energy, size, color):
        data = bpy.data.lights.new(name=f"{name}.data", type="AREA")
        data.energy = energy
        data.shape = "RECTANGLE"
        data.size = size[0]
        data.size_y = size[1]
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = semantic_to_blender(position)
        bpy.context.collection.objects.link(obj)
        point_at(obj, target)
        return obj

    area("light.stage-wash", (0, 3.9, -3.3), (0, 1.8, -5.25), 620, (6.2, 2.0), (1.0, 0.62, 0.36))
    area("light.audience-fill", (0, 4.02, 1.3), (0, 0.6, 1.1), 780, (6.4, 4.0), (1.0, 0.70, 0.45))
    area("light.entry-fill", (0, 3.8, 4.55), (0, 1.0, 2.2), 380, (3.4, 2.0), (1.0, 0.58, 0.32))
    area("light.screen-softbox", (0, 3.45, -4.95), (0, 2.1, -3.0), 260, (4.8, 1.2), (0.48, 0.62, 1.0))
    area("light.acoustic-wash-left", (-4.75, 3.45, -0.6), (-5.15, 1.8, -0.6), 170, (1.4, 3.2), (1.0, 0.38, 0.18))
    area("light.acoustic-wash-right", (4.75, 3.45, -0.6), (5.15, 1.8, -0.6), 170, (1.4, 3.2), (1.0, 0.38, 0.18))

    for side in (-1, 1):
        for index, z in enumerate((-3.2, -0.2, 2.8)):
            box(
                f"practical.sconce.{'left' if side < 0 else 'right'}.{index + 1:02d}.backplate",
                (0.08, 0.66, 0.34),
                (side * 5.23, 2.35, z),
                metal,
                0.03,
            )
            cylinder(
                f"practical.sconce.{'left' if side < 0 else 'right'}.{index + 1:02d}.glow",
                0.075,
                0.42,
                (side * 5.15, 2.35, z),
                glow,
                vertices=20,
                rotation=(0.0, math.radians(90), 0.0),
            )


def create_cameras(review_views):
    for view in review_views:
        data = bpy.data.cameras.new(f"camera.review.{view['id']}.data")
        data.lens = 50
        data.angle = math.radians(view["fovDegrees"])
        data.sensor_fit = "VERTICAL"
        obj = bpy.data.objects.new(f"camera.review.{view['id']}", data)
        obj.location = semantic_to_blender((view["position"]["x"], view["position"]["y"], view["position"]["z"]))
        bpy.context.collection.objects.link(obj)
        point_at(obj, (view["target"]["x"], view["target"]["y"], view["target"]["z"]))


def export_glb(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_extras=True,
    )


def configure_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.65
    scene.render.image_settings.color_mode = "RGB"


def render_review(path):
    output = Path(path)
    output.mkdir(parents=True, exist_ok=True)
    configure_render()
    scene = bpy.context.scene
    for view_id in REVIEW_VIEWS:
        scene.camera = bpy.data.objects[f"camera.review.{view_id}"]
        scene.render.filepath = str(output / f"{view_id}.png")
        bpy.ops.render.render(write_still=True)


def main():
    args = arguments()
    clear_scene()
    scene = bpy.context.scene
    scene.name = SCENE_ID
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["sceneId"] = SCENE_ID
    scene["status"] = "review"
    scene["humanAcceptance"] = "pending-human-acceptance"
    scene["renderMode"] = "clean"
    scene["coordinateAdapter"] = "semantic(x,y,z)->runtime(x,y,-z)"
    scene["publicationReady"] = False

    materials = {
        "mineral": material("material.mineral-shell", (0.48, 0.42, 0.33), 0.88),
        "mineral-dark": material("material.charcoal-ceiling", (0.025, 0.035, 0.05), 0.82),
        "ash": material("material.warm-ash-wood", (0.38, 0.19, 0.075), 0.58),
        "blue": material("material.deep-desaturated-blue", (0.018, 0.060, 0.125), 0.72),
        "rust": material("material.restrained-rust", (0.34, 0.055, 0.018), 0.74),
        "metal": material("material.dark-bronze-metal", (0.025, 0.020, 0.018), 0.34, 0.72),
        "carpet": material("material.audience-carpet", (0.035, 0.050, 0.065), 0.94),
        "screen": material("material.screen-neutral", (0.30, 0.37, 0.44), 0.38, emission=(0.18, 0.25, 0.34), emission_strength=0.12),
        "glow": material("material.warm-practical-glow", (0.80, 0.20, 0.035), 0.28, emission=(1.0, 0.16, 0.025), emission_strength=2.6),
        "control": material("material.presenter-control", (0.008, 0.025, 0.04), 0.24, emission=(0.015, 0.14, 0.24), emission_strength=0.65),
    }

    create_architecture(materials)
    seats = [
        ("seat-01", (-2.65, 0, 0.35)),
        ("seat-02", (-1.55, 0, 0.35)),
        ("seat-03", (1.55, 0, 0.35)),
        ("seat-04", (2.65, 0, 0.35)),
        ("seat-05", (-2.9, 0, 2.35)),
        ("seat-06", (-1.8, 0, 2.35)),
        ("seat-07", (1.8, 0, 2.35)),
        ("seat-08", (2.9, 0, 2.35)),
    ]
    for index, (seat_id, position) in enumerate(seats):
        accent = materials["rust"] if index in (1, 4, 7) else materials["blue"]
        create_chair(seat_id, position, materials["blue"], accent, materials["metal"], materials["ash"])
        empty(
            f"anchor.{seat_id}",
            (position[0], 0.47, position[2]),
            {"seatId": seat_id, "aimTargetSurfaceId": "debug-main", "visible": True},
        )

    empty("spawn.main", (0, 0, 4.95), {"spawnId": "main", "outsideAudienceRows": True})
    create_lighting(materials)

    review_views = [
        {"id": "entry", "position": {"x": 0, "y": 1.65, "z": 5.1}, "target": {"x": 0, "y": 1.65, "z": -3.5}, "fovDegrees": 60},
        {"id": "audience", "position": {"x": -0.25, "y": 1.55, "z": 2.8}, "target": {"x": 0, "y": 2.1, "z": -5.1}, "fovDegrees": 58},
        {"id": "presenter", "position": {"x": 3.75, "y": 1.58, "z": -3.8}, "target": {"x": 0, "y": 1.15, "z": 1.4}, "fovDegrees": 64},
        {"id": "diagonal-overview", "position": {"x": -4.55, "y": 3.25, "z": 4.65}, "target": {"x": 0, "y": 1.35, "z": -1.1}, "fovDegrees": 68},
    ]
    create_cameras(review_views)

    blend_path = Path(args.blend)
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    export_glb(Path(args.glb))
    render_review(args.review_dir)


if __name__ == "__main__":
    main()
