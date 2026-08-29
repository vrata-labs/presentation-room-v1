"""Render the four review views from the saved presentation-room-v1 Blend."""

import argparse
from pathlib import Path
import sys

import bpy


REVIEW_VIEWS = ("entry", "audience", "presenter", "diagonal-overview")


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def main():
    output = Path(arguments().output_dir)
    output.mkdir(parents=True, exist_ok=True)
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

    for view_id in REVIEW_VIEWS:
        scene.camera = bpy.data.objects[f"camera.review.{view_id}"]
        scene.render.filepath = str(output / f"{view_id}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
