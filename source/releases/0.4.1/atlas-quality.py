"""Cheap deterministic overlap screening before committing GPU time to a bake."""
from collections import defaultdict
import bpy


def measure_atlas():
    grid, triangles = defaultdict(list), []
    ignored = 0
    for obj in bpy.data.collections["Runtime"].objects:
        if obj.type != "MESH" or obj.get("vrataBakePolicy") != "include":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers["VRATA_LIGHTMAP_UV"].data
        for tri in mesh.loop_triangles:
            a, b, c = [tuple(uv[index].uv) for index in tri.loops]
            area = abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
            if area < 1e-10:
                ignored += 1
                continue
            index = len(triangles)
            triangles.append((obj.name, a, b, c))
            for x in range(int(min(a[0], b[0], c[0])*128), int(max(a[0], b[0], c[0])*128)+1):
                for y in range(int(min(a[1], b[1], c[1])*128), int(max(a[1], b[1], c[1])*128)+1):
                    grid[x, y].append(index)
    overlaps = []
    for index, (name, a, b, c) in enumerate(triangles):
        px, py = (a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3
        for other in grid[int(px*128), int(py*128)]:
            if other == index:
                continue
            target, x, y, z = triangles[other]
            dx, dy, ex, ey = y[0]-x[0], y[1]-x[1], z[0]-x[0], z[1]-x[1]
            determinant = dx*ey-dy*ex
            u = ((px-x[0])*ey-(py-x[1])*ex)/determinant
            v = (dx*(py-x[1])-dy*(px-x[0]))/determinant
            if min(u, v, 1-u-v) > 1e-6:
                overlaps.append([name, target])
                break
    return {"kind": "lightmap-triangle-centroid-overlap-screening", "sampledTriangles": len(triangles),
            "ignoredSubpixelOrDegenerateTriangles": ignored, "minimumDoubleArea": 1e-10,
            "overlappingCentroids": len(overlaps), "examples": overlaps[:30],
            "limits": "Centroid screening rejects folding/overlapping charts; it is not exhaustive polygon-intersection or visual-quality proof."}
