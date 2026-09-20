import argparse
import hashlib
import json
from pathlib import Path
import runpy
import sys
import bpy

HERE=Path(__file__).resolve().parent
safe_output=runpy.run_path(str(HERE/"author-scene.py"))["safe_output"]
parser=argparse.ArgumentParser();parser.add_argument("--out",required=True);parser.add_argument("--views",default="");parser.add_argument("--resume",action="store_true")
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
out=safe_output(args.out);out.mkdir(parents=True,exist_ok=True)
requested=set(args.views.split(",")) if args.views else None
cameras=sorted((o for o in bpy.context.scene.objects if o.type=="CAMERA" and o.name.startswith("camera.") and (requested is None or o.name[7:] in requested)),key=lambda o:o.name)
assert cameras and (requested is None or len(cameras)==len(requested))
scene=bpy.context.scene;scene.render.engine="CYCLES";scene.cycles.samples=64;scene.cycles.use_denoising=True
pref=bpy.context.preferences.addons["cycles"].preferences;pref.compute_device_type="CUDA";pref.get_devices()
for device in pref.devices:device.use=device.type=="CUDA"
scene.cycles.device="GPU"
scene.render.resolution_x=1280;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG";scene.render.image_settings.color_mode="RGB";scene.render.image_settings.color_depth="8"
records=[]
for camera in cameras:
    scene.camera=camera;scene.render.filepath=str(safe_output(out/f"{camera.name[7:]}.png"))
    if not (args.resume and Path(scene.render.filepath).is_file()):
        bpy.ops.render.render(write_still=True)
    image=Path(scene.render.filepath).read_bytes()
    assert image[:8]==b"\x89PNG\r\n\x1a\n" and int.from_bytes(image[16:20],"big")==1280 and int.from_bytes(image[20:24],"big")==800
    records.append({"id":camera.name[7:],"position":list(camera.location),"rotation":list(camera.rotation_euler),"fovRadians":camera.data.angle,"sha256":hashlib.sha256(image).hexdigest()})
(out/"source-render-settings.json").write_text(json.dumps({"engine":"CYCLES","samples":64,"width":1280,"height":800,"look":scene.view_settings.look,"exposure":scene.view_settings.exposure,"sourceBlendSha256":hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),"views":records},indent=2)+"\n")
