"""Render source views and remove only PNG text/EXIF chunks (pixels unchanged)."""
import hashlib
import json
from pathlib import Path
import runpy
import struct
import sys
import bpy

HERE = Path(__file__).resolve().parent
source_hash = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
runpy.run_path(str(HERE.parent / "0.4.0/render-review.py"), run_name="__main__")
args = sys.argv[sys.argv.index("--")+1:]
output = Path(args[args.index("--out")+1])
for path in output.glob("*.png"):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    chunks, offset = [data[:8]], 8
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        end = offset+size+12
        assert end <= len(data)
        if data[offset+4:offset+8] not in (b"tEXt", b"zTXt", b"iTXt", b"eXIf"):
            chunks.append(data[offset:end])
        offset = end
    path.write_bytes(b"".join(chunks))
settings_path = output / "source-render-settings.json"
settings = json.loads(settings_path.read_text())
settings["sourceBlendSha256"] = source_hash
settings["renderScriptSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
settings["metadataPolicy"] = "PNG text and EXIF removed without recompressing image data"
settings_path.write_text(json.dumps(settings, indent=2)+"\n")
