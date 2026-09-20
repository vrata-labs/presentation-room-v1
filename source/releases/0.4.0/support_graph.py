"""Source-authored support graph for Presentation Room 0.4.0."""
import json

import bpy


def declare_support_graph(cards):
    supports={}

    def add(part,targets,joint,all_required=True):
        if part in supports:raise RuntimeError(f"duplicate_support:{part}")
        supports[part]={"part":part,"targets":[targets] if isinstance(targets,str) else list(targets),"joint":joint,"allRequired":all_required}

    for part in ("left","right","front","rear-left","rear-right"):
        add(f"room-shell.{part}","room-shell.floor","masonry-bearing-contact")
    add("room-shell.door-header",["room-shell.rear-left","room-shell.rear-right"],"continuous-masonry-joint")
    add("room-shell.ceiling",["room-shell.left","room-shell.right","room-shell.front"],"ceiling-bearing-joint")
    for part in ("left","right","front","rear-left","rear-right"):
        add(f"skirting.{part}","room-shell.floor","fixed-floor-wall-junction")
    add("audience-rug.body","room-shell.floor","non-slip-floor-contact")

    add("main-door.jamb-left","room-shell.rear-left","fixed-jamb")
    add("main-door.jamb-right","room-shell.rear-right","fixed-jamb")
    add("main-door.jamb-head",["main-door.jamb-left","main-door.jamb-right"],"joined-jamb-head")
    for side in (-1,1):
        for index in range(3):
            add(f"main-door.hinge-jamb-{side}-{index}",f"main-door.jamb-{'left' if side<0 else 'right'}","screwed-hinge-leaf")
            add(f"main-door.hinge-{side}-{index}",f"main-door.hinge-jamb-{side}-{index}","hinge-pin-bearing")
            add(f"main-door.hinge-door-{side}-{index}",f"main-door.hinge-{side}-{index}","hinge-pin-bearing")
        add(f"main-door.leaf-{side}",[f"main-door.hinge-door-{side}-{index}" for index in range(3)],"three-hinge-door-support")
        add(f"main-door.rosette-{side}",f"main-door.leaf-{side}","through-bolted-rosette")
        add(f"main-door.lever-{side}",f"main-door.rosette-{side}","lever-spindle-joint")
        add(f"main-door.latch-{side}",f"main-door.leaf-{side}","mortised-latch")

    for side in (-1,1):
        add(f"presentation-screen.bracket-{side}","room-shell.front","wall-anchor")
    add("presentation-screen.chassis",["presentation-screen.bracket--1","presentation-screen.bracket-1"],"two-rail-screen-mount")
    add("presentation-screen.face","presentation-screen.chassis","integrated-led-face")
    add("presentation-screen.raceway","room-shell.front","wall-fixed-raceway")

    for side_name in ("left","right"):
        for index in range(4):
            key=f"acoustic-{side_name}-{index}"
            wall=f"room-shell.{side_name}"
            for batten in range(2):add(f"{key}.batten-{batten}",wall,"wall-fixed-batten")
            add(f"{key}.absorber",[f"{key}.batten-0",f"{key}.batten-1"],"two-batten-z-clip")
            for part in ("side-a","side-b","bottom","top"):
                add(f"{key}.{part}",f"{key}.absorber","cassette-frame-joint")

    for card in cards.values():
        object_id=card["objectId"]
        if not object_id.startswith("chair-seat-"):continue
        for side in (-1,1):
            for end in ("front","rear"):
                add(f"{object_id}.glide-{side}-{end}","audience-rug.body","glide-floor-contact")
                add(f"{object_id}.leg-{side}-{end}",f"{object_id}.glide-{side}-{end}","glide-stem-joint")
            add(f"{object_id}.frame-side-{side}",[f"{object_id}.leg-{side}-front",f"{object_id}.leg-{side}-rear"],"welded-side-frame")
            add(f"{object_id}.back-post-{side}",f"{object_id}.frame-side-{side}","welded-back-post")
            add(f"{object_id}.arm-post-{side}",f"{object_id}.frame-side-{side}","welded-arm-post")
            add(f"{object_id}.arm-rear-{side}",f"{object_id}.back-post-{side}","welded-rear-arm")
            add(f"{object_id}.arm-pad-{side}",[f"{object_id}.arm-post-{side}",f"{object_id}.arm-rear-{side}"],"two-point-arm-pad-fastener")
        for end in ("front","rear"):
            add(f"{object_id}.cross-{end}",[f"{object_id}.frame-side--1",f"{object_id}.frame-side-1"],"welded-cross-rail")
        add(f"{object_id}.seat-shell",[f"{object_id}.cross-front",f"{object_id}.cross-rear"],"bolted-seat-shell")
        add(f"{object_id}.seat-cushion",f"{object_id}.seat-shell","upholstery-on-shell")
        add(f"{object_id}.back-shell",[f"{object_id}.back-post--1",f"{object_id}.back-post-1"],"bolted-back-shell")
        add(f"{object_id}.back-cushion",f"{object_id}.back-shell","upholstery-on-shell")

    add("lectern.base","room-shell.floor","weighted-floor-base")
    add("lectern.column","lectern.base","bolted-column-base")
    add("lectern.mount","lectern.column","bolted-top-mount")
    add("lectern.top","lectern.mount","worktop-fasteners")
    add("lectern.lip","lectern.top","retaining-lip-joint")
    add("microphone.base","lectern.top","threaded-microphone-socket")
    add("microphone.neck","microphone.base","flex-neck-socket")
    add("microphone.capsule","microphone.neck","capsule-thread")
    add("presenter-floorbox.cover","room-shell.floor","recessed-floor-cover")
    add("presenter-floorbox.collar","presenter-floorbox.cover","connector-collar")
    add("presenter-floorbox.connector","presenter-floorbox.collar","locked-av-connector")
    add("microphone.cable",["microphone.base","presenter-floorbox.connector"],"terminated-signal-cable")
    add("presenter-notes.sheets","lectern.top","resting-paper-contact")
    for index in range(4):add(f"presenter-notes.print-{index}","presenter-notes.sheets","printed-ink-layer")

    add("av-cabinet.plinth","room-shell.floor","floor-bearing-plinth")
    add("av-cabinet.bottom","av-cabinet.plinth","carcass-base-joint")
    add("av-cabinet.left","av-cabinet.bottom","carcass-dowel-joint")
    add("av-cabinet.right-lower","av-cabinet.bottom","carcass-dowel-joint")
    for stile in ("right-front-stile","right-rear-stile"):
        add(f"av-cabinet.{stile}","av-cabinet.right-lower","vent-opening-stile")
    add("av-cabinet.right-upper",["av-cabinet.right-front-stile","av-cabinet.right-rear-stile"],"vent-opening-side-joint")
    add("av-cabinet.top",["av-cabinet.left","av-cabinet.right-upper"],"carcass-top-joint")
    add("av-cabinet.back",["av-cabinet.bottom","av-cabinet.top"],"fixed-backing")
    for index in range(7):
        add(f"av-cabinet.vent-blade-{index}",["av-cabinet.right-front-stile","av-cabinet.right-rear-stile"],"two-point-vent-blade")
    for side in (-1,1):
        for index in range(2):
            cabinet_side="av-cabinet.left" if side<0 else f"av-cabinet.right-{'lower' if index==0 else 'upper'}"
            add(f"av-cabinet.hinge-{side}-{index}",cabinet_side,"concealed-cabinet-hinge")
        add(f"av-cabinet.door-{side}",[f"av-cabinet.hinge-{side}-{index}" for index in range(2)],"two-hinge-door-support")
        for height in (.37,.53):add(f"av-cabinet.standoff-{side}-{height}",f"av-cabinet.door-{side}","pull-standoff")
        add(f"av-cabinet.pull-{side}",[f"av-cabinet.standoff-{side}-0.37",f"av-cabinet.standoff-{side}-0.53"],"two-standoff-pull")

    for side in (-1,1):
        add(f"room-ventilation.frame-{side}","room-shell.ceiling","recessed-ceiling-frame")
        for index in range(10):add(f"room-ventilation.slot-{side}-{index}",f"room-ventilation.frame-{side}","grille-slot-joint")

    for index in range(3):
        key=f"linear-light-{index}"
        for cable in range(2):
            add(f"{key}.canopy-{cable}","room-shell.ceiling","ceiling-anchor")
            add(f"{key}.cable-{cable}",f"{key}.canopy-{cable}","suspension-cable-clamp")
        add(f"{key}.housing",[f"{key}.cable-0",f"{key}.cable-1"],"two-cable-suspension")
        add(f"{key}.diffuser",f"{key}.housing","diffuser-retaining-channel")
    for side_name in ("left","right"):
        key=f"wall-wash-{side_name}"
        add(f"{key}.housing","room-shell.ceiling","recessed-ceiling-channel")
        add(f"{key}.diffuser",f"{key}.housing","diffuser-retaining-channel")

    runtime={obj.name:obj for obj in bpy.data.collections["Runtime"].objects if obj.type=="MESH" and obj.get("vrataBakePolicy")=="include" and not obj.get("vrataObjectId","").startswith("chair-seat-")}
    evidence={obj["vrataEvidencePartId"]:obj for obj in bpy.data.collections["ConstructionEvidence"].objects if obj.type=="MESH"}
    physical=set(runtime)|set(evidence)
    root="room-shell.floor"
    missing=sorted(physical-{root}-set(supports));extra=sorted(set(supports)-physical)
    if missing or extra:raise RuntimeError(f"support_graph_coverage:missing={missing}:extra={extra}")
    objects={**runtime,**evidence}
    for declaration in supports.values():
        for target in declaration["targets"]:
            if target not in physical:raise RuntimeError(f"support_target_missing:{declaration['part']}:{target}")
        obj=objects[declaration["part"]]
        obj["vrataSupportTargets"]=json.dumps(declaration["targets"],separators=(",",":"))
        obj["vrataSupportJoint"]=declaration["joint"]
    return supports
