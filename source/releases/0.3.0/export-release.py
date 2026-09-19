"""Bake and export the Presentation Room 0.3.0 review release with baked-pbr-v1 semantics."""

import argparse
from collections import Counter
import hashlib
import json
import runpy
from pathlib import Path
import struct
import sys

import bpy
import numpy as np


SCENE_ID = "presentation-room-v1"
RELEASE_VERSION = "0.3.0"
BLENDER_VERSION = (4, 5, 12)
BLENDER_BUILD_HASH = "84afd5f785f7"
BLENDER_BINARY_SHA256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
LIGHTMAP_UV = "VRATA_LIGHTMAP_UV"
LIGHTMAP_NODE = "VRATA_LIGHTMAP_BAKE"
LIGHTMAP_UV_NODE = f"{LIGHTMAP_NODE}_UV"
REQUIRED_TAGS = ("vrataObjectId", "vrataPartId", "vrataInteractionStatus", "vrataBakePolicy", "vrataAssetOrigin", "vrataAuthoringRelease")


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--lightmap", required=True)
    parser.add_argument("--reality", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--bake", action="store_true")
    parser.add_argument("--size", type=int, default=2048)
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--scale", type=float, default=0.25)
    parser.add_argument("--lightmap-intensity", type=float, default=5.2)
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


def verify_portable_source():
    require(len(bpy.data.libraries) == 0, "external_blend_library_forbidden")
    unpacked = list(bpy.utils.blend_paths(absolute=False, packed=False, local=True))
    require(not unpacked, f"unpacked_external_paths_forbidden:{unpacked}")
    stored = list(bpy.utils.blend_paths(absolute=False, packed=True, local=True))
    require(all(path.startswith("//") and "://" not in path for path in stored), f"nonportable_stored_path:{stored}")
    for image in bpy.data.images:
        if image.source == "FILE":
            require(image.packed_file is not None, f"unpacked_file_image_forbidden:{image.name}")


def verify_toolchain_and_source(args):
    require(tuple(bpy.app.version[:3]) == BLENDER_VERSION, "blender_version_mismatch")
    require(decoded_build_hash() == BLENDER_BUILD_HASH, "blender_build_hash_mismatch")
    require(sha256(Path(bpy.app.binary_path).resolve()) == BLENDER_BINARY_SHA256, "blender_binary_digest_mismatch")
    source = Path(bpy.data.filepath).resolve()
    require(source.name == "accepted-scene.blend" and source.parent.name == RELEASE_VERSION, "versioned_source_required")
    require(sha256(source) == args.source_sha256, "accepted_source_digest_mismatch")
    require(bpy.context.scene.get("vrataSceneId") == SCENE_ID, "scene_id_mismatch")
    require(bpy.context.scene.get("vrataAuthoringRelease") == RELEASE_VERSION, "authoring_release_mismatch")
    verify_portable_source()


def configure_cuda():
    cycles = bpy.context.preferences.addons.get("cycles")
    require(cycles is not None, "cycles_addon_missing")
    preferences = cycles.preferences
    preferences.compute_device_type = "CUDA"
    preferences.get_devices()
    devices = [device for device in preferences.devices if device.type == "CUDA"]
    require(devices, "usable_cuda_device_missing")
    for device in preferences.devices:
        device.use = device.type == "CUDA"
    bpy.context.scene.cycles.device = "GPU"
    return sorted(device.name for device in devices if device.use)


def visible_meshes():
    return sorted((obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_render), key=lambda obj: obj.name)


def principled(material):
    return next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)


def load_contract(path):
    contract = json.loads(path.read_text(encoding="utf-8"))
    require(contract["sceneId"] == SCENE_ID and contract["releaseVersion"] == RELEASE_VERSION, "reality_identity_mismatch")
    inventory = {
        part["nodeName"]: part
        for obj in contract["objects"]
        for part in obj["parts"]
    }
    require(len(inventory) == contract["expectedCounts"]["meshParts"], "reality_inventory_count_mismatch")
    return contract, inventory


def validate_meshes(objects, inventory):
    require({obj.name for obj in objects} == set(inventory), "accepted_source_mesh_inventory_mismatch")
    statuses = Counter()
    for obj in objects:
        expected = inventory[obj.name]
        for key in REQUIRED_TAGS:
            require(key in obj, f"missing_mesh_tag:{obj.name}:{key}")
        require(obj["vrataObjectId"] == expected["objectId"], f"mesh_object_id_mismatch:{obj.name}")
        require(obj["vrataPartId"] == expected["partId"], f"mesh_part_id_mismatch:{obj.name}")
        require(obj["vrataInteractionStatus"] == expected["interactionStatus"], f"mesh_status_mismatch:{obj.name}")
        require(obj["vrataBakePolicy"] == "include", f"mesh_bake_policy_mismatch:{obj.name}")
        require(obj["vrataAssetOrigin"] == "project-authored", f"mesh_origin_mismatch:{obj.name}")
        require(obj["vrataAuthoringRelease"] == RELEASE_VERSION, f"mesh_release_mismatch:{obj.name}")
        require(sorted(material.name for material in obj.data.materials if material is not None) == expected["materials"], f"mesh_material_mismatch:{obj.name}")
        statuses[expected["interactionStatus"]] += 1
    require(set(statuses) == {"passive", "deferred", "interactive"}, "interaction_status_coverage_missing")
    return statuses


