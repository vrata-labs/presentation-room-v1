"""Create the Presentation Room 0.3.0 visual review source without changing historical source bytes."""

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import runpy
import sys

import bpy
import numpy as np
from mathutils import Vector


SCENE_ID = "presentation-room-v1"
RELEASE_VERSION = "0.3.0"
HISTORICAL_BLEND_SHA256 = "12afe2c438266db169922326f589a2e81478c9ef15111bbdb06a49ce71d7a89f"
BLENDER_VERSION = (4, 5, 12)
BLENDER_BUILD_HASH = "84afd5f785f7"
BLENDER_BINARY_SHA256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
TEXTURE_SIZE = 256

REVIEW_VIEWS = (
    {"id": "entry", "position": (0.0, 1.62, 5.15), "target": (0.0, 1.72, -3.9), "fovDegrees": 59},
    {"id": "audience", "position": (-0.2, 1.48, 2.9), "target": (0.0, 2.08, -5.18), "fovDegrees": 57},
    {"id": "presenter", "position": (3.78, 1.58, -3.72), "target": (0.0, 1.0, 1.45), "fovDegrees": 63},
    {"id": "diagonal-overview", "position": (-4.55, 3.12, 4.62), "target": (0.0, 1.35, -1.15), "fovDegrees": 67},
    {"id": "screen-detail", "position": (2.7, 1.72, -1.95), "target": (0.0, 2.35, -5.34), "fovDegrees": 50},
    {"id": "aisle-seat-detail", "position": (-0.35, 1.18, 4.0), "target": (-2.05, 0.7, 1.0), "fovDegrees": 54},
    {"id": "lighting-detail", "position": (-3.85, 1.3, 1.45), "target": (0.15, 3.88, -0.7), "fovDegrees": 61},
)

MATERIAL_RECIPES = {
    "material.mineral-shell": {
        "baseColorSrgb": "#BEB7AA", "roughness": 0.8, "metallic": 0.0, "texture": "plaster"
    },
    "material.charcoal-ceiling": {
        "baseColorSrgb": "#73787A", "roughness": 0.78, "metallic": 0.02, "texture": "ceiling"
    },
    "material.warm-ash-wood": {
        "baseColorSrgb": "#725744", "roughness": 0.6, "metallic": 0.0, "texture": "wood", "coat": 0.035
    },
    "material.deep-desaturated-blue": {
        "baseColorSrgb": "#355566", "roughness": 0.74, "metallic": 0.0, "texture": "fabric"
    },
    "material.restrained-rust": {
        "baseColorSrgb": "#7F5548", "roughness": 0.74, "metallic": 0.0, "texture": "leather", "coat": 0.02
    },
    "material.dark-bronze-metal": {
        "baseColorSrgb": "#51463D", "roughness": 0.3, "metallic": 0.76, "texture": None
    },
    "material.audience-carpet": {
        "baseColorSrgb": "#5A5E5E", "roughness": 0.94, "metallic": 0.0, "texture": "carpet"
    },
    "material.screen-neutral": {
        "baseColorSrgb": "#171A1C", "roughness": 0.92, "metallic": 0.0, "texture": "screen",
        "specularIorLevel": 0.08, "emissionSrgb": "#343A3E", "emissionStrength": 0.35
    },
    "material.warm-practical-glow": {
        "baseColorSrgb": "#FFE0B8", "roughness": 0.34, "metallic": 0.0, "texture": None,
        "emissionSrgb": "#FFD6AC", "emissionStrength": 4.8
    },
    "material.presenter-control": {
        "baseColorSrgb": "#172B35", "roughness": 0.27, "metallic": 0.12, "texture": None,
        "emissionSrgb": "#235C70", "emissionStrength": 0.55
    },
}

