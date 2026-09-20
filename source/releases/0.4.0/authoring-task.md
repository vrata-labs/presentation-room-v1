# Presentation Room 0.4.0 authoring task

Outcome: REWORK_REQUIRED; no human visual acceptance.
Base: 648759c79619d5d746067e99b418051468ef2979.
Shared quality contract: platform 8ba49739d44518a3e877bc93432be591ce2e72da.
Visual benchmark: WMMR 0.3.3, 5580a7b080cf6195e28ebc77b654fd71111b0cd1.
Inspected benchmark images: diagonal-overview, table-underside and window-detail.

## Brief

A compact contemporary eight-person presentation salon with a credible acoustic
wall system, comfortable upholstered chairs, a properly mounted 16:9 display,
speaker's lectern and accessible circulation. Warm wood, neutral woven textiles,
mineral walls and restrained architectural lighting; avoid a toy theatre made of
oversized colored blocks. Preserve eight seat IDs and debug-main surface.

## Observed defects and corrections

| ID | Observed in 0.3.0/source | Required correction |
| --- | --- | --- |
| R1 | Bulky colored screen piers/fins and furniture | Dimensioned veneer, fabric acoustic cassettes and real screen mount |
| R2 | Same coarse waviness/finish over unrelated materials | Substrate-specific grain, weave, roughness and correct texture scale |
| R3 | Ceiling rafts lack an enclosing ceiling/clear support story | Closed ceiling, believable slim luminaires, suspension/support and service details |
| R4 | Chair arms/back/legs need real ergonomic assembly | Coherent frame, cushioned shell, arm attachment and foot contacts |
| R5 | Large empty room and decorative glowing aisle markers | Human-scaled layout, unobstructed center/side aisles, useful clear floor |
| R6 | Lectern screen/control shapes lack readable physical intent | Angled worktop/lip, microphone, cable route and stable base |
| R7 | Solid storage blocks | Board-built cabinet, doors/reveals/handles and ventilation for AV |

## Requirement coverage

| ID | Implementation/evidence obligation | Status |
| --- | --- | --- |
| Q1 | Paired entry, all eight seated views, presenter, overview, materials/joints | pending |
| Q2 | Each chair, screen, lectern, AV cabinet, door, acoustic panel family and light assembly | pending |
| Q3 | Actual attachment/contact and usable dimensions on final geometry | pending |
| Q4 | Eight seats and main media interactive; lectern/microphone/cabinet hardware plausibly deferred | pending |
| Q5 | Approach/sit/stand for every seat, full screen visibility, presenter route | pending |
| Q6 | Not applicable: intentionally windowless, controlled-light presentation room; no fake exterior | justified in brief |
| Q7 | Same accepted realism floor as Personal/WMMR, distinct room composition | applied to brief |

## Real use and construction

- Audience enters at the rear, reaches either bank without climbing or crossing
  another chair, sits at 0.46-0.49 m and sees the complete presentation surface.
  Check real standing/seated eye points and front-row obstruction, not anchor
  equality. Chair backs/arms/legs belong to an actual assembled frame.
- Presenter reaches the lectern and screen through a level route. A tone/material
  boundary may mark the presentation area without a gratuitous raised trip step.
  Lectern top/lip retains paper or laptop, microphone is mounted, cables lead down
  the column into a floor box, stable base supports the assembly.
- Screen is mounted on brackets at a usable viewing height, with an opaque backing
  behind (never in front of) the runtime media surface. AV cabinet has usable
  doors, hinges, ventilated equipment space and cable management.
- Acoustic wall cassettes are fabric-covered absorbers on battens/clips, correctly
  scaled and attached. Ceiling luminaires have housings/diffusers and ceiling mounts;
  no unexplained floating beams or fake emissive floor decorations.

## Evidence plan

Entry, all eight seated display views, presenter, diagonal-overview, chair-detail,
chair-underneath, lectern-detail, acoustic-detail and door-detail. Inspect source
and browser in comparable cameras and also normal media mode. Record physical
measurements and actual ray tests. Iterate materials/lighting to the inherited
target before freezing any new technical baseline.

## Layout decision before detailed authoring

Replace the old two-row layout with one shallow fan-shaped row of eight chairs
in two banks. This removes front-row occupants from rear-row sightlines rather
than validating an empty room only. A level central aisle and rear approach remain;
the speaker zone is also level. The eight seat IDs and main media binding remain.
The new room is 9.4 x 8.0 x 3.6 m, with closed ceiling and actual fixture mounts.
Carry the Personal first-render correction into this room: satin wood finish,
moderate wood normal strength and substrate-specific cloth treatment.

## Draft image and construction criticism, iteration 1

Entry/overview source images inspected: recognizable conference chairs, enclosed
ceiling, thin mounted lights and substrate-specific materials replace the old
oversized decorative forms. Still DRAFT. Geometry measurements exposed 9.5-21 mm
gaps in acoustic cassette frames and a 20 mm screen-bracket/wall gap. Closed the
joints and extended the bracket depth to reach masonry rather than merely naming
the assemblies. Also corrected backrest tilt/support, lowered seats to 482.5 mm
and seated the wall-wash housings against the ceiling. All 40 sampled seated
screen rays were clear in the preliminary model; rerun after final geometry.

