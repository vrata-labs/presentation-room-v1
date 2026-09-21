"""Bake/export the revised salon, preserving custom normals and part evidence."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import runpy
import sys

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
safe_output = runpy.run_path(str(HERE / "author-scene.py"))["safe_output"]
UV = "VRATA_LIGHTMAP_UV"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--atlas", required=True)
    parser.add_argument("--bake", action="store_true")
    parser.add_argument("--prepare-uv-only", action="store_true")
    parser.add_argument("--save-source")
    parser.add_argument("--size", type=int, default=4096)
    parser.add_argument("--samples", type=int, default=96)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    output = safe_output(args.out)
    atlas = safe_output(args.atlas) if args.bake else Path(args.atlas).resolve()
    assert bpy.app.version[:3] == (4, 5, 12)
    scene = bpy.context.scene
    assert scene["releaseVersion"] == "0.4.1"
    assert not bpy.data.libraries
    if args.bake:
        enclosure = runpy.run_path(str(HERE / "enclosure.py"))["prepare_enclosure"]()
        safe_output(atlas.with_suffix(".enclosure.json")).write_text(json.dumps(enclosure, indent=2)+"\n")
    objects = sorted((o for o in bpy.data.collections["Runtime"].objects if o.type == "MESH" and not o.hide_render), key=lambda o: o.name)
    baked = [o for o in objects if o.get("vrataBakePolicy") == "include"]
    materials = sorted({m for o in baked for m in o.data.materials}, key=lambda m: m.name)
    if args.bake:
        scene.tool_settings.use_uv_select_sync = True
        bpy.ops.object.select_all(action="DESELECT")
        for obj in baked:
            if UV in obj.data.uv_layers:
                obj.data.uv_layers.remove(obj.data.uv_layers[UV])
            obj.data.uv_layers.new(name=UV)
            obj.data.uv_layers.active = obj.data.uv_layers[UV]
            obj.select_set(True)
        bpy.context.view_layer.objects.active = baked[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15192, margin_method="SCALED", rotate_method="AXIS_ALIGNED_Y",
                                 island_margin=.004, area_weight=0, correct_aspect=True, scale_to_bounds=True)
        bpy.ops.object.mode_set(mode="OBJECT")
        upholstery = [o for o in baked if o.name.endswith(".upholstery")]
        bpy.ops.object.select_all(action="DESELECT")
        for obj in upholstery:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = upholstery[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=.004)
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        for obj in baked:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = baked[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(rotate=True, margin=.004, merge_overlap=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        uv_report = runpy.run_path(str(HERE / "atlas-quality.py"))["measure_atlas"]()
        safe_output(atlas.with_suffix(".uv.json")).write_text(json.dumps(uv_report, indent=2)+"\n")
        assert uv_report["overlappingCentroids"] == 0, "overlapping_lightmap_charts"
        if args.prepare_uv_only:
            assert args.save_source, "uv_probe_requires_saved_source"
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(safe_output(args.save_source)), check_existing=False)
            return
        image = bpy.data.images.new("lightmap-0.4.1", width=args.size, height=args.size, alpha=False, float_buffer=True)
    else:
        assert all(o.data.uv_layers.find(UV) == 1 for o in baked)
        image = bpy.data.images.load(str(atlas), check_existing=False)
    image.colorspace_settings.name = "sRGB"
    for mat in materials:
        nodes = mat.node_tree.nodes
        for name in ("VRATA_LIGHTMAP_BAKE", "VRATA_LIGHTMAP_BAKE_UV"):
            if name in nodes:
                nodes.remove(nodes[name])
        uv = nodes.new("ShaderNodeUVMap")
        uv.name, uv.uv_map = "VRATA_LIGHTMAP_BAKE_UV", UV
        tex = nodes.new("ShaderNodeTexImage")
        tex.name, tex.image, tex.extension = "VRATA_LIGHTMAP_BAKE", image, "EXTEND"
        mat.node_tree.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        for node in nodes:
            node.select = False
        tex.select, nodes.active = True, tex
    if args.bake:
        pref = bpy.context.preferences.addons["cycles"].preferences
        pref.compute_device_type = "CUDA"
        pref.get_devices()
        assert any(d.type == "CUDA" for d in pref.devices)
        for device in pref.devices:
            device.use = device.type == "CUDA"
        scene.cycles.device, scene.cycles.samples = "GPU", args.samples
        scene.cycles.use_adaptive_sampling = False
        scene.render.bake.use_pass_color = False
        bpy.ops.object.select_all(action="DESELECT")
        copies = []
        for obj in baked:
            copy = obj.copy()
            copy.data = obj.data.copy()
            bpy.context.scene.collection.objects.link(copy)
            copy.select_set(True)
            copies.append(copy)
            obj.hide_render = True
        bpy.context.view_layer.objects.active = copies[0]
        bpy.ops.object.join()
        target = bpy.context.object
        try:
            bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=16, use_clear=True)
        finally:
            for obj in baked:
                obj.hide_render = False
            bpy.data.objects.remove(target, do_unlink=True)
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape((-1, 4))
        lit = rgba[:, :3][np.max(rgba[:, :3], axis=1) > 1e-6]
        p999 = float(np.percentile(lit, 99.9))
        scale = min(.25, .98 / max(p999, 1e-6))
        scene["bakedAtlasScale"] = scale
        stats = {"linearMaximum": float(lit.max()), "linearP999": p999, "encodingScale": scale,
                 "clippedChannelFraction": float(np.mean(lit*scale > 1))}
        safe_output(atlas.with_suffix(".stats.json")).write_text(json.dumps(stats, indent=2)+"\n")
        np.clip(rgba[:, :3]*scale, 0, 1, out=rgba[:, :3])
        rgba[:, 3] = 1
        image.pixels.foreach_set(pixels)
        image.filepath_raw, image.file_format = str(atlas), "PNG"
        image.save()
    image.pack()
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
        elif img.source == "FILE":
            assert img.packed_file or img.packed_files, f"unpacked:{img.name}"
            img.filepath = f"//textures/{Path(img.filepath).name}"
    if args.save_source:
        runpy.run_path(str(HERE / "portable-source.py"))["sanitize_paths"]()
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(safe_output(args.save_source)), check_existing=False)
    for texture in bpy.data.images:
        if texture.users and texture != image and max(texture.size) > 512:
            texture.scale(512, 512)
            texture.pack()
    for mat in materials:
        shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        mat["vrataLightMap"] = True
        mat["vrataLightMapIntensity"] = math.pi / float(scene["bakedAtlasScale"])
        mat["vrataRenderProfile"] = "baked-pbr-v1"
        mat["vrataLightMapIncludesEnvironment"] = True
        mat["vrataLightMapEncoding"] = "cycles-diffuse-radiance-srgb8"
        mat["vrataOriginalEmissive"] = list(shader.inputs["Emission Color"].default_value[:3])
        mat["vrataOriginalEmissiveIntensity"] = float(shader.inputs["Emission Strength"].default_value)
        mat.node_tree.links.new(mat.node_tree.nodes["VRATA_LIGHTMAP_BAKE"].outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = 1
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
                              export_cameras=False, export_lights=False, export_yup=True, export_extras=True, export_animations=False)
    print(json.dumps({"glbBytes": output.stat().st_size, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                      "sourceParts": len(objects)}), flush=True)


if __name__ == "__main__":
    main()
