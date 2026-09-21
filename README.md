# Presentation Room v1

## 0.4.1 — ready for user review

The current [0.4.1 review bundle](assets/scenes/presentation-room-v1/0.4.1/scene.json)
has 85,843 triangles and 219 render primitives. Continuous upholstery lightmap
charts preserve rounded cushions, plain-weave derivatives retain material detail,
and a closed masonry enclosure removes false construction seams. All eight seats
retain their measured sightlines and source-part construction evidence.

See the [source views](source/releases/0.4.1/review), [browser views](provenance/runtime-capture-0.4.1/clean),
[displayed moving frames](provenance/runtime-capture-0.4.1/normal-product/normal-media-frames.png)
and [quality assessment](provenance/releases/0.4.1/quality-review.json).
Local media evidence uses a generated stream with mock transport; public real
transport is checked separately on the published review room.

[Open the public review room](https://158.160.10.234.sslip.io/rooms/review-presentation-room-041-b6e0bcb1).
[Published-scene evidence](docs/staging/0.4.1/verification.json) includes all eight
seats and [moving frames through real transport](docs/staging/0.4.1/normal-media-frames.png).

Public staging review is explicitly authorized. Human visual acceptance remains
pending, isCurrent=false and publicationReady=false. The runtime/validator pin is
a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d. Historical checks execute their original
0.4.0 tooling snapshot; the current checkout also verifies every historical byte
and append-only record. Saved-source export repeatability is not a fresh bake proof.

## Historical 0.4.0 shared-quality review state

The 2026-09-19 feedback applies across scene types. Version `0.4.0` packages the
resulting source, geometry/support measurements, exact runtime captures, and
normal-product functional evidence under the [shared quality contract](https://github.com/vrata-labs/platform/blob/8ba49739d44518a3e877bc93432be591ce2e72da/docs/scene-quality-contract.md)
and [task packet](https://github.com/vrata-labs/platform/blob/8ba49739d44518a3e877bc93432be591ce2e72da/docs/scene-authoring-task-template.md)
without promoting the scene. The workflow outcome is `REWORK_REQUIRED`: chair
fabric/wood response still differs between source and runtime, cushion corners
remain visibly faceted, wall and ceiling join seams are more pronounced in the
runtime captures, the 117,619-triangle GLB exceeds the 90,000-triangle budget,
and no rendered screen-share frame is evidenced.

The clean evidence is one exact technical capture, not a three-run repeatability
claim or human quality verdict. Normal-product evidence verifies all eight
authoritative seat claim/release paths, movement locking, floor return, standing
movement, and screen-share object creation. It proves no displayed media frame.
Human visual acceptance and exact-byte rights approval remain pending.

Local review candidate for the Vrata product scene `presentation-room-v1`.
It is an original contemporary presentation salon with a level focal zone,
architectural 16:9 screen surround, eight audience seats in a shallow fan-shaped
row with two banks, center and side circulation, acoustic treatment, and warm
practical lighting.

This repository is intentionally not a visually accepted, current, or
publication-ready source. Human visual acceptance remains
`pending-human-acceptance`. Historical releases retain the public staging review
rights approval recorded on 2026-08-29. Human rights approval for the exact
`0.3.0` and `0.4.0` bytes is separately pending and no staging, runtime,
redistribution, or production permission is inferred from the historical verdict.

All bundles use `renderMode: clean`, so runtime fallback floor, grid, room box,
and fog do not contaminate the authored composition. The metadata-only
`0.1.1` release selects the `neutral-pbr` render profile. Immutable review
release `0.2.0` uses its accepted baked atlas and `baked-pbr-v1`. Review release
`0.3.0` is an append-only warm-modern material and lighting pass over unchanged
geometry. It uses a fresh versioned atlas and seven project-authored source
views. Three complete seven-view local runtime runs (21 PNG captures) are bound to exact `0.3.0` bytes and passed
their recorded PHASH/NCC technical regression thresholds. This result is not
human visual acceptance. Human acceptance, current-release selection,
publication readiness, and production activation remain false.

## Pipeline

1. `source/scene-contract.json`, `source/review-candidate.blend`, and the
   pinned Blender scripts remain the historical authoring source for the
   byte-exact `0.1.0` review release.
2. `source/metadata-release.json` describes the metadata-only `0.1.1`
   derivation, including the runtime spawn heading and render profile.
3. Historical Node tooling copies `scene.glb`, `preview.webp`, and `LICENSES.md` byte for
   byte from `0.1.0`, then deterministically generates only the new
   `scene.json`. It never deletes or rewrites the `0.1.0` catalog.
4. Reproducibility verification first uses pinned Blender 4.5.12 LTS build
   `84afd5f785f7` to export the saved Blend twice and compares both exports with
   the historical `0.1.0` GLB. It then builds the metadata-only release twice,
   compares every output byte with `0.1.1`, and compares all unchanged payload
   hashes with `0.1.0`.
5. `source/export_baked_review.py` prepares a second UV set for every visible
   mesh, transports baked irradiance through emissive texture metadata, and
   exports the full visible scene graph while excluding cameras and lights.
6. `scripts/build-baked-review.mjs` can generate an unaccepted atlas under
   `build/` with `--bake`, deterministically rebuild a GLB twice from the
   accepted atlas, and materialize a new version path once without invoking
   Blender. A supported bake must use the configured CUDA device; the Node
   wrapper and Blender exporter reject CPU bake requests, and the exporter also
   fails when Blender discovers no CUDA device. No-bake export may use CPU or
   the configured value because it does not create an atlas.
7. Versioned technical regression thresholds cover every runtime capture view.
   Passing them does not satisfy the separate human visual-acceptance gate.
8. `source/releases/0.3.0` contains the exact versioned Blend, author/export
   scripts, fresh 2048px CUDA-baked atlas, scene-reality contract, user
   scenarios, and seven source review views for the warm-modern pass.
9. `scripts/materialize-release-0.3.mjs` verifies those inputs and writes the
   four-file `0.3.0` bundle, source lock, acceptance index, and versioned
   provenance transactionally. The release remains non-current, binds passing
   technical runtime evidence, and records exact-byte rights and human visual
   acceptance as pending.
10. A later human gate may accept visual quality. The immutable versioned paths
    do not record visual acceptance, immutable acceptance, production
    activation, or staging deployment.
11. `source/releases/0.4.0` freezes the authored and baked Blend files, filtered
    atlas, raw GLB, exact capture harness/config, object registry, 225-mesh/385-part
    measurements, sixteen source views, and the truthful visual gate state.
12. `scripts/materialize-release-0.4.mjs` writes the exact four-file `0.4.0`
    bundle and keeps clean visual evidence separate from normal-product evidence.
    Its validators require the unresolved triangle, media-frame, visual, rights,
    and human gates to remain explicit.

## Commands

```bash
pnpm install
pnpm validate:visual
pnpm test
pnpm validate
pnpm inspect
pnpm verify:reproducibility
```

The Blender and visual-review commands are:

```bash
BLENDER_BIN=/path/to/blender pnpm bake:review
BLENDER_BIN=/path/to/blender pnpm build
BLENDER_BIN=/path/to/blender pnpm verify:baked-blender
```

The default reproducibility command exports `0.4.0` twice from the accepted
baked source and filtered atlas, applies the pinned tangent/Meshopt finalization,
and compares both raw and final outputs with the materialized bytes. Historical
rebuilds remain available through `pnpm verify:historical-0.3` and
`pnpm verify:historical-blender`. Reproducibility requires the pinned Blender binary SHA
`33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880`.

Each accepted atlas is recorded authoring evidence with the pinned CUDA bake
contract: 2048px, 128 samples, and scale 0.25. Historical `0.2.0` uses baked
light-map intensity 4; `0.3.0` records intensity 5.2.
Materialization verifies and records that contract and the accepted atlas hash;
it does not claim to perform or re-verify the bake. Historical `0.2.0` runtime
evidence loaded the release in 764ms with 10/10 light-mapped materials, 32,060 triangles, zero
missing assets, and dark-pixel ratio 0.046. Technical visual parity passed at
aggregate PHASH 399.7405 and NCC 0.3496815 against final thresholds 430 and
0.31 respectively.

Committed clean-checkout evidence lives in
`provenance/runtime-capture-0.2.0`. Historical coverage in `pnpm test` reads those
four PNGs and recomputes ImageMagick metrics. `pnpm validate:visual` validates
the three seven-view `0.3.0` runs. `scene-debug.json` uses normalized
`local-capture/*` URLs; provenance records every evidence path, SHA-256, size,
capture setting, and normalization policy. The `0.2.0` bundle preview is copied
from this evidence set rather than inherited from `0.1.1`.

The `0.3.0` evidence lives in `provenance/runtime-capture-0.3.0` and contains
three candidate-local full seven-view runs: 21 exact PNGs, normalized per-run
diagnostics, capture settings, measured visual parity, stability evidence, and
a repeated local capture record. All three runs are byte-identical per
view. They bind the exact GLB and scene manifest to platform commit
`c54edb2239d225a71e9b934316f70792b3faafb6`. The runtime application build was
unmodified; the versioned capture-only harness patch records timeout, view
isolation, HUD/self-mesh suppression, and media surface normalization. Runtime
diagnostic dark-pixel ratio is 0.279, entry is 0.05126736, and screen-detail is
0.09405093. Aggregate PHASH is 522.7959 against a maximum of 580; aggregate NCC
is 0.5510997142857144 against a minimum of 0.51. The bounds are derived from
the worst result across all three runs plus the recorded absolute and rounding
margins.

Each `capture-binding.json` is a candidate-local capture record. The `0.3.0` binding
also binds all three complete runs and their stability result. It binds capture
to the exact release GLB and scene manifest, versioned capture plan, platform
capture implementation commit, diagnostics, and capture-file records. It
does not prove independent execution and is not human visual acceptance. Candidate CI validates the committed artifacts; independent execution is deferred to exact-merge-SHA staging verification. Visual provenance records the local
ImageMagick version. Revalidation allows only the documented absolute
tolerances: PHASH 0.001 per view and 0.004 aggregate for four-view `0.2.0` or
0.007 aggregate for seven-view `0.3.0`, plus NCC 0.000001. Exact evidence hashes
and all per-view and aggregate thresholds remain mandatory.

Uncommitted rematerialization validates every input and builds the complete
release, provenance, and manifest under `build/` before moving existing
untracked candidates to a rollback backup. A failed validation leaves the
current release and provenance untouched; a failed install restores them.

`pnpm test` runs all repository suites. Historical tests validate immutable file,
release, rights, validator-pin, and rollback evidence in the append-only history;
the `0.3.0` suite covers the candidate bundle, source lock, reality semantics,
visual evidence, and provenance.

CI installs ImageMagick, verifies the pinned Blender archive and executable
hashes, performs visual validation, and runs the actual two-export no-bake
reproducibility check. Existing release paths, versioned `0.3.0` source and
provenance, accepted versioned atlases, baked provenance, and runtime-capture
evidence are immutable after their first addition. Pull-request and push workflows compare against the event
base SHA and fail closed if that stable baseline is missing or all-zero. Manual
workflow dispatch is intentionally unsupported because it has no stable
publication baseline.

The local review catalog contains exactly four files in each release:

```text
assets/scenes/presentation-room-v1/0.1.0/scene.json
assets/scenes/presentation-room-v1/0.1.0/scene.glb
assets/scenes/presentation-room-v1/0.1.0/preview.webp
assets/scenes/presentation-room-v1/0.1.0/LICENSES.md
assets/scenes/presentation-room-v1/0.1.1/scene.json
assets/scenes/presentation-room-v1/0.1.1/scene.glb
assets/scenes/presentation-room-v1/0.1.1/preview.webp
assets/scenes/presentation-room-v1/0.1.1/LICENSES.md
assets/scenes/presentation-room-v1/0.2.0/scene.json
assets/scenes/presentation-room-v1/0.2.0/scene.glb
assets/scenes/presentation-room-v1/0.2.0/preview.webp
assets/scenes/presentation-room-v1/0.2.0/LICENSES.md
assets/scenes/presentation-room-v1/0.3.0/scene.json
assets/scenes/presentation-room-v1/0.3.0/scene.glb
assets/scenes/presentation-room-v1/0.3.0/preview.webp
assets/scenes/presentation-room-v1/0.3.0/LICENSES.md
assets/scenes/presentation-room-v1/0.4.0/scene.json
assets/scenes/presentation-room-v1/0.4.0/scene.glb
assets/scenes/presentation-room-v1/0.4.0/preview.webp
assets/scenes/presentation-room-v1/0.4.0/LICENSES.md
```

Historical previews remain byte-exact. The `0.2.0` preview is the final runtime
entry capture stored with its committed evidence. The `0.3.0` preview is copied
from its source `entry` review image rather than from the separately bound
runtime `entry` capture.
