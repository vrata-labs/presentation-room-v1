"""Validate declared part load paths and aggregated chair constituent fidelity."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


parser=argparse.ArgumentParser();parser.add_argument("--registry",required=True);parser.add_argument("--out",required=True)
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
registry_path=Path(args.registry);registry=json.loads(registry_path.read_text())
runtime={obj.name:obj for obj in bpy.data.collections["Runtime"].objects if obj.type=="MESH" and obj.get("vrataBakePolicy")=="include"}
evidence={obj["vrataEvidencePartId"]:obj for obj in bpy.data.collections["ConstructionEvidence"].objects if obj.type=="MESH"}
objects={name:obj for name,obj in runtime.items() if not obj.get("vrataObjectId","").startswith("chair-seat-")};objects.update(evidence)
vertices={name:[obj.matrix_world@vertex.co for vertex in obj.data.vertices] for name,obj in objects.items()}
bounds={name:([min(point[axis] for point in points) for axis in range(3)],[max(point[axis] for point in points) for axis in range(3)]) for name,points in vertices.items()}
trees={name:BVHTree.FromPolygons(vertices[name],[tuple(poly.vertices) for poly in obj.data.polygons],epsilon=.0001) for name,obj in objects.items()}


def broad_gap(left,right):
    low,high=bounds[left];other_low,other_high=bounds[right]
    return sum(max(low[axis]-other_high[axis],other_low[axis]-high[axis],0)**2 for axis in range(3))**.5


cache={}
def contact(left,right):
    key=tuple(sorted((left,right)))
    if key in cache:return cache[key]
    if broad_gap(left,right)>.004:result=None
    elif trees[left].overlap(trees[right]):result={"method":"world-triangle-bvh-overlap","distanceM":0.0}
    else:
        distance=min((trees[right].find_nearest(point)[3] for point in vertices[left]),default=float("inf"))
        if distance>.004:distance=min(distance,min((trees[left].find_nearest(point)[3] for point in vertices[right]),default=float("inf")))
        result={"method":"world-vertex-to-triangle-distance","distanceM":round(distance,7)} if distance<=.004 else None
    cache[key]=result;return result


root_parts=set(registry["supportGraph"]["rootParts"]);declarations={edge["part"]:edge for edge in registry["supportGraph"]["edges"]}
coverage_failures=sorted((set(objects)-root_parts)^set(declarations))
target_failures=sorted(f"{part}->{target}" for part,edge in declarations.items() for target in edge["targets"] if target not in objects)
cycle_failures=[];path_failures=[]


def visit(part,path):
    if part in root_parts:return True
    if part in path:cycle_failures.append("->".join((*path,part)));return False
    edge=declarations.get(part)
    if not edge:return False
    results=[visit(target,(*path,part)) for target in edge["targets"]]
    return all(results) if edge["allRequired"] else any(results)


for part in sorted(objects):
    if not visit(part,()):path_failures.append(part)
measured_edges=[];contact_failures=[]
for part,edge in sorted(declarations.items()):
    measurements=[]
    for target in edge["targets"]:
        measured=contact(part,target)
        measurements.append({"target":target,"contact":measured is not None,**(measured or {"distanceM":round(broad_gap(part,target),7),"method":"aabb-separation-lower-bound"})})
    passed=all(item["contact"] for item in measurements) if edge["allRequired"] else any(item["contact"] for item in measurements)
    measured_edges.append({**edge,"measurements":measurements,"passed":passed})
    if not passed:contact_failures.append(part)


def world_bounds(obj):
    points=[obj.matrix_world@vertex.co for vertex in obj.data.vertices]
    return ([min(point[axis] for point in points) for axis in range(3)],[max(point[axis] for point in points) for axis in range(3)])


aggregate_checks=[];aggregate_failures=[]
for card in registry["objects"]:
    for aggregate in card.get("aggregates",[]):
        obj=runtime[aggregate["part"]];members=[evidence[name] for name in aggregate["constituents"]]
        aggregate_bounds=world_bounds(obj);member_bounds=[world_bounds(member) for member in members]
        union=([min(box[0][axis] for box in member_bounds) for axis in range(3)],[max(box[1][axis] for box in member_bounds) for axis in range(3)])
        bounds_delta=max(abs(aggregate_bounds[side][axis]-union[side][axis]) for side in range(2) for axis in range(3))
        check={
            "aggregate":aggregate["part"],"constituents":aggregate["constituents"],
            "vertices":{"aggregate":len(obj.data.vertices),"constituents":sum(len(member.data.vertices) for member in members)},
            "polygons":{"aggregate":len(obj.data.polygons),"constituents":sum(len(member.data.polygons) for member in members)},
            "maximumBoundsDeltaM":round(bounds_delta,8),
        }
        check["passed"]=check["vertices"]["aggregate"]==check["vertices"]["constituents"] and check["polygons"]["aggregate"]==check["polygons"]["constituents"] and bounds_delta<=1e-6
        aggregate_checks.append(check)
        if not check["passed"]:aggregate_failures.append(aggregate["part"])

report={
    "kind":"declared-constituent-load-path-validation",
    "sourceBlendSha256":hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
    "measurementScriptSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "registrySha256":hashlib.sha256(registry_path.read_bytes()).hexdigest(),
    "coordinateSystem":"world Blender Z-up meters","toleranceM":.004,
    "rootParts":sorted(root_parts),"shippingMeshParts":len(runtime),"physicalConstituentParts":len(objects),"declaredParts":len(declarations),
    "aggregateChecks":aggregate_checks,"edges":measured_edges,
    "failures":{"coverage":coverage_failures,"missingTargets":target_failures,"cycles":sorted(set(cycle_failures)),"pathsWithoutRoot":sorted(set(path_failures)),"contacts":contact_failures,"aggregateFidelity":aggregate_failures},
    "limits":"Exact pre-join constituent meshes are retained in the saved source and checked against shipping aggregates by counts and world bounds. Contacts and rooted load paths do not establish material strength, subjective comfort, visual acceptance, or rights approval.",
}
Path(args.out).write_text(json.dumps(report,indent=2)+"\n")
failures=[name for name,values in report["failures"].items() if values]
print(json.dumps({"shippingMeshParts":len(runtime),"physicalConstituentParts":len(objects),"declaredParts":len(declarations),"failures":failures}))
if failures:raise RuntimeError("declared_support_validation_failed:"+",".join(failures))
