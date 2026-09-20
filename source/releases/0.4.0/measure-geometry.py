"""Measure final presentation-room routes, sit/stand envelopes, and sightlines."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


parser=argparse.ArgumentParser();parser.add_argument("--registry",required=True);parser.add_argument("--out",required=True)
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
registry_path=Path(args.registry);registry=json.loads(registry_path.read_text())
runtime_objects={obj.name:obj for obj in bpy.data.collections["Runtime"].objects if obj.type=="MESH"}
evidence_objects={obj["vrataEvidencePartId"]:obj for obj in bpy.data.collections["ConstructionEvidence"].objects if obj.type=="MESH"}
objects={name:obj for name,obj in runtime_objects.items() if not obj.get("vrataObjectId","").startswith("chair-seat-")}
objects.update(evidence_objects)


def object_bounds(obj):
    points=[obj.matrix_world@Vector(point) for point in obj.bound_box]
    return ([min(point[axis] for point in points) for axis in range(3)],[max(point[axis] for point in points) for axis in range(3)])


bounds={name:object_bounds(obj) for name,obj in objects.items()}
trees={name:BVHTree.FromPolygons([obj.matrix_world@vertex.co for vertex in obj.data.vertices],[tuple(poly.vertices) for poly in obj.data.polygons],epsilon=.0001) for name,obj in objects.items()}


def horizontal_gap(point,box):
    return math.hypot(max(box[0][0]-point[0],point[0]-box[1][0],0),max(box[0][1]-point[1],point[1]-box[1][1],0))


def sample_route(route,step=.05):
    samples=[]
    for start,end in zip(route,route[1:]):
        distance=math.dist(start,end);count=max(1,math.ceil(distance/step))
        samples.extend(tuple(start[axis]+(end[axis]-start[axis])*index/count for axis in range(2)) for index in range(count))
    samples.append(route[-1]);return samples


actor_heights=tuple(.05+index*.10 for index in range(18))
def actor_clearance(point,name):
    coarse=horizontal_gap(point,bounds[name])
    if coarse>.50:return coarse
    return min(trees[name].find_nearest(Vector((point[0],point[1],z)))[3] for z in actor_heights)


obstacles={
    name:box for name,box in bounds.items()
    if objects[name].get("vrataBakePolicy")=="include"
    and name!="room-shell.floor" and box[1][2]>=.05 and box[0][2]<=1.8
    and not name.startswith(("room-shell.","skirting.","audience-rug."))
}
route_results=[]
sit_stand=[]
for seat in registry["seats"]:
    stand=tuple(seat["frontStandPoint"])
    route=[(0,3.35),(0,-.25),(stand[0],-.25),stand]
    clearances=[(actor_clearance(point,name),name) for point in sample_route(route) for name in obstacles]
    minimum,nearest=min(clearances)
    route_results.append({"id":f"entry-to-{seat['id']}-front-stand","actorRadiusM":.30,"points":[list(point) for point in route],"minimumClearanceM":round(minimum,4),"nearestPart":nearest,"clear":minimum>=.30})

    object_id=seat["objectId"]
    allowed={f"{object_id}.seat-shell",f"{object_id}.seat-cushion",f"{object_id}.back-shell",f"{object_id}.back-cushion"}
    body_obstacles={name:box for name,box in obstacles.items() if name not in allowed and box[1][2]>=.50 and box[0][2]<=1.15}
    center=tuple(seat["blenderPosition"][:2])
    sweep=[stand,center]
    clearances=[]
    for point in sample_route(sweep,.025):
        for name in body_obstacles:
            distance=min(trees[name].find_nearest(Vector((point[0],point[1],z)))[3] for z in (.50,.60,.70,.80,.90,1.0,1.10,1.15))
            clearances.append((distance,name))
    minimum,nearest=min(clearances)
    sit_stand.append({
        "seat":seat["id"],
        "method":"front stand point to seated center vertical-capsule sweep against world-triangle geometry; intended seat/back contact surfaces are listed, while arms/frame and every other chair remain obstacles",
        "allowedDestinationContacts":sorted(allowed),
        "bodyRadiusM":seat["sitSweepRadiusM"],
        "frontStandPoint":list(stand),
        "seatedCenter":list(center),
        "minimumClearanceM":round(minimum,4),
        "nearestPart":nearest,
        "clear":minimum>=seat["sitSweepRadiusM"],
    })

presenter_route=[(0,3.35),(0,-1.85),(-2.35,-2.20)]
clearances=[(actor_clearance(point,name),name) for point in sample_route(presenter_route) for name in obstacles]
minimum,nearest=min(clearances)
route_results.append({"id":"entry-to-presenter","actorRadiusM":.30,"points":[list(point) for point in presenter_route],"minimumClearanceM":round(minimum,4),"nearestPart":nearest,"clear":minimum>=.30})

surface={"center":[0,-3.816,2.12],"width":4.8,"height":2.7,"normal":[0,1,0]}
deps=bpy.context.evaluated_depsgraph_get();visibility=[]
for seat in registry["seats"]:
    eye=Vector(seat["eye"])
    for fx,fz in ((-.48,-.48),(-.48,.48),(.48,-.48),(.48,.48),(0,0)):
        target=Vector(surface["center"])+Vector((fx*surface["width"],0,fz*surface["height"]));direction=target-eye
        hit,_,_,_,obj,_=bpy.context.scene.ray_cast(deps,eye,direction.normalized(),distance=direction.length-.002)
        visibility.append({"seat":seat["id"],"sample":[fx,fz],"clear":not hit,"obstruction":obj.name if hit else None,"distanceM":round(direction.length,4)})

report={
    "sceneId":registry["sceneId"],"releaseVersion":registry["releaseVersion"],
    "shippingMeshParts":len(runtime_objects),
    "physicalConstituentParts":len(objects),
    "xrMeshBudget":{"maximum":300,"actual":len(runtime_objects),"passed":len(runtime_objects)<=300},
    "screenVisibility":{"method":"evaluated-scene ray cast from each seated eye to five inset display points","allClear":all(ray["clear"] for ray in visibility),"rays":visibility},
    "userClearances":{"routes":route_results,"allRoutesClear":all(route["clear"] for route in route_results),"sitStandSweeps":sit_stand,"allSitStandSweepsClear":all(sweep["clear"] for sweep in sit_stand)},
    "surface":surface,
    "limits":"Approach routes include destination-chair frame geometry. Sit/stand sweeps permit only explicitly listed cushion/shell contact surfaces and retain destination arms/frame as obstacles. AABB/capsule screening does not establish subjective comfort.",
}
report.update(sourceBlendSha256=hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),measurementScriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),registrySha256=hashlib.sha256(registry_path.read_bytes()).hexdigest())
Path(args.out).write_text(json.dumps(report,indent=2)+"\n")
failures=[]
if not report["xrMeshBudget"]["passed"]:failures.append("xr_mesh_budget")
if not report["screenVisibility"]["allClear"]:failures.append("screen_visibility")
if not report["userClearances"]["allRoutesClear"]:failures.append("routes")
if not report["userClearances"]["allSitStandSweepsClear"]:failures.append("sit_stand")
print(json.dumps({"sceneId":registry["sceneId"],"shippingParts":len(runtime_objects),"constituentParts":len(objects),"failures":failures}))
if failures:raise RuntimeError("geometry_screening_failed:"+",".join(failures))