LIGHTING = (
    {"id": "stage-key", "position": (0.0, 3.72, -2.72), "target": (0.0, 1.72, -5.15), "energy": 1500, "size": (6.0, 2.2), "colorSrgb": "#FFE5C8", "shadow": True},
    {"id": "audience-main", "position": (0.0, 4.02, 0.8), "target": (0.0, 0.72, 1.0), "energy": 1580, "size": (6.8, 4.2), "colorSrgb": "#FFE8D0", "shadow": True},
    {"id": "entry-fill", "position": (0.0, 3.74, 4.65), "target": (0.0, 0.9, 2.55), "energy": 760, "size": (3.5, 2.0), "colorSrgb": "#FFDFC1"},
    {"id": "screen-balance", "position": (0.0, 3.48, -4.82), "target": (0.0, 2.0, -3.15), "energy": 360, "size": (4.8, 1.1), "colorSrgb": "#CAD8F2"},
    {"id": "wall-wash-left", "position": (-4.76, 3.4, -0.45), "target": (-5.15, 1.75, -0.45), "energy": 460, "size": (1.25, 3.1), "colorSrgb": "#FFD6B5"},
    {"id": "wall-wash-right", "position": (4.76, 3.4, -0.45), "target": (5.15, 1.75, -0.45), "energy": 460, "size": (1.25, 3.1), "colorSrgb": "#FFD6B5"},
    {"id": "ceiling-lift-front", "position": (0.0, 3.42, -2.15), "target": (0.0, 4.26, -2.15), "energy": 440, "size": (5.8, 2.0), "colorSrgb": "#E7E3D9"},
    {"id": "ceiling-lift-rear", "position": (0.0, 3.42, 2.25), "target": (0.0, 4.26, 2.25), "energy": 440, "size": (5.8, 2.0), "colorSrgb": "#E7E3D9"},
)


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", required=True)
    parser.add_argument("--review-dir", required=True)
    parser.add_argument("--reality", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decoded_build_hash():
    value = bpy.app.build_hash
    return value.decode("ascii") if isinstance(value, bytes) else str(value)


def verify_inputs(output_blend):
    current = Path(bpy.data.filepath).resolve()
    require(current.is_file(), "historical_blend_missing")
    require(sha256(current) == HISTORICAL_BLEND_SHA256, "historical_blend_digest_mismatch")
    require(tuple(bpy.app.version[:3]) == BLENDER_VERSION, "blender_version_mismatch")
    require(decoded_build_hash() == BLENDER_BUILD_HASH, "blender_build_hash_mismatch")
    require(sha256(Path(bpy.app.binary_path).resolve()) == BLENDER_BINARY_SHA256, "blender_binary_digest_mismatch")
    require(output_blend.name == "accepted-scene.blend", "invalid_versioned_blend_name")
    require(output_blend.parent.name == RELEASE_VERSION and output_blend.parent.parent.name == "releases", "invalid_versioned_blend_path")
    require(output_blend != current, "historical_blend_overwrite_forbidden")


def semantic_to_blender(position):
    x, y, z = position
    return (x, z, y)


def point_at(obj, target):
    direction = Vector(semantic_to_blender(target)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def srgb_channel_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def hex_to_linear(value):
    channels = tuple(int(value[index : index + 2], 16) / 255.0 for index in (1, 3, 5))
    return tuple(srgb_channel_to_linear(channel) for channel in channels)


def generated_texture(name, color_hex, style):
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, width=TEXTURE_SIZE, height=TEXTURE_SIZE, alpha=False, float_buffer=False)
    image.colorspace_settings.name = "sRGB"
    y, x = np.mgrid[0:TEXTURE_SIZE, 0:TEXTURE_SIZE].astype(np.float32)
    x /= TEXTURE_SIZE
    y /= TEXTURE_SIZE
    base = np.array(hex_to_linear(color_hex), dtype=np.float32)
    fine = np.sin((x * 131.0 + y * 79.0) * math.tau) * 0.5 + np.sin((x * 43.0 - y * 97.0) * math.tau) * 0.5
    if style == "plaster":
        modulation = 1.0 + 0.025 * fine + 0.018 * np.sin((x * 3.0 + y * 2.0) * math.tau)
    elif style == "ceiling":
        modulation = 1.0 + 0.035 * fine + 0.018 * np.cos(y * 17.0 * math.tau)
    elif style == "wood":
        grain = np.sin((x * 17.0 + 0.22 * np.sin(y * 2.0 * math.tau)) * math.tau)
        modulation = 1.0 + 0.12 * grain + 0.035 * fine
    elif style == "fabric":
        weave = np.sin(x * 96.0 * math.tau) * np.sin(y * 104.0 * math.tau)
        modulation = 1.0 + 0.075 * weave + 0.025 * fine
    elif style == "leather":
        pores = np.sin(x * 61.0 * math.tau + np.sin(y * 23.0 * math.tau))
        modulation = 1.0 + 0.055 * pores + 0.025 * fine
    elif style == "carpet":
        weave = np.sin((x + y) * 86.0 * math.tau) * np.sin((x - y) * 91.0 * math.tau)
        modulation = 1.0 + 0.09 * weave + 0.03 * fine
    elif style == "screen":
        radius = np.sqrt((x - 0.5) ** 2 + (y - 0.52) ** 2)
        modulation = 0.82 + 0.22 * np.clip(1.0 - radius * 1.6, 0.0, 1.0) + 0.015 * fine
    else:
        raise RuntimeError(f"unknown_texture_style:{style}")
    rgb = np.clip(modulation[..., None] * base[None, None, :], 0.0, 1.0)
    rgba = np.concatenate((rgb, np.ones((TEXTURE_SIZE, TEXTURE_SIZE, 1), dtype=np.float32)), axis=2)
    image.pixels.foreach_set(rgba.ravel())
    image.update()
    image["vrataAssetOrigin"] = "project-authored"
    image["vrataGenerator"] = f"{RELEASE_VERSION}:author-release.py"
    image.pack()
    return image


def configure_material(material, recipe):
    material.use_nodes = True
    material.node_tree.nodes.clear()
    output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    shader = material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (0, 0)
    output.location = (420, 0)
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    color = hex_to_linear(recipe["baseColorSrgb"])
    material.diffuse_color = (*color, 1.0)
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = recipe["roughness"]
    shader.inputs["Metallic"].default_value = recipe["metallic"]
    if shader.inputs.get("Coat Weight") is not None:
        shader.inputs["Coat Weight"].default_value = recipe.get("coat", 0.0)
    if shader.inputs.get("Specular IOR Level") is not None:
        shader.inputs["Specular IOR Level"].default_value = recipe.get("specularIorLevel", 0.38)
    if recipe["texture"] is not None:
        texture_asset_id = f"texture.project.{recipe['texture']}"
        image = generated_texture(texture_asset_id, recipe["baseColorSrgb"], recipe["texture"])
        texture = material.node_tree.nodes.new("ShaderNodeTexImage")
        texture.name = f"VRATA_BASECOLOR_{recipe['texture'].upper()}"
        texture.image = image
        texture.interpolation = "Linear"
        texture.location = (-420, 60)
        material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        material["vrataTextureAssetId"] = texture_asset_id
    if "emissionSrgb" in recipe:
        emission = hex_to_linear(recipe["emissionSrgb"])
        emission_color = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        emission_strength = shader.inputs.get("Emission Strength")
        if emission_color is not None:
            emission_color.default_value = (*emission, 1.0)
        if emission_strength is not None:
            emission_strength.default_value = recipe["emissionStrength"]
    material["vrataAssetOrigin"] = "project-authored"
    material["vrataMaterialPass"] = "warm-modern-0.3.0"
    material["vrataRenderProfile"] = "baked-pbr-v1"


def configure_materials():
    actual = {material.name for material in bpy.data.materials}
    require(set(MATERIAL_RECIPES) == actual, f"historical_material_set_drift:{sorted(actual)}")
    for name, recipe in MATERIAL_RECIPES.items():
        configure_material(bpy.data.materials[name], recipe)


def create_area_light(specification):
    name = f"light.review.{specification['id']}"
    data = bpy.data.lights.new(f"{name}.data", type="AREA")
    data.energy = specification["energy"]
    data.shape = "RECTANGLE"
    data.size = specification["size"][0]
    data.size_y = specification["size"][1]
    data.color = hex_to_linear(specification["colorSrgb"])
    data.use_shadow = specification.get("shadow", False)
    obj = bpy.data.objects.new(name, data)
    obj.location = semantic_to_blender(specification["position"])
    bpy.context.collection.objects.link(obj)
    point_at(obj, specification["target"])


def configure_lighting():
    for obj in list(bpy.context.scene.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)
    for data in list(bpy.data.lights):
        bpy.data.lights.remove(data)
    for specification in LIGHTING:
        create_area_light(specification)
    for index, z in enumerate((-3.8, -2.25, -0.7, 0.85, 2.4, 3.95), start=1):
        create_area_light({
            "id": f"ceiling-practical-{index:02d}",
            "position": (0.0, 4.02, z),
            "target": (0.0, 0.55, z),
            "energy": 285,
            "size": (5.25, 0.42),
            "colorSrgb": "#FFE2C5",
            "shadow": True,
        })
    world = bpy.context.scene.world or bpy.data.worlds.new("presentation-room.world")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (*hex_to_linear("#343A3E"), 1.0)
    background.inputs["Strength"].default_value = 0.38


def identifier(value):
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    require(bool(normalized), f"empty_identifier:{value}")
    return normalized


def logical_object(name):
    if name.startswith("chair.seat-"):
        return "chair-" + name.split(".")[1]
    if name == "media.debug-main":
        return "presentation-screen"
    if name.startswith("screen-surround."):
        return "presentation-screen"
    if name.startswith("architecture.stage"):
        return "presentation-stage"
    if name.startswith("architecture."):
        return "room-shell"
    if name.startswith("acoustic."):
        return "acoustic-treatment"
    if name.startswith("ceiling."):
        return "ceiling-system"
    if name.startswith("practical.sconce."):
        return "wall-practicals"
    if name.startswith("furniture.lectern") or name.startswith("functional.presenter"):
        return "presenter-lectern"
    if name.startswith("functional.stage-av-credenza"):
        return "stage-av-credenza"
    if name.startswith("rear.console"):
        return "rear-consoles"
    if name.startswith("functional.aisle-marker") or name.startswith("architecture.center-aisle") or name.startswith("architecture.audience-carpet"):
        return "audience-circulation"
    raise RuntimeError(f"unclassified_mesh:{name}")


def interaction_status(object_id):
    if object_id.startswith("chair-seat-") or object_id == "presentation-screen":
        return "interactive"
    if object_id in {"presenter-lectern", "stage-av-credenza", "rear-consoles"}:
        return "deferred"
    return "passive"


def tag_meshes():
    inventory = []
    seen = set()
    for obj in sorted((candidate for candidate in bpy.context.scene.objects if candidate.type == "MESH" and not candidate.hide_render), key=lambda candidate: candidate.name):
        object_id = logical_object(obj.name)
        part_id = identifier(obj.name)
        key = (object_id, part_id)
        require(key not in seen, f"duplicate_object_part:{object_id}:{part_id}")
        seen.add(key)
        status = interaction_status(object_id)
        obj["vrataObjectId"] = object_id
        obj["vrataPartId"] = part_id
        obj["vrataInteractionStatus"] = status
        obj["vrataBakePolicy"] = "include"
        obj["vrataAssetOrigin"] = "project-authored"
        obj["vrataAuthoringRelease"] = RELEASE_VERSION
        inventory.append({
            "nodeName": obj.name,
            "objectId": object_id,
            "partId": part_id,
            "interactionStatus": status,
            "bakePolicy": "include",
            "materials": sorted(material.name for material in obj.data.materials if material is not None),
        })
    require(len(inventory) == 193, f"historical_mesh_count_drift:{len(inventory)}")
    return inventory


def configure_cameras():
    for obj in list(bpy.context.scene.objects):
        if obj.type == "CAMERA":
            bpy.data.objects.remove(obj, do_unlink=True)
    for data in list(bpy.data.cameras):
        bpy.data.cameras.remove(data)
    for view in REVIEW_VIEWS:
        name = f"camera.review.{view['id']}"
        data = bpy.data.cameras.new(f"{name}.data")
        data.lens = 50
        data.sensor_fit = "VERTICAL"
        data.angle = math.radians(view["fovDegrees"])
        obj = bpy.data.objects.new(name, data)
        obj.location = semantic_to_blender(view["position"])
        bpy.context.collection.objects.link(obj)
        point_at(obj, view["target"])


def runtime_seats():
    authoring = (
        ("seat-01", 1, -2.65, 0.35), ("seat-02", 1, -1.55, 0.35),
        ("seat-03", 1, 1.55, 0.35), ("seat-04", 1, 2.65, 0.35),
        ("seat-05", 2, -2.9, 2.35), ("seat-06", 2, -1.8, 2.35),
        ("seat-07", 2, 1.8, 2.35), ("seat-08", 2, 2.9, 2.35),
    )
    return [{
        "id": seat_id,
        "objectId": f"chair-{seat_id}",
        "row": row,
        "position": {"x": x, "y": 0, "z": -z},
        "yaw": 0,
        "seatHeight": 0.47,
        "radius": 0.42,
        "visible": True,
        "aimTargetSurfaceId": "debug-main",
    } for seat_id, row, x, z in authoring]


def write_reality(path, inventory):
    grouped = defaultdict(list)
    statuses = {}
    for part in inventory:
        grouped[part["objectId"]].append(part)
        statuses[part["objectId"]] = part["interactionStatus"]
    reality = {
        "schemaVersion": 1,
        "sceneId": SCENE_ID,
        "releaseVersion": RELEASE_VERSION,
        "status": "review",
        "coordinateSystem": {
            "authoring": "semantic right-handed Y-up meters",
            "blender": "right-handed Z-up meters",
            "runtime": "glTF right-handed Y-up meters",
            "authoringToRuntime": "x=x,y=y,z=-z",
        },
        "changeScope": {
            "baseRelease": "0.2.0",
            "geometryChanged": False,
            "materialsChanged": True,
            "lightingChanged": True,
            "oldLightmapReused": False,
            "rebakeRequired": True,
            "reason": "Changed lighting alters baked irradiance even though mesh geometry is preserved.",
        },
        "designConstraints": {
            "existingWindowCount": 0,
            "artificialWindowOpeningAdded": False,
            "panoramaSphereAdded": False,
            "externalAssetsUsed": False,
            "brandingUsed": False,
        },
        "room": {"widthM": 10.8, "heightM": 4.4, "depthM": 11.8},
        "expectedCounts": {
            "logicalObjects": len(grouped),
            "meshParts": len(inventory),
            "materials": len(MATERIAL_RECIPES),
            "seatAnchors": 8,
            "mediaSurfaces": 1,
            "reviewViews": len(REVIEW_VIEWS),
        },
        "runtimeBindings": {
            "spawnPoints": [{
                "id": "main", "position": {"x": 0, "y": 0, "z": -4.95},
                "yaw": math.pi, "openRadiusM": 1.1,
            }],
            "seatAnchors": runtime_seats(),
            "mediaSurfaces": [{
                "surfaceId": "debug-main",
                "objectId": "presentation-screen",
                "partId": "media-debug-main",
                "purpose": "pdf-and-screen-share",
                "widthM": 5.12,
                "heightM": 2.88,
                "aspectRatio": "16:9",
                "visible": True,
                "transform": {"x": 0, "y": 2.48, "z": 5.33, "yaw": 0},
            }],
        },
        "presenterRoute": {
            "minimumWidthM": 1.45,
            "points": [
                {"x": 0, "y": 0, "z": -4.95},
                {"x": 0, "y": 0, "z": -3.6},
                {"x": 0, "y": 0, "z": 0},
                {"x": 0, "y": 0, "z": 2.8},
                {"x": -3.35, "y": 0.24, "z": 4.15},
            ],
        },
        "reviewViews": [{
            "id": view["id"],
            "authoringPosition": dict(zip(("x", "y", "z"), view["position"])),
            "authoringTarget": dict(zip(("x", "y", "z"), view["target"])),
            "fovDegrees": view["fovDegrees"],
        } for view in REVIEW_VIEWS],
        "materials": [{"name": name, **recipe} for name, recipe in MATERIAL_RECIPES.items()],
        "lighting": list(LIGHTING) + [{
            "id": f"ceiling-practical-{index:02d}",
            "position": (0.0, 4.02, z),
            "target": (0.0, 0.55, z),
            "energy": 285,
            "size": (5.25, 0.42),
            "colorSrgb": "#FFE2C5",
            "shadow": True,
        } for index, z in enumerate((-3.8, -2.25, -0.7, 0.85, 2.4, 3.95), start=1)],
        "objects": [{
            "id": object_id,
            "interactionStatus": statuses[object_id],
            "parts": grouped[object_id],
        } for object_id in sorted(grouped)],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(reality, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def configure_scene():
    scene = bpy.context.scene
    scene.name = SCENE_ID
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["vrataSceneId"] = SCENE_ID
    scene["vrataAuthoringRelease"] = RELEASE_VERSION
    scene["vrataGeometryStatus"] = "review"
    scene["vrataInteractionSemantics"] = "passive,deferred,interactive"
    scene["vrataRenderProfile"] = "baked-pbr-v1"
    scene["vrataVisualAcceptance"] = "pending-human-acceptance"
    scene["vrataRightsStatus"] = "pending-human-rights-approval"
    scene["vrataPublicationReady"] = False
    scene["vrataExternalAssetsUsed"] = False
    scene["vrataWindowCount"] = 0
    scene["vrataPanoramaSphere"] = False
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.render.filepath = "//renders/"
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = 16
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.72
    scene.view_settings.gamma = 1.0


def render_reviews(directory):
    directory.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    for view in REVIEW_VIEWS:
        scene.camera = bpy.data.objects[f"camera.review.{view['id']}"]
        scene.render.filepath = str(directory / f"{view['id']}.png")
        bpy.ops.render.render(write_still=True)


def main():
    args = arguments()
    assert_output = runpy.run_path(str(Path(__file__).resolve().parents[2] / "write_safety.py"))["assert_output"]
    output_blend = assert_output(args.output_blend)
    review_dir = assert_output(args.review_dir, scratch=True)
    reality_path = assert_output(args.reality)
    for view in REVIEW_VIEWS:
        assert_output(review_dir / f"{view['id']}.png", scratch=True)
    verify_inputs(output_blend)
    configure_materials()
    configure_lighting()
    configure_cameras()
    configure_scene()
    inventory = tag_meshes()
    write_reality(reality_path, inventory)
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.data.libraries.write(str(output_blend), {bpy.context.scene}, path_remap="RELATIVE_ALL", fake_user=True, compress=False)
    render_reviews(review_dir)
    print(json.dumps({
        "sceneId": SCENE_ID,
        "releaseVersion": RELEASE_VERSION,
        "meshParts": len(inventory),
        "materials": len(MATERIAL_RECIPES),
        "reviewViews": len(REVIEW_VIEWS),
        "outputBlendSha256": sha256(output_blend),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
