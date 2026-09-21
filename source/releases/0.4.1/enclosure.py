"""Join masonry before UV/baking: shared boundary vertices prevent raster cracks."""
import json
import bmesh
import bpy
from mathutils import Matrix


def prepare_enclosure():
    parts = sorted((o for o in bpy.data.collections["Runtime"].objects
                    if o.type == "MESH" and o.get("vrataObjectId") == "room-shell"
                    and o.name != "room-shell.floor"), key=lambda o: o.name)
    assert len(parts) > 1, "enclosure_source_parts_missing"
    names = [o.name for o in parts]
    evidence = bpy.data.collections.get("ConstructionEvidence")
    if evidence is None:
        evidence = bpy.data.collections.new("ConstructionEvidence")
        bpy.context.scene.collection.children.link(evidence)
    evidence.hide_viewport = True
    boxes = []
    for obj in parts:
        original = obj.copy()
        original.data = obj.data.copy()
        original.name = f"evidence.{obj.name}"
        original.hide_render = True
        original["vrataEvidencePartId"] = obj.name
        evidence.objects.link(original)
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            vertex.co = tuple(round(value, 5) for value in world)
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()
        boxes.append(([min(v.co[i] for v in obj.data.vertices) for i in range(3)],
                      [max(v.co[i] for v in obj.data.vertices) for i in range(3)]))
    axes = [sorted({box[side][axis] for box in boxes for side in (0, 1)}) for axis in range(3)]
    expected = 0.0
    for x0, x1 in zip(axes[0], axes[0][1:]):
        for y0, y1 in zip(axes[1], axes[1][1:]):
            for z0, z1 in zip(axes[2], axes[2][1:]):
                point = ((x0+x1)/2, (y0+y1)/2, (z0+z1)/2)
                if any(all(lo[i] <= point[i] <= hi[i] for i in range(3)) for lo, hi in boxes):
                    expected += (x1-x0)*(y1-y0)*(z1-z0)
    operands = bpy.data.collections.new("EnclosureUnionOperands")
    bpy.context.scene.collection.children.link(operands)
    for obj in parts[1:]:
        operands.objects.link(obj)
    keeper = parts[0]
    bpy.ops.object.select_all(action="DESELECT")
    keeper.select_set(True)
    bpy.context.view_layer.objects.active = keeper
    modifier = keeper.modifiers.new("continuous-masonry", "BOOLEAN")
    modifier.operation, modifier.solver = "UNION", "EXACT"
    modifier.operand_type, modifier.collection = "COLLECTION", operands
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for obj in parts[1:]:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(operands)
    keeper.name, keeper.data.name = "room-shell.enclosure", "mesh.room-shell.enclosure"
    keeper["vrataPartId"] = "enclosure"
    keeper["vrataConstituentParts"] = json.dumps(names, separators=(",", ":"))
    keeper["vrataGeometryDerivation"] = "exact masonry union on a 10 micrometre world grid before lightmap unwrap"
    mesh = bmesh.new()
    mesh.from_mesh(keeper.data)
    nonmanifold = sum(not edge.is_manifold for edge in mesh.edges)
    actual = abs(mesh.calc_volume(signed=True))
    mesh.free()
    assert nonmanifold == 0, f"enclosure_nonmanifold:{nonmanifold}"
    assert abs(actual-expected) <= max(1e-5, expected*1e-5), f"enclosure_volume_changed:{actual}:{expected}"
    return {"sourceParts": names, "result": keeper.name, "worldGridM": 1e-5,
            "expectedUnionVolumeM3": expected, "actualVolumeM3": actual, "nonmanifoldEdges": nonmanifold,
            "constituentEvidenceRetained": True}
