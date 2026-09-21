"""Versioned 0.4.1 derivation of the immutable salon recipe.

Reuse 0.4.0 object definitions and cleared texture inputs. Retessellate furniture
bevels and small cylinders at their physical scale; preserve all part identities,
dimensions, seat coordinates and construction evidence. No source text rewriting.
"""
import argparse
import importlib.util
import json
import runpy
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True  # Keep imports from immutable source directories read-only.

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LEGACY = HERE.parent / "0.4.0"


def safe_output(path):
    path = Path(path).absolute()
    relative = path.relative_to(ROOT)
    if relative.parts[0] != "build":
        raise RuntimeError("output_must_be_build_artifact")
    current = ROOT
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise RuntimeError("output_symlink")
    for query in (["ls-tree", "--name-only", "HEAD", "--"], ["ls-files", "--"]):
        result = subprocess.run(["git", *query, relative.as_posix()], cwd=ROOT, capture_output=True, text=True, check=True)
        if result.stdout.strip():
            raise RuntimeError("tracked_output")
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--views", default="chair-detail,diagonal-overview")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    out = safe_output(args.out)
    spec = importlib.util.spec_from_file_location("presentation_040_author", LEGACY / "author-scene.py")
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    base.safe_output = safe_output
    original_material = base.material

    def material(key, color, rough=.7, metal=0, asset=None, period=1.0, glow=0):
        # The photographed fabric contains a 3x3 plaid, not lighting seams.
        # Upholstery/acoustic absorbers use a plain woven area of that same
        # cleared source; the intentionally patterned carpet remains unchanged.
        original_material(key, color, rough, metal, asset, .28125 if key in ("fabric", "acoustic") else period, glow)
        if key not in ("fabric", "acoustic"):
            return
        mat = base.M[key]
        for node in mat.node_tree.nodes:
            if node.type != "TEX_IMAGE":
                continue
            original = node.image
            values = np.array(original.pixels[:], dtype=np.float32).reshape((original.size[1], original.size[0], 4))
            patch = values[32:320, 32:320].copy()
            right = patch[:, ::-1].copy()
            normal = "nor_gl" in original.name
            if normal:
                right[:, :, 0] = 1-right[:, :, 0]
            top = np.concatenate((patch, right), axis=1)
            bottom = top[::-1].copy()
            if normal:
                bottom[:, :, 1] = 1-bottom[:, :, 1]
            pixels = np.concatenate((top, bottom), axis=0)
            name = f"plain-weave-{key}-{node.name.replace(' ', '-')}"
            image = bpy.data.images.new(name, width=576, height=576, alpha=False)
            image.colorspace_settings.name = original.colorspace_settings.name
            image.pixels.foreach_set(pixels.ravel())
            image.filepath_raw, image.file_format = str(safe_output(base.OUTPUT / f"{name}.png")), "PNG"
            image.save()
            image.pack()
            node.image = image
        mat["fabricDerivation"] = "fabric_pattern_05 pixel crop [32:320,32:320], mirrored 2x2 with normal XY sign correction; 0.28125m period"

    base.material = material

    def box(name, size, pos, mat, bevel=.003, rotation=(0, 0, 0), soft=False):
        if name == "room-shell.floor":
            size = (9.76, 8.36, .14)
        elif name == "room-shell.rear-left":
            size, pos = (3.93, .18, 3.6), (-2.915, 4.09, 1.8)
        elif name == "room-shell.rear-right":
            size, pos = (3.93, .18, 3.6), (2.915, 4.09, 1.8)
        bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
        obj = bpy.context.object
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if name.startswith("room-shell."):
            # Continuous plaster junctions are not individually rounded boards.
            bevel = 0
        if bevel:
            mod = obj.modifiers.new("manufactured-edge", "BEVEL")
            mod.width = min(bevel, min(size)*.45)
            mod.segments = 6 if soft else 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
        upholstery = soft and mat == "fabric"
        if upholstery:
            mod = obj.modifiers.new("continuous-cushion-surface", "SUBSURF")
            mod.levels = mod.render_levels = 1
            bpy.ops.object.modifier_apply(modifier=mod.name)
            obj.dimensions = size
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            # Mark the actual post-modifier rear-panel boundary. Marking the
            # original cube edges before bevel/subdivision loses the chart cut.
            obj.data.update()
            adjacent = {}
            for poly in obj.data.polygons:
                back = poly.normal.y < -.999
                for edge in poly.edge_keys:
                    adjacent.setdefault(tuple(sorted(edge)), []).append(back)
            for edge in obj.data.edges:
                sides = adjacent[tuple(sorted(edge.vertices))]
                edge.use_seam = len(sides) == 2 and sides[0] != sides[1]
            assert any(edge.use_seam for edge in obj.data.edges), "upholstery_rear_seam_missing"
        obj.rotation_euler = rotation
        base.finish(name, obj, mat, soft)
        if soft and not upholstery:
            mod = obj.modifiers.new("weighted-normals", "WEIGHTED_NORMAL")
            mod.keep_sharp = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
        return obj

    base.box = box
    original_rod = base.rod

    def rod(name, start, end, radius, mat, vertices=24):
        # 12 mm furniture tubes: 16 sides with smooth shading; 2 mm suspension
        # retains its explicitly requested 12. Dimensions and contacts unchanged.
        return original_rod(name, start, end, radius, mat, min(vertices, 16) if radius <= .03 else vertices)

    base.rod = rod
    argv = sys.argv
    try:
        sys.argv = [*argv[:argv.index("--")+1], "--out", str(out), "--views", ""]
        base.main()
    finally:
        sys.argv = argv
    scene = bpy.context.scene
    # The room shell consists of closed intersecting solids: hidden opposing
    # end faces at plaster joints must not render through the inside surface.
    bpy.data.materials["material.plaster"].use_backface_culling = True
    # Apply the same source material correction as Personal; never a runtime
    # wildcard color override. Keep the original photographed grain structure.
    mat = bpy.data.materials["material.wood"]
    shader = mat.node_tree.nodes.get("Principled BSDF")
    for socket_name, name in (("Base Color", "matte-walnut-diff"), ("Roughness", "matte-walnut-rough")):
        node = shader.inputs[socket_name].links[0].from_node
        original = node.image
        pixels = np.array(original.pixels[:], dtype=np.float32).reshape((-1, 4))
        if socket_name == "Base Color":
            pixels[:, :3] = np.clip(pixels[:, :3]*1.4 + np.array([.20, .17, .12]), 0, 1)
        else:
            pixels[:, :3] = .70 + .18*pixels[:, :3]
        image = bpy.data.images.new(name, width=original.size[0], height=original.size[1], alpha=False)
        image.colorspace_settings.name = "sRGB" if socket_name == "Base Color" else "Non-Color"
        image.pixels.foreach_set(pixels.ravel())
        image.filepath_raw, image.file_format = str(safe_output(out / f"{name}.png")), "PNG"
        image.save()
        image.pack()
        node.image = image
    mat["finishDerivation"] = "0.4.1 lighter matte walnut; photographed grain retained; roughness 0.70+0.18*source"
    scene["releaseVersion"] = scene["vrataAuthoringRelease"] = "0.4.1"
    if "qualityOutcome" in scene:
        del scene["qualityOutcome"]
    scene["authoringStage"] = "generated-source"
    for obj in bpy.data.objects:
        if "vrataAuthoringRelease" in obj:
            obj["vrataAuthoringRelease"] = "0.4.1"
    registry = json.loads((out / "object-registry.json").read_text())
    registry["releaseVersion"] = "0.4.1"
    registry.pop("qualityOutcome", None)
    registry["authoringStage"] = "generated-source"
    (out / "object-registry.json").write_text(json.dumps(registry, indent=2)+"\n")
    for image in bpy.data.images:
        if image.source == "FILE" and image.packed_file:
            image.filepath = f"//textures/{Path(image.filepath).name}"
    scene.render.filepath = "//review/"
    runpy.run_path(str(HERE / "portable-source.py"))["sanitize_paths"]()
    bpy.ops.wm.save_as_mainfile(filepath=str(safe_output(out / "draft-scene.blend")), check_existing=False)
    for key in filter(None, args.views.split(",")):
        scene.camera = bpy.data.objects[f"camera.{key}"]
        scene.render.filepath = str(safe_output(out / f"{key}.png"))
        bpy.ops.render.render(write_still=True)
    meshes = [o.data for o in bpy.data.collections["Runtime"].objects if o.type == "MESH"]
    for mesh in meshes:
        mesh.calc_loop_triangles()
    print(json.dumps({"version": "0.4.1", "triangles": sum(len(m.loop_triangles) for m in meshes),
                      "meshes": len(meshes), "authoringStage": "generated-source"}), flush=True)


if __name__ == "__main__":
    main()
