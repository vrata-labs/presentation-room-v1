"""Record actual saved-source vertices for independent final GLB bounds checks."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
parts = {}
for collection_name in ('Runtime', 'ConstructionEvidence'):
    collection = bpy.data.collections.get(collection_name)
    if collection is None:
        continue
    for obj in collection.objects:
        if obj.type != 'MESH':
            continue
        name = obj.get('vrataEvidencePartId', obj.name)
        # Hidden construction collections are not dependency-graph evaluated on
        # load. These authored parts are parentless; matrix_basis is their exact
        # transform even when matrix_world has not been evaluated.
        assert obj.parent is None, 'parented_geometry_requires_evaluated_transform'
        points = [obj.matrix_basis @ vertex.co for vertex in obj.data.vertices]
        parts[name] = {'min': [min(p[i] for p in points) for i in range(3)], 'max': [max(p[i] for p in points) for i in range(3)]}
output = Path(args.out).resolve()
assert 'build' in output.parts
output.write_text(json.dumps({'sourceBlendSha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(), 'method': 'actual mesh vertices transformed to world Blender Z-up coordinates', 'parts': parts}, indent=2)+'\n')
print(json.dumps({'parts': len(parts), 'source': Path(bpy.data.filepath).name}), flush=True)
