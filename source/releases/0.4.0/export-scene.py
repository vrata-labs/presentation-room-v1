"""Bake/export the 0.4.0 source using the platform baked-pbr-v1 contract."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import runpy
import subprocess
import sys

import bmesh
import bpy
import numpy as np

HERE=Path(__file__).resolve().parent
safe_output=runpy.run_path(str(HERE/"author-scene.py"))["safe_output"]
UV="VRATA_LIGHTMAP_UV"
REQUIRED_MESH_TAGS=(
    "vrataObjectId",
    "vrataPartId",
    "vrataInteractionStatus",
    "vrataBakePolicy",
    "vrataCollisionPolicy",
    "vrataSupportPolicy",
    "vrataNavigableBoundsPolicy",
    "vrataAssetOrigin",
    "vrataAuthoringRelease",
)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--out",required=True)
    parser.add_argument("--atlas",required=True)
    parser.add_argument("--bake",action="store_true")
    parser.add_argument("--save-source")
    parser.add_argument("--size",type=int,default=2048)
    parser.add_argument("--samples",type=int,default=96)
    parser.add_argument("--intensity",type=float)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    output=safe_output(args.out)
    atlas=safe_output(args.atlas) if args.bake else Path(args.atlas).resolve()
    saved=safe_output(args.save_source) if args.save_source else None
    assert bpy.app.version[:3]==(4,5,12)
    assert bpy.context.scene.get("releaseVersion")=="0.4.0"
    assert not bpy.data.libraries
    meshes=sorted(bpy.data.collections["Runtime"].objects,key=lambda o:o.name)
    meshes=[o for o in meshes if o.type=="MESH" and not o.hide_render]
    for obj in meshes:
        missing=[tag for tag in REQUIRED_MESH_TAGS if tag not in obj]
        assert not missing,f"mesh_tags_missing:{obj.name}:{','.join(missing)}"
        assert obj.get("vrataAssetOrigin")=="project-authored",f"mesh_origin_mismatch:{obj.name}"
        assert obj.get("vrataAuthoringRelease")=="0.4.0",f"mesh_release_mismatch:{obj.name}"
    pairs=[(obj["vrataObjectId"],obj["vrataPartId"]) for obj in meshes]
    assert len(pairs)==len(set(pairs)),"duplicate_object_part_pair"
    baked=[o for o in meshes if o.get("vrataBakePolicy")=="include"]
    materials=sorted({m for o in baked for m in o.data.materials},key=lambda m:m.name)
    for obj in meshes:
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8)
        bm.to_mesh(obj.data);bm.free();obj.data.update()
    if args.bake:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in baked:
            if UV in obj.data.uv_layers:obj.data.uv_layers.remove(obj.data.uv_layers[UV])
            obj.data.uv_layers.new(name=UV);obj.data.uv_layers.active=obj.data.uv_layers[UV];obj.select_set(True)
        bpy.context.view_layer.objects.active=baked[0]
        bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15192,margin_method="SCALED",rotate_method="AXIS_ALIGNED_Y",island_margin=.004,area_weight=0,correct_aspect=True,scale_to_bounds=True)
        bpy.ops.object.mode_set(mode="OBJECT")
        image=bpy.data.images.new("vrata.lightmap.0.4.0",width=args.size,height=args.size,alpha=False,float_buffer=True)
    else:
        assert all(obj.data.uv_layers.find(UV)==1 for obj in baked),"accepted_lightmap_uv_missing"
        image=bpy.data.images.load(str(atlas),check_existing=False)
    image.colorspace_settings.name="sRGB"
    for mat in materials:
        nodes=mat.node_tree.nodes
        for name in ("VRATA_LIGHTMAP_BAKE","VRATA_LIGHTMAP_BAKE_UV"):
            if name in nodes:nodes.remove(nodes[name])
        uv=nodes.new("ShaderNodeUVMap");uv.name="VRATA_LIGHTMAP_BAKE_UV";uv.uv_map=UV
        tex=nodes.new("ShaderNodeTexImage");tex.name="VRATA_LIGHTMAP_BAKE";tex.image=image;tex.extension="EXTEND"
        mat.node_tree.links.new(uv.outputs["UV"],tex.inputs["Vector"])
        for node in nodes:node.select=False
        tex.select=True;nodes.active=tex
    if args.bake:
        pref=bpy.context.preferences.addons["cycles"].preferences;pref.compute_device_type="CUDA";pref.get_devices()
        assert any(d.type=="CUDA" for d in pref.devices)
        for device in pref.devices:device.use=device.type=="CUDA"
        scene=bpy.context.scene;scene.render.engine="CYCLES";scene.cycles.device="GPU"
        scene.cycles.samples=args.samples;scene.cycles.use_adaptive_sampling=False;scene.cycles.max_bounces=6;scene.cycles.diffuse_bounces=4
        scene.render.bake.use_pass_color=False;scene.render.bake.use_pass_direct=True;scene.render.bake.use_pass_indirect=True
        bpy.ops.object.select_all(action="DESELECT")
        copies=[]
        for obj in baked:
            copy=obj.copy();copy.data=obj.data.copy();copy.hide_render=False
            bpy.context.scene.collection.objects.link(copy);copy.select_set(True);copies.append(copy)
            obj.hide_render=True
        bpy.context.view_layer.objects.active=copies[0]
        bpy.ops.object.join()
        target=bpy.context.object
        target.name="__irradiance-bake"
        try:
            bpy.context.view_layer.update()
            bpy.ops.object.bake(type="DIFFUSE",pass_filter={"DIRECT","INDIRECT"},margin=8,use_clear=True)
        finally:
            for obj in baked:obj.hide_render=False
            bpy.data.objects.remove(target,do_unlink=True)
            for mesh in list(bpy.data.meshes):
                if mesh.users==0:bpy.data.meshes.remove(mesh)
        pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels);rgba=pixels.reshape((-1,4))
        lit=rgba[:,:3][np.max(rgba[:,:3],axis=1)>1e-6]
        percentile=float(np.percentile(lit,99.9))
        scale=min(.25,.98/max(percentile,1e-6))
        stats={"linearMaximum":float(np.max(lit)),"linearP999":percentile,"encodingScale":scale,"clippedChannelFraction":float(np.mean(lit*scale>1))}
        bpy.context.scene["bakedAtlasScale"]=scale
        atlas.parent.mkdir(parents=True,exist_ok=True)
        stats_path=safe_output(atlas.with_suffix(".stats.json"));stats_path.write_text(json.dumps(stats,indent=2)+"\n")
        np.clip(rgba[:,:3]*scale,0,1,out=rgba[:,:3]);rgba[:,3]=1;image.pixels.foreach_set(pixels);image.update()
        atlas.parent.mkdir(parents=True,exist_ok=True);image.filepath_raw=str(atlas);image.file_format="PNG";image.save()
        subprocess.run(["convert",str(atlas),"-depth","8","-strip",str(atlas)],check=True)
        # Export/readback uses the same 8-bit image as future reproducibility runs.
        reopened=bpy.data.images.load(str(atlas),check_existing=False);reopened.colorspace_settings.name="sRGB"
        for mat in materials:mat.node_tree.nodes["VRATA_LIGHTMAP_BAKE"].image=reopened
        image=reopened
    image.pack()
    for img in list(bpy.data.images):
        if img.users==0:
            bpy.data.images.remove(img)
            continue
        if img.source=="FILE":
            assert img.packed_file or img.packed_files, f"unpacked:{img.name}"
            img.filepath=f"//textures/{Path(img.filepath).name}"
    if saved:
        saved.parent.mkdir(parents=True,exist_ok=True)
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(saved),check_existing=False)
    # Keep accepted bake/source inputs intact; resize only shipping PBR derivatives.
    for texture in bpy.data.images:
        if texture.users and texture != image and max(texture.size) > 512:
            texture.scale(512,512)
            texture.pack()
    for mat in materials:
        shader=next(n for n in mat.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
        color=shader.inputs["Emission Color"];strength=shader.inputs["Emission Strength"]
        mat["vrataLightMap"]=True;mat["vrataLightMapIntensity"]=args.intensity if args.intensity is not None else math.pi/float(bpy.context.scene.get("bakedAtlasScale",.25))
        mat["vrataRenderProfile"]="baked-pbr-v1"
        mat["vrataLightMapIncludesEnvironment"]=True
        mat["vrataLightMapEncoding"]="cycles-diffuse-radiance-srgb8"
        mat["vrataOriginalEmissive"]=list(color.default_value[:3]);mat["vrataOriginalEmissiveIntensity"]=float(strength.default_value)
        mat.node_tree.links.new(mat.node_tree.nodes["VRATA_LIGHTMAP_BAKE"].outputs["Color"],color);strength.default_value=1
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:obj.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    output.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output),export_format="GLB",use_selection=True,export_apply=True,export_texcoords=True,export_normals=True,export_tangents=False,export_materials="EXPORT",export_cameras=False,export_lights=False,export_yup=True,export_extras=True,export_animations=False)
    print(json.dumps({"glbBytes":output.stat().st_size,"glbSha256":hashlib.sha256(output.read_bytes()).hexdigest(),"meshParts":len(meshes),"lightMappedMaterials":len(materials),"qualityOutcome":"REWORK_REQUIRED"}))


if __name__=="__main__":main()
