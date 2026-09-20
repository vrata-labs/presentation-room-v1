"""Denoise baked irradiance, preserving linear-to-sRGB transfer (no AgX bake-in)."""
import argparse
from pathlib import Path
import runpy
import subprocess
import sys
import bpy

HERE=Path(__file__).resolve().parent
safe_output=runpy.run_path(str(HERE/"author-scene.py"))["safe_output"]
parser=argparse.ArgumentParser();parser.add_argument("--input",required=True);parser.add_argument("--out",required=True)
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
output=safe_output(args.out);temporary=safe_output(output.with_name(output.stem+"-0001.png"))
assert Path(args.input).resolve()!=output
image=bpy.data.images.load(str(Path(args.input).resolve()),check_existing=False);image.colorspace_settings.name="sRGB"
scene=bpy.context.scene;scene.render.engine="CYCLES";scene.cycles.samples=1;scene.cycles.device="CPU"
scene.render.resolution_x=16;scene.render.resolution_y=16;scene.render.resolution_percentage=100
scene.view_settings.view_transform="Standard";scene.view_settings.look="None";scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.use_nodes=True;nodes=scene.node_tree.nodes;nodes.clear()
source=nodes.new("CompositorNodeImage");source.image=image
denoise=nodes.new("CompositorNodeDenoise");denoise.use_hdr=True;denoise.prefilter="ACCURATE"
scene.node_tree.links.new(source.outputs["Image"],denoise.inputs["Image"])
file=nodes.new("CompositorNodeOutputFile");file.base_path=str(output.parent);file.file_slots[0].path=output.stem+"-"
file.format.file_format="PNG";file.format.color_mode="RGB";file.format.color_depth="8";file.format.compression=90
scene.node_tree.links.new(denoise.outputs["Image"],file.inputs[0])
scene.frame_set(1);bpy.ops.render.render()
assert temporary.is_file();temporary.replace(output)
version=subprocess.run(["convert","-version"],check=True,capture_output=True,text=True).stdout.splitlines()[0]
assert version.startswith("Version: ImageMagick 6.9.12-98 Q16 "),f"imagemagick_version_mismatch:{version}"
subprocess.run(["convert",str(output),"-statistic","Median","5x5","-depth","8","-strip",str(output)],check=True)
result=bpy.data.images.load(str(output),check_existing=False)
assert tuple(result.size)==tuple(image.size),"atlas_resolution_changed"
print(f"Denoised and median-filtered irradiance atlas {result.size[0]}x{result.size[1]}")