Narrow-phase contacts found the paper hovering over the lectern despite an AABB
overlap. The worktop now inclines toward the speaker, the retaining lip is on its
low edge, and notes/microphone mounts are positioned in the actual tilted worktop
coordinate frame. The notes contain readable project-authored agenda text.
The HDR-preserving/denoised lightmap transfer and complete-irradiance environment
handling discovered on Personal also apply here; fixed-scale clipping is rejected.

The shared capture correction also applies here: convert the full yaw/pitch
camera offset to the rig origin and assert actual eye position/direction. Real
seat-claim views are recorded separately from anatomical seated reference views.

## 2026-09-20 normal-product gate

Runtime tested: platform d9eaa25f52bc5ef1bdd8622d83b22a09dc81f84a.
Current diagnostic GLB: c64db35810448308cef11332c7485f32870048205fe617544cb06e9096cdf8a5,
17,933,280 bytes. This is an unaccepted diagnostic artifact, not an immutable release.

- Regenerated bake/export and completed all 16 source and 16 paired clean browser
  views, asserting actual camera world position/direction and browser response SHA.
  Khronos validation has zero errors/warnings; unused tangent informational messages
  remain. Estimated RGBA texture memory with mipmaps is 80 MiB.
- Chair material assemblies reduce mesh count from 367 to 207 without changing the
  chair layout. Each exported assembly keeps object/part provenance tags. The original
  constituent-part coverage still needs preservation and component-level construction
  checks: joining geometry must not conceal unsupported components.
- All eight server-authoritative seat claims/releases were observed by a second
  participant; seated movement lock worked. Every real seated camera was at
  y=2.083m, about 1.6m above a 0.4825m cushion, versus the designed 1.20m seated eye.
  This blocks Q4/Q5 even though the 40 source sightline rays are clear.
- debug-main has matching physical/logical geometry and accepts a screen-share
  object. This proves object lifecycle only: no actual shared media frames were
  supplied, so it is not proof of playable content or completed media QA.
- Post-release floor pose requires an explicit assertion; server occupancy removal
  alone is insufficient. The initial standing-movement origin was assumed rather
  than measured, so it is not evidence of correct teleport placement. The final
  strengthened local run failed floor-placement checks for all eight anchors:
  occupancy clears but the sampled root remains at the old seated position rather
  than the requested spawn floor point. Investigate command/frame ordering and the
  test helper before attributing the result to every normal user input path.
- Assembly-constrained contact screening reports 207/207, not a final per-part
  Builder/Physics pass. Routes currently exclude the target chair from obstruction
  tests; seated approach/stand-up envelopes still require an independent check.
- Actual source/browser chair-detail images show different weave/wood response and
  faceting at cushion corners. Fidelity/quality needs further material inspection;
  successful camera pairing does not constitute a visual acceptance verdict.

Evidence is in build/redesign-0.4.0/runtime-040-normal and runtime-040-clean-1;
the runtime harness is scene-quality-0.4-local.spec.ts. No immutable acceptance
index, rights approval, human visual acceptance, or promotion is created here.

Independent re-export of the same saved review source and diagnostic atlas is
byte-identical to the current diagnostic GLB (cmp passed). This is same-host saved
source export repeatability, not a fresh author/bake reproducibility result. The
pinned WMMR diagonal-overview image was fetched and re-inspected; no new human
quality verdict was received.

## Platform correction follow-up

Platform PR #98 was admin-merged as dcd6bdd49280a57a819bc30ff0aac171644097ec.
The subsequent runtime fixes are in platform PR #100, commit
dfb2f73151d93b1f7bfdf1d5b7bbd56074656bf1. The local normal-product run against
that implementation passed for all eight seats: the seated eye is about 1.203m,
occupancy is observed by a second participant, and the post-release floor pose
matches the requested point. The diagnostic output is runtime-040-normal-fixed.
The stale-snapshot suppression prevents released occupancy from re-locking the
rig during the round trip to room-state.

The scene remains REWORK_REQUIRED for constituent-part construction/support,
complete approach/stand-up and visual evidence, actual presentation media content,
and release packaging. Admin merge permission is not exact-byte rights approval,
human visual acceptance or scene promotion.

Platform PR #100 was admin-merged as c6343de81b038b7937addac44c24fa7c46adf341.
Its normal pipeline staging run 35512150893 passed on retry after a pre-rollout
SSH disconnect: 39/39 staging e2e plus the blocking Rutube test. Running API and
room-state image tags were independently confirmed at that SHA. The new public
normal-product regression passed with an inline platform fixture. This verifies
the platform correction on staging, not public delivery of these private 0.4.0 bytes.

## Irradiance speckle correction

Paired source/browser inspection isolated the visible presenter-wall and ceiling
speckle to the baked irradiance atlas. Raising Cycles from 96 to 384 samples did not
materially improve the browser result. A deterministic 5x5 median post-filter after
the Blender compositor denoise removes the speckle while preserving contact shadows,
so the accepted pipeline keeps 96 samples. Filtered 96- and 384-sample browser views
differ by RMSE 0.00302 at presenter and 0.00325 at diagonal-overview. The filter uses
ImageMagick 6.9.12-98 Q16 and is now part of denoise-atlas.py rather than an
unrecorded diagnostic command. This technical correction does not constitute human
visual acceptance.
