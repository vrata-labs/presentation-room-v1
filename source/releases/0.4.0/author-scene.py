"""Dimensioned eight-person presentation salon. Blender Z-up, meters."""
import argparse
import json
import math
from pathlib import Path
import runpy
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
CARDS={}
VIEWS={}
SEATS=[]
M={}
SUPPORTS={}
OUTPUT=None


def safe_output(path):
    path=Path(path).absolute()
    relative=path.relative_to(ROOT)
    if not (relative.parts[0]=="build" or relative.parts[:3]==("source","releases","0.4.0")):
        raise RuntimeError("output_outside_new_version")
    current=ROOT
    for name in relative.parts:
        current/=name
        if current.is_symlink(): raise RuntimeError("output_symlink")
    for args in (["ls-tree","--name-only","HEAD","--",relative.as_posix()],["ls-files","--",relative.as_posix()]):
        result=subprocess.run(["git",*args],cwd=ROOT,capture_output=True,text=True,check=True)
        if result.stdout.strip(): raise RuntimeError("tracked_output")
    return path


def linear(value):
    channels=[int(value[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in channels)+(1,)


def card(key,label,use,construction,support,status="passive"):
    if key in CARDS: raise RuntimeError(f"duplicate_object:{key}")
    CARDS[key]=dict(
        objectId=key,
        label=label,
        intendedUsers=["presenter", "audience member", "facilities maintainer"],
        expectedUse=use,
        expectedActions=[use],
        dimensions={"method":"measured final mesh bounds","rationale":"metric real-world proportions from the authoring task"},
        materialFinish={"method":"final per-part material inventory"},
        construction=construction,
        supportedBy=support,
        supportContact="measured against the declared supporting assembly",
        interactionStatus=status,
        scenarioIds=[f"{key}-use",f"{key}-support"],
        evidenceViews=["entry","diagonal-overview"],
        parts=[])


def material(key,color,rough=.7,metal=0,asset=None,period=1.0,glow=0):
    mat=bpy.data.materials.new(f"material.{key}")
    mat.use_nodes=True
    mat.diffuse_color=linear(color)
    shader=mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value=linear(color)
    shader.inputs["Roughness"].default_value=rough
    shader.inputs["Metallic"].default_value=metal
    if glow:
        shader.inputs["Emission Color"].default_value=linear(color)
        shader.inputs["Emission Strength"].default_value=glow
    mat["uvPeriodMeters"]=period
    if asset:
        uv=mat.node_tree.nodes.new("ShaderNodeUVMap");uv.uv_map="UVMap"
        for channel,socket in (("diff","Base Color"),("rough","Roughness"),("nor_gl","Normal")):
            image=bpy.data.images.load(str(HERE/"textures"/f"{asset}-{channel}.jpg"),check_existing=True)
            image.colorspace_settings.name="sRGB" if channel=="diff" else "Non-Color"
            if (asset=="wood_table_001" and channel in ("diff","rough")) or (asset=="fabric_pattern_05" and channel=="diff"):
                original=image
                image=bpy.data.images.new(f"{key}-{channel}",width=original.size[0],height=original.size[1],alpha=False)
                image.colorspace_settings.name="sRGB" if channel=="diff" else "Non-Color"
                pixels=np.empty(len(original.pixels),dtype=np.float32);original.pixels.foreach_get(pixels)
                rgba=pixels.reshape((-1,4))
                if asset=="fabric_pattern_05":
                    luminance=rgba[:,:3].mean(axis=1)
                    variation=np.clip(luminance/max(float(luminance.mean()),.001),.72,1.22)
                    rgba[:,:3]=np.array(linear(color)[:3])[None,:]*(.8+.2*variation[:,None])
                elif channel=="diff": rgba[:,:3]*=np.array([.72,.82,.95])
                else: rgba[:,:3]=.44+.28*rgba[:,:3]
                image.pixels.foreach_set(pixels)
                image.filepath_raw=str(OUTPUT/f"{key}-{channel}.png");image.file_format="PNG";image.save()
            image.pack()
            tex=mat.node_tree.nodes.new("ShaderNodeTexImage");tex.image=image
            mat.node_tree.links.new(uv.outputs["UV"],tex.inputs["Vector"])
            output=tex.outputs["Color"]
            if channel=="nor_gl":
                normal=mat.node_tree.nodes.new("ShaderNodeNormalMap")
                normal.inputs["Strength"].default_value=.18 if asset in ("wood_table_001","fabric_pattern_05") else .4
                mat.node_tree.links.new(output,normal.inputs["Color"]);output=normal.outputs["Normal"]
            mat.node_tree.links.new(output,shader.inputs[socket])
        mat["sourceAssetId"]=asset
    M[key]=mat


def finish(name,obj,mat,smooth=False):
    group,part=name.split(".",1)
    if group not in CARDS: raise RuntimeError(f"undeclared_object:{group}")
    obj.name=name;obj.data.name=f"mesh.{name}"
    obj.data.materials.append(M[mat])
    layer=obj.data.uv_layers.get("UVMap") or obj.data.uv_layers.new(name="UVMap")
    period=M[mat].get("uvPeriodMeters",1.0)
    for poly in obj.data.polygons:
        axis=max(range(3),key=lambda a:abs(poly.normal[a]));axes=((1,2),(0,2),(0,1))[axis]
        for li in poly.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            layer.data[li].uv=(v[axes[0]]/period,v[axes[1]]/period)
        poly.use_smooth=smooth
    for c in list(obj.users_collection):c.objects.unlink(obj)
    bpy.data.collections["Runtime"].objects.link(obj)
    for key,value in {
        "vrataObjectId":group,
        "vrataPartId":part,
        "vrataInteractionStatus":CARDS[group]["interactionStatus"],
        "vrataBakePolicy":"include",
        "vrataCollisionPolicy":"scene-default",
        "vrataSupportPolicy":"included",
        "vrataNavigableBoundsPolicy":"include",
        "vrataAssetOrigin":"project-authored",
        "vrataAuthoringRelease":"0.4.0",
    }.items():obj[key]=value
    CARDS[group]["parts"].append(name)
    return obj


def box(name,size,pos,mat,bevel=.003,rotation=(0,0,0),soft=False):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    obj=bpy.context.object;obj.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new("manufactured-edge","BEVEL");mod.width=min(bevel,min(size)*.45);mod.segments=10 if soft else 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.rotation_euler=rotation
    finish(name,obj,mat,soft)
    if soft:
        mod=obj.modifiers.new("weighted-normals","WEIGHTED_NORMAL");mod.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def rod(name,start,end,radius,mat,vertices=24):
    a,b=Vector(start),Vector(end)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=(b-a).length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_euler=(b-a).to_track_quat("Z","Y").to_euler()
    return finish(name,obj,mat,True)


def tube(name,points,radius,mat):
    curve=bpy.data.curves.new(name,"CURVE");curve.dimensions="3D";curve.bevel_depth=radius;curve.bevel_resolution=3
    spline=curve.splines.new("BEZIER");spline.bezier_points.add(len(points)-1)
    for v,p in zip(spline.bezier_points,points):v.co=p;v.handle_left_type=v.handle_right_type="AUTO"
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT");obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target="MESH")
    return finish(name,obj,mat,True)


def aggregate_object_by_material(object_id, part_names):
    source_objects=sorted(
        (obj for obj in bpy.data.collections["Runtime"].objects if obj.get("vrataObjectId")==object_id),
        key=lambda obj:obj.name,
    )
    constituents=[]
    for obj in source_objects:
        evidence=obj.copy();evidence.data=obj.data.copy();evidence.name=f"evidence.{obj.name}"
        evidence.hide_render=True
        evidence["vrataEvidencePartId"]=obj.name
        bpy.data.collections["ConstructionEvidence"].objects.link(evidence)
        constituents.append({"part":obj.name,"material":obj.data.materials[0].name,"vertices":len(obj.data.vertices),"polygons":len(obj.data.polygons)})
    CARDS[object_id]["constituentParts"]=constituents
    CARDS[object_id]["aggregates"]=[]
    aggregates=[]
    for material_name,part_name in part_names.items():
        objects=[obj for obj in bpy.data.collections["Runtime"].objects if obj.get("vrataObjectId")==object_id]
        members=[obj for obj in objects if obj.data.materials and obj.data.materials[0].name==f"material.{material_name}"]
        if not members: continue
        member_names=sorted(obj.name for obj in members)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in members: obj.select_set(True)
        active=members[0];bpy.context.view_layer.objects.active=active
        bpy.ops.object.join()
        active.name=f"{object_id}.{part_name}"
        active.data.name=f"mesh.{object_id}.{part_name}"
        active["vrataPartId"]=part_name
        active["vrataConstituentParts"]=json.dumps(member_names,separators=(",",":"))
        CARDS[object_id]["aggregates"].append({"part":active.name,"material":f"material.{material_name}","constituents":member_names})
        aggregates.append(active.name)
    CARDS[object_id]["parts"]=sorted(aggregates)


def area(name,pos,target,energy,size,color="FFF0DD"):
    data=bpy.data.lights.new(name,"AREA");data.energy=energy;data.shape="RECTANGLE";data.size=size[0];data.size_y=size[1];data.color=linear(color)[:3]
    obj=bpy.data.objects.new(name,data);bpy.data.collections["Authoring"].objects.link(obj);obj.location=pos
    obj.rotation_euler=(Vector(target)-Vector(pos)).to_track_quat("-Z","Y").to_euler()


def printed_text(name,body,size,pos,tilt):
    bpy.ops.object.text_add(location=pos,rotation=(tilt,0,0))
    obj=bpy.context.object;obj.data.body=body;obj.data.size=size;obj.data.resolution_u=2;obj.data.extrude=0
    bpy.ops.object.convert(target="MESH")
    return finish(name,obj,"dark")


def camera(key,pos,target,fov=62):
    data=bpy.data.cameras.new(f"camera.{key}");data.angle=math.radians(fov)
    obj=bpy.data.objects.new(f"camera.{key}",data);bpy.data.collections["Authoring"].objects.link(obj);obj.location=pos
    obj.rotation_euler=(Vector(target)-Vector(pos)).to_track_quat("-Z","Y").to_euler()
    VIEWS[key]={"position":pos,"target":target,"horizontalFovDegrees":fov}


def architecture():
    card("room-shell","Enclosed presentation salon","Provide acoustically controlled room for eight people","Masonry perimeter, plasterboard ceiling and engineered timber floor","building structure")
    box("room-shell.floor",(9.4,8.0,.14),(0,0,-.07),"floor",.002)
    for key,size,pos in [("left",(.18,8.0,3.6),(-4.79,0,1.8)),("right",(.18,8.0,3.6),(4.79,0,1.8)),
        ("front",(9.6,.18,3.6),(0,-4.09,1.8)),("rear-left",(3.75,.18,3.6),(-2.825,4.09,1.8)),
        ("rear-right",(3.75,.18,3.6),(2.825,4.09,1.8)),("door-header",(1.9,.18,1.2),(0,4.09,3.0)),
        ("ceiling",(9.6,8.2,.14),(0,0,3.67))]:box(f"room-shell.{key}",size,pos,"plaster",.003)
    card("skirting","Charcoal perimeter skirting","Protect wall base","80 mm timber trim with finished corners, fixed flush to wall","room-shell")
    for key,size,pos in [("left",(.018,8,.08),(-4.688,0,.04)),("right",(.018,8,.08),(4.688,0,.04)),
        ("front",(9.38,.018,.08),(0,-3.988,.04)),("rear-left",(3.72,.018,.08),(-2.83,3.988,.04)),("rear-right",(3.72,.018,.08),(2.83,3.988,.04))]:box(f"skirting.{key}",size,pos,"metal",.001)
    card("audience-rug","Bound acoustic carpet runner","Reduce chair noise and define audience area","Low-pile textile on non-slip backing, edges flush enough not to trip","room-shell")
    box("audience-rug.body",(8.4,2.3,.012),(0,1.05,.006),"carpet",.005)
    card("main-door","Double entrance doors","Enter/leave through central rear aisle; opening deferred","Veneered leaves in timber jamb with hinges, lever latches and central meeting stile","room-shell","deferred")
    for side in (-1,1):
        x=side*.46
        box(f"main-door.leaf-{side}",(.905,.045,2.35),(x,4.025,1.185),"wood",.002)
        for i,z in enumerate((.3,1.18,2.05)):
            rod(f"main-door.hinge-{side}-{i}",(side*.918,3.995,z-.05),(side*.918,3.995,z+.05),.009,"steel")
            box(f"main-door.hinge-jamb-{side}-{i}",(.030,.026,.084),(side*.931,4.018,z),"steel",.001)
            box(f"main-door.hinge-door-{side}-{i}",(.030,.026,.084),(side*.905,4.018,z),"steel",.001)
        rod(f"main-door.rosette-{side}",(side*.12,4.0,1.03),(side*.12,3.982,1.03),.024,"steel")
        tube(f"main-door.lever-{side}",[(side*.12,3.982,1.03),(side*.12,3.943,1.03),(side*.245,3.943,1.03)],.009,"steel")
        box(f"main-door.latch-{side}",(.020,.024,.080),(side*.014,4.014,1.03),"steel",.001)
    for key,size,pos in [("left",(.035,.15,2.4),(-.94,4.03,1.20)),("right",(.035,.15,2.4),(.94,4.03,1.20)),("head",(1.845,.15,.035),(0,4.03,2.3825))]:box(f"main-door.jamb-{key}",size,pos,"wood",.001)


def screen_and_acoustics():
    card("presentation-screen","Fine-pitch modular 16:9 LED wall","Read shared PDF/video from every audience seat","Lightweight LED cabinets on concealed aluminum subframe and two anchored steel mounting rails; power/data raceway and runtime face forward of backing","room-shell","interactive")
    for side in (-1,1):box(f"presentation-screen.bracket-{side}",(.065,.13,.78),(side*1.2,-3.935,2.0),"metal",.002)
    box("presentation-screen.chassis",(4.88,.070,2.78),(0,-3.858,2.12),"metal",.010)
    box("presentation-screen.face",(4.8,.003,2.7),(0,-3.820,2.12),"screen",.001)
    box("presentation-screen.raceway",(.038,.040,.70),(0,-3.98,.39),"metal",.002)
    for side in (-1,1):
        for i,y in enumerate((-2.55,-.85,.85,2.55)):
            key=f"acoustic-{'left' if side<0 else 'right'}-{i}"
            card(key,"Fabric-covered acoustic cassette","Absorb reflections beside audience and screen","50 mm absorber in timber cassette on two battens and concealed Z-clips","room-shell")
            x=side*4.67
            for j,z in enumerate((.76,2.42)):box(f"{key}.batten-{j}",(.060,1.12,.036),(x,y,z),"wood",.001)
            box(f"{key}.absorber",(.058,1.23,1.82),(side*4.614,y,1.61),"acoustic",.007)
            for edge,dy in (("a",-.6255),("b",.6255)):box(f"{key}.side-{edge}",(.066,.021,1.82),(side*4.61,y+dy,1.61),"wood",.002)
            for edge,z in (("bottom",.690),("top",2.530)):box(f"{key}.{edge}",(.066,1.272,.020),(side*4.61,y,z),"wood",.002)


def chair(index,cx,cy):
    key=f"chair-seat-{index:02d}"
    theta=math.atan2(cx,-3.82-cy);c,s=math.cos(theta),math.sin(theta)
    def p(x,y,z):return (cx+c*x-s*y,cy+s*x+c*y,z)
    def b(part,size,position,mat,bevel=.004,tilt=0,soft=False):return box(f"{key}.{part}",size,p(*position),mat,bevel,(tilt,0,theta),soft)
    def r(part,a,z,radius,mat):return rod(f"{key}.{part}",p(*a),p(*z),radius,mat)
    card(key,"Upholstered conference armchair","Approach, sit facing screen, stand into clear rear aisle","Welded tubular frame with glides, plywood seat/back shells, tailored cushions and attached arm pads","audience-rug","interactive")
    b("seat-shell",(.49,.46,.025),(0,0,.395),"wood",.010,soft=True)
    b("seat-cushion",(.49,.45,.075),(0,.005,.445),"fabric",.035,soft=True)
    b("back-shell",(.485,.024,.49),(0,-.248,.715),"wood",.011,math.radians(8),True)
    b("back-cushion",(.465,.062,.46),(0,-.225,.723),"fabric",.029,math.radians(8),True)
    for side in (-1,1):
        for end,dy in (("front",.20),("rear",-.22)):
            r(f"leg-{side}-{end}",(side*.27,dy,.025),(side*.225,dy,.391),.012,"metal")
            r(f"glide-{side}-{end}",(side*.27,dy,.012),(side*.27,dy,.029),.016,"rubber")
        r(f"frame-side-{side}",(side*.225,-.235,.386),(side*.225,.235,.386),.012,"metal")
        r(f"back-post-{side}",(side*.225,-.23,.39),(side*.225,-.27,.81),.012,"metal")
        r(f"arm-post-{side}",(side*.225,.12,.39),(side*.295,.12,.62),.011,"metal")
        r(f"arm-rear-{side}",(side*.225,-.26,.61),(side*.295,-.15,.62),.011,"metal")
        b(f"arm-pad-{side}",(.052,.30,.027),(side*.295,.005,.635),"wood",.011,soft=True)
    for name,dy in (("front",.19),("rear",-.21)):r(f"cross-{name}",(-.225,dy,.385),(.225,dy,.385),.013,"metal")
    aggregate_object_by_material(key,{"metal":"frame","rubber":"glides","wood":"shells-and-arms","fabric":"upholstery"})
    stand=p(0,.72,0)
    SEATS.append({"id":f"seat-{index:02d}","objectId":key,"blenderPosition":[cx,cy,0],"seatHeight":.4825,"yawBlender":theta,"eye":[cx,cy,1.20],"frontStandPoint":[stand[0],stand[1]],"sitSweepRadiusM":.20})
    camera(f"seat-{index:02d}-display",(cx,cy,1.20),(0,-3.82,2.12),77)


def lectern_and_storage():
    card("lectern","Adjustable presentation lectern","Support speaker notes/laptop and mounted microphone","Steel weighted foot and upright, bolted veneered sloped top with retaining lip","room-shell","deferred")
    x,y=-3.18,-2.73
    angle=math.radians(9)
    def surface_point(dx,dy,dz):return (x+dx,y+dy*math.cos(angle)-dz*math.sin(angle),1.05+dy*math.sin(angle)+dz*math.cos(angle))
    box("lectern.base",(.62,.53,.030),(x,y,.019),"metal",.012)
    box("lectern.column",(.12,.14,.99),(x,y,.52),"metal",.009)
    box("lectern.mount",(.33,.32,.026),surface_point(0,0,-.026),"metal",.003,(angle,0,0))
    box("lectern.top",(.70,.50,.026),(x,y,1.05),"wood",.005,(angle,0,0))
    box("lectern.lip",(.68,.016,.027),surface_point(0,-.241,.0265),"wood",.003,(angle,0,0))
    card("microphone","Lectern gooseneck microphone","Speak hands-free while addressing audience","Base socket supports flexible neck and capsule, cable through lectern","lectern","deferred")
    rod("microphone.base",surface_point(.26,.13,.005),surface_point(.26,.13,.033),.030,"metal")
    tube("microphone.neck",[surface_point(.26,.13,.033),(x+.25,y+.08,1.35),(x+.10,y-.18,1.43)],.0045,"metal")
    rod("microphone.capsule",(x+.10,y-.18,1.43),(x+.055,y-.21,1.43),.012,"dark")
    tube("microphone.cable",[surface_point(.26,.13,.005),(x+.12,y+.10,.91),(x+.08,y-.075,.2),(x+.08,y-.075,.03),(x+.34,y-.33,.03)],.003,"dark")
    card("presenter-floorbox","Recessed AV floor connection","Connect the lectern microphone to building AV wiring","Floor-mounted cover plate with locked connector and cable strain relief","room-shell","deferred")
    box("presenter-floorbox.cover",(.18,.16,.006),(x+.34,y-.33,.003),"metal",.002)
    rod("presenter-floorbox.collar",(x+.34,y-.33,.005),(x+.34,y-.33,.009),.011,"steel")
    rod("presenter-floorbox.connector",(x+.34,y-.33,.008),(x+.34,y-.33,.031),.008,"dark")
    card("presenter-notes","Paper notes on lectern","Read running order while speaking","Thin paper sheets resting on sloped top","lectern","deferred")
    box("presenter-notes.sheets",(.21,.27,.002),surface_point(-.10,.035,.014),"paper",.0005,(angle,0,0))
    for i,(body,size) in enumerate((("SESSION NOTES",.011),("01  Context",.007),("02  Discussion",.007),("03  Next steps",.007))):
        printed_text(f"presenter-notes.print-{i}",body,size,surface_point(-.185,.135-i*.026,.01503),angle)
    card("av-cabinet","Ventilated AV cabinet","House and service presentation electronics","18 mm veneered carcass, hinged doors, ventilation grille and recessed plinth","room-shell","deferred")
    x,y=3.32,-3.61
    for key,size,pos in [("plinth",(1.12,.39,.07),(x,y,.035)),("bottom",(1.20,.49,.018),(x,y,.079)),("top",(1.20,.49,.024),(x,y,.80)),
        ("left",(.018,.49,.70),(x-.591,y,.438)),("right-lower",(.018,.49,.272),(x+.591,y,.224)),("right-upper",(.018,.49,.248),(x+.591,y,.664)),
        ("right-front-stile",(.018,.115,.18),(x+.591,y+.1875,.45)),("right-rear-stile",(.018,.115,.18),(x+.591,y-.1875,.45)),
        ("back",(1.16,.006,.70),(x,y-.242,.438))]:box(f"av-cabinet.{key}",size,pos,"wood",.002)
    for i in range(7):box(f"av-cabinet.vent-blade-{i}",(.014,.26,.006),(x+.602,y,.37+i*.026),"metal",.001)
    for side in (-1,1):
        box(f"av-cabinet.door-{side}",(.580,.018,.690),(x+side*.297,y+.247,.437),"wood",.002)
        for index,z in enumerate((.24,.64)):
            box(f"av-cabinet.hinge-{side}-{index}",(.028,.018,.060),(x+side*.575,y+.240,z),"steel",.001)
        rod(f"av-cabinet.pull-{side}",(x+side*.06,y+.278,.37),(x+side*.06,y+.278,.53),.004,"metal")
        for z in (.37,.53):rod(f"av-cabinet.standoff-{side}-{z}",(x+side*.06,y+.257,z),(x+side*.06,y+.278,z),.004,"metal")
    card("room-ventilation","Ceiling supply and return grilles","Ventilate enclosed occupied room","Recessed grilles seated flush in ceiling openings, ductwork above ceiling","room-shell")
    for side in (-1,1):
        box(f"room-ventilation.frame-{side}",(.75,.30,.018),(side*3.55,2.85,3.591),"paint",.002)
        for i in range(10):box(f"room-ventilation.slot-{side}-{i}",(.67,.010,.002),(side*3.55,2.74+i*.025,3.581),"dark",.001)


def lighting():
    for i,y in enumerate((-2.4,.25,2.70)):
        key=f"linear-light-{i}"
        card(key,"Suspended linear LED luminaire","Provide comfortable architectural light","Extruded aluminum housing, opal diffuser, two steel suspension cables and ceiling canopies","room-shell")
        box(f"{key}.housing",(3.8,.10,.055),(0,y,3.18),"metal",.005)
        box(f"{key}.diffuser",(3.70,.076,.006),(0,y,3.149),"glow",.001)
        for j,x in enumerate((-1.52,1.52)):
            rod(f"{key}.cable-{j}",(x,y,3.208),(x,y,3.584),.002,"steel",12)
            rod(f"{key}.canopy-{j}",(x,y,3.579),(x,y,3.60),.026,"metal")
        area(f"light.linear-{i}",(0,y,3.14),(0,y,.3),430,(3.6,.09))
    for side in (-1,1):
        key=f"wall-wash-{'left' if side<0 else 'right'}"
        card(key,"Recessed wall-wash channel","Illuminate fabric acoustic panels","Continuous diffuser and housing recessed against ceiling/wall junction","room-shell")
        box(f"{key}.housing",(.055,6.2,.042),(side*4.36,0,3.58),"metal",.002)
        box(f"{key}.diffuser",(.030,6.1,.004),(side*4.36,0,3.556),"glow",.001)
        area(f"light.wash-{side}",(side*4.34,0,3.545),(side*4.64,0,1.6),180,(.08,6.0),"FFE6C6")


def configure():
    scene=bpy.context.scene;scene.unit_settings.system="METRIC";scene.unit_settings.scale_length=1
    scene["sceneId"]="presentation-room-v1";scene["releaseVersion"]="0.4.0";scene["qualityOutcome"]="REWORK_REQUIRED"
    scene["vrataSceneId"]="presentation-room-v1";scene["vrataAuthoringRelease"]="0.4.0"
    scene.render.engine="CYCLES"
    pref=bpy.context.preferences.addons["cycles"].preferences;pref.compute_device_type="CUDA";pref.get_devices()
    for device in pref.devices:device.use=device.type=="CUDA"
    scene.cycles.device="GPU";scene.cycles.samples=48;scene.cycles.use_denoising=True;scene.cycles.max_bounces=6
    scene.render.resolution_x=1280;scene.render.resolution_y=800;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG";scene.render.image_settings.color_mode="RGB"
    scene.world.use_nodes=True;scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.08
    scene.view_settings.view_transform="AgX";scene.view_settings.look="AgX - Medium High Contrast"
    camera("entry",(0,3.55,1.62),(0,-2.8,1.65),77)
    camera("diagonal-overview",(4.14,3.05,1.64),(-.8,-1.4,1.50),73)
    camera("presenter",(-3.18,-3.30,1.65),(.3,1.10,1.12),76)
    camera("chair-detail",(.20,-.04,1.28),(1.0,.8,.65),53)
    camera("chair-underneath",(.15,.18,.28),(1.0,.75,.35),64)
    camera("lectern-detail",(-1.95,-1.56,1.56),(-3.18,-2.73,.92),50)
    camera("acoustic-detail",(2.65,-.35,1.70),(4.52,.72,1.55),62)
    camera("door-detail",(1.90,2.7,1.6),(0,4.0,1.2),61)


def main():
    global OUTPUT
    parser=argparse.ArgumentParser();parser.add_argument("--out",required=True);parser.add_argument("--views",default="entry,diagonal-overview")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:]);OUTPUT=safe_output(args.out);OUTPUT.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):bpy.data.collections.remove(collection)
    for name in ("Runtime","Authoring","ConstructionEvidence"):bpy.context.scene.collection.children.link(bpy.data.collections.new(name))
    material("floor","96704F",asset="wood_floor",period=1.7)
    material("wood","795132",asset="wood_table_001",period=1.5)
    material("fabric","77746B",asset="fabric_pattern_05",period=.5)
    material("acoustic","A9A392",asset="fabric_pattern_05",period=.5)
    material("carpet","77766E",asset="fabric_pattern_05",period=.5)
    for key,color,rough,metal in [("plaster","CCC7BB",.88,0),("paint","DDD9CD",.69,0),("metal","282B2A",.44,0),
        ("steel","A4A8AA",.27,.90),("dark","242725",.68,0),("rubber","1E201D",.86,0),("screen","353C3C",.4,0),("paper","E5DFCF",.86,0)]:material(key,color,rough,metal)
    material("glow","FFF0DA",.5,glow=3)
    architecture();screen_and_acoustics()
    for i,x in enumerate((-3.85,-2.85,-1.85,-.85,.85,1.85,2.85,3.85),1):chair(i,x,.65+abs(x)*.10)
    lectern_and_storage();lighting();configure();bpy.context.view_layer.update()
    support_module=runpy.run_path(str(HERE/"support_graph.py"))
    SUPPORTS.update(support_module["declare_support_graph"](CARDS))
    for obj in bpy.data.collections["Runtime"].objects:
        points=[obj.matrix_world@Vector(p) for p in obj.bound_box]
        CARDS[obj["vrataObjectId"]].setdefault("measuredParts",[]).append({"name":obj.name,"min":[min(p[i] for p in points) for i in range(3)],"max":[max(p[i] for p in points) for i in range(3)],"materials":[m.name for m in obj.data.materials]})
    (OUTPUT/"object-registry.json").write_text(json.dumps({"sceneId":"presentation-room-v1","releaseVersion":"0.4.0","qualityOutcome":"REWORK_REQUIRED","objects":list(CARDS.values()),"seats":SEATS,"supportGraph":{"rootParts":["room-shell.floor"],"edges":[SUPPORTS[name] for name in sorted(SUPPORTS)]}},indent=2)+"\n")
    (OUTPUT/"review-views.json").write_text(json.dumps(VIEWS,indent=2)+"\n")
    bpy.context.preferences.filepaths.save_version=0;safe_output(OUTPUT/"draft-scene.blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/"draft-scene.blend"),check_existing=False)
    for key in args.views.split(","):
        if not key:continue
        scene=bpy.context.scene;scene.camera=bpy.data.objects[f"camera.{key}"];scene.render.filepath=str(safe_output(OUTPUT/f"{key}.png"));bpy.ops.render.render(write_still=True)
    print(json.dumps({"objects":len(CARDS),"parts":sum(len(v["parts"]) for v in CARDS.values()),"qualityOutcome":"REWORK_REQUIRED"}))


if __name__=="__main__":main()