def unwrap_lightmap(objects):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        layers = obj.data.uv_layers
        existing = layers.get(LIGHTMAP_UV)
        if existing is not None:
            layers.remove(existing)
        while len(layers) > 1:
            layers.remove(layers[-1])
        layer = layers.new(name=LIGHTMAP_UV)
        layers.active = layer
        require(layers.find(LIGHTMAP_UV) == 1, f"lightmap_not_uv1:{obj.name}")
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=1.15192,
        margin_method="SCALED",
        rotate_method="AXIS_ALIGNED_Y",
        island_margin=0.006,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def materials_for(objects):
    return sorted({material for obj in objects for material in obj.data.materials if material is not None}, key=lambda material: material.name)


def restore_original_emission(material):
    if material.get("vrataLightMap") is not True:
        return
    shader = principled(material)
    if shader is None:
        return
    color = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    strength = shader.inputs.get("Emission Strength")
    original = material.get("vrataOriginalEmissive", [0.0, 0.0, 0.0])
    if color is not None:
        color.default_value = (*original[:3], 1.0)
    if strength is not None:
        strength.default_value = float(material.get("vrataOriginalEmissiveIntensity", 0.0))


def prepare_materials(materials, image):
    for material in materials:
        restore_original_emission(material)
        nodes = material.node_tree.nodes
        for node_name in (LIGHTMAP_NODE, LIGHTMAP_UV_NODE):
            old = nodes.get(node_name)
            if old is not None:
                nodes.remove(old)
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = LIGHTMAP_NODE
        texture.label = "Vrata baked irradiance"
        texture.image = image
        texture.interpolation = "Linear"
        texture.extension = "EXTEND"
        uv = nodes.new("ShaderNodeUVMap")
        uv.name = LIGHTMAP_UV_NODE
        uv.uv_map = LIGHTMAP_UV
        material.node_tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
        for node in nodes:
            node.select = False
        texture.select = True
        nodes.active = texture


def bake(scene, objects, image, samples):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 1
    scene.cycles.transmission_bounces = 0
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=8, use_clear=True)
    image.update()


def scale_image(image, factor):
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgba = pixels.reshape((-1, 4))
    rgb = rgba[:, :3]
    stats = {
        "linearMaxBeforeScale": float(np.max(rgb)),
        "linearMeanBeforeScale": float(np.mean(np.maximum(rgb, 0.0))),
    }
    np.clip(rgb * factor, 0.0, 1.0, out=rgb)
    rgba[:, 3] = 1.0
    image.pixels.foreach_set(pixels)
    image.update()
    return stats


def wire_lightmap(materials, image, intensity):
    for material in materials:
        shader = principled(material)
        require(shader is not None, f"principled_shader_missing:{material.name}")
        color = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        strength = shader.inputs.get("Emission Strength")
        require(color is not None and strength is not None, f"emission_inputs_missing:{material.name}")
        original_color = list(color.default_value[:3])
        original_strength = float(strength.default_value)
        texture = material.node_tree.nodes.get(LIGHTMAP_NODE)
        material.node_tree.links.new(texture.outputs["Color"], color)
        strength.default_value = 1.0
        material["vrataRenderProfile"] = "baked-pbr-v1"
        material["vrataLightMap"] = True
        material["vrataLightMapIntensity"] = intensity
        material["vrataOriginalEmissive"] = original_color
        material["vrataOriginalEmissiveIntensity"] = original_strength
    image.pack()


def export_glb(path):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_visible=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_extras=True,
        export_animations=False,
    )


def glb_document(path):
    with path.open("rb") as stream:
        header = stream.read(12)
        require(len(header) == 12, "glb_header_missing")
        magic, version, total_length = struct.unpack("<4sII", header)
        require(magic == b"glTF" and version == 2 and total_length == path.stat().st_size, "invalid_glb_header")
        chunk_length, chunk_type = struct.unpack("<II", stream.read(8))
        require(chunk_type == 0x4E4F534A, "glb_json_chunk_missing")
        return json.loads(stream.read(chunk_length).decode("utf-8").rstrip(" \t\r\n\x00"))


