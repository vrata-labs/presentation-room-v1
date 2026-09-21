"""Canonicalize packed-image and file-browser metadata without changing pixels."""
import argparse
from pathlib import Path
import runpy
import sys
import bpy


def sanitize_paths():
    for image in bpy.data.images:
        if image.packed_files:
            image.filepath = f"//textures/{Path(image.filepath).name}"
            for packed in image.packed_files:
                packed.filepath = image.filepath
        elif image.source == "FILE" and image.users:
            raise RuntimeError(f"unpacked_image:{image.name}")
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == "FILE_BROWSER" and space.params and hasattr(space.params, "directory"):
                    space.params.directory = b"//"
    bpy.context.scene.render.filepath = "//review/"
    bpy.context.scene.render.bake.filepath = "//"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    safe_output = runpy.run_path(str(Path(__file__).with_name("author-scene.py")))["safe_output"]
    sanitize_paths()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(safe_output(args.save)), check_existing=False)