def validate_glb(path, inventory, material_count, lightmap_intensity):
    document = glb_document(path)
    require(not document.get("cameras") and not document.get("animations"), "camera_or_animation_exported")
    require("KHR_lights_punctual" not in document.get("extensionsUsed", []), "light_exported")
    mesh_nodes = [node for node in document.get("nodes", []) if "mesh" in node]
    require({node.get("name") for node in mesh_nodes} == set(inventory), "glb_mesh_inventory_mismatch")
    for node in mesh_nodes:
        expected = inventory[node["name"]]
        extras = node.get("extras", {})
        for key in REQUIRED_TAGS:
            require(key in extras, f"glb_tag_missing:{node['name']}:{key}")
        require(extras["vrataObjectId"] == expected["objectId"], f"glb_object_id_mismatch:{node['name']}")
        require(extras["vrataPartId"] == expected["partId"], f"glb_part_id_mismatch:{node['name']}")
        mesh = document["meshes"][node["mesh"]]
        require(all("TEXCOORD_1" in primitive.get("attributes", {}) for primitive in mesh["primitives"]), f"glb_lightmap_uv_missing:{node['name']}")
    materials = document.get("materials", [])
    require(len(materials) == material_count, "glb_material_count_mismatch")
    require(all(
        material.get("extras", {}).get("vrataRenderProfile") == "baked-pbr-v1"
        and material.get("extras", {}).get("vrataLightMap") is True
        and material.get("extras", {}).get("vrataLightMapIntensity") == lightmap_intensity
        and material.get("emissiveTexture", {}).get("texCoord") == 1
        for material in materials
    ), "glb_baked_pbr_material_semantics_mismatch")
    scene = document["scenes"][document.get("scene", 0)]
    require(scene.get("extras", {}).get("vrataWindowCount") == 0, "glb_window_count_mismatch")
    require(scene.get("extras", {}).get("vrataPanoramaSphere") is False, "glb_panorama_constraint_mismatch")
    return document


def main():
    args = arguments()
    assert_output = runpy.run_path(str(Path(__file__).resolve().parents[2] / "write_safety.py"))["assert_output"]
    output = assert_output(args.output, scratch=True)
    lightmap_path = Path(args.lightmap).resolve()
    if args.bake:
        lightmap_path = assert_output(args.lightmap)
    reality_path = Path(args.reality).resolve()
    require(output.suffix == ".glb" and lightmap_path.suffix == ".png", "invalid_output_extension")
    verify_toolchain_and_source(args)
    contract, inventory = load_contract(reality_path)
    objects = visible_meshes()
    statuses = validate_meshes(objects, inventory)
    materials = materials_for(objects)
    require(len(materials) == contract["expectedCounts"]["materials"], "accepted_source_material_count_mismatch")
    unwrap_lightmap(objects)
    cuda_devices = configure_cuda() if args.bake else []
    if args.bake:
        old = bpy.data.images.get("vrata.lightmap.atlas")
        if old is not None:
            bpy.data.images.remove(old)
        image = bpy.data.images.new("vrata.lightmap.atlas", width=args.size, height=args.size, alpha=False, float_buffer=True)
    else:
        require(lightmap_path.is_file(), "accepted_lightmap_missing")
        image = bpy.data.images.load(str(lightmap_path), check_existing=False)
    image.colorspace_settings.name = "sRGB"
    require(tuple(image.size) == (args.size, args.size), "lightmap_size_mismatch")
    prepare_materials(materials, image)
    if args.bake:
        bake(bpy.context.scene, objects, image, args.samples)
        stats = scale_image(image, args.scale)
        lightmap_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.scene.render.image_settings.file_format = "PNG"
        bpy.context.scene.render.image_settings.color_mode = "RGB"
        bpy.context.scene.render.image_settings.color_depth = "16"
        image.filepath_raw = str(lightmap_path)
        image.file_format = "PNG"
        image.save()
    else:
        stats = {"linearMaxBeforeScale": None, "linearMeanBeforeScale": None}
    wire_lightmap(materials, image, args.lightmap_intensity)
    scene = bpy.context.scene
    scene["vrataLightMapTextureSlot"] = "emissiveTexture"
    scene["vrataLightMapTexCoord"] = 1
    output.parent.mkdir(parents=True, exist_ok=True)
    export_glb(output)
    document = validate_glb(output, inventory, len(materials), args.lightmap_intensity)
    print(json.dumps({
        "sceneId": SCENE_ID,
        "releaseVersion": RELEASE_VERSION,
        "baked": args.bake,
        "cudaDevices": cuda_devices,
        "meshParts": len(objects),
        "materials": len(materials),
        "textures": len(document.get("textures", [])),
        "interactionMeshStatuses": dict(sorted(statuses.items())),
        "glbSha256": sha256(output),
        "lightmapSha256": sha256(lightmap_path),
        "size": args.size,
        "samples": args.samples,
        "scale": args.scale,
        "lightMapIntensity": args.lightmap_intensity,
        **stats,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
