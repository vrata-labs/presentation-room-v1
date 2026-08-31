# Presentation Room v1

Local review candidate for the Vrata product scene `presentation-room-v1`.
It is an original contemporary presentation salon with a raised focal zone,
architectural 16:9 screen surround, eight audience seats in two staggered
rows, generous center and side circulation, acoustic treatment, and warm
practical lighting.

This repository is intentionally not a visually accepted, current, or
publication-ready source. Human visual acceptance remains
`pending-human-acceptance`. The human rights owner approved the entirely
project-authored scene on 2026-08-29 for the public staging review uses listed
in `provenance/LICENSES.review.md`.

Both existing bundles use `renderMode: clean`, so runtime fallback floor, grid,
room box, and fog do not contaminate the authored composition. The metadata-only
`0.1.1` release selects the `neutral-pbr` render profile. Immutable review
release `0.2.0` uses the accepted baked atlas and `baked-pbr-v1`. Local runtime
loading and four-view ImageMagick technical regression checks pass with final
thresholds. These technical checks do not record human visual acceptance, so
current-release selection, publication readiness, and production activation
remain false.

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
7. Final technical regression thresholds cover entry, audience, presenter, and
   diagonal-overview captures. Passing them does not satisfy the separate human
   visual-acceptance gate.
8. A later human gate may accept visual quality. The immutable versioned paths
   do not record visual acceptance, immutable acceptance, production
   activation, or staging deployment.

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
SCENE_LIGHTMAP=source/baked-review-lightmap-0.2.0.png BLENDER_BIN=/path/to/blender pnpm build
BLENDER_BIN=/path/to/blender pnpm verify:baked-blender
```

The separate `pnpm verify:historical-blender` command retains the original
Blender 4.5.12 LTS byte-for-byte verification for `0.1.0`. The default
reproducibility command verifies historical evidence, rebuilds metadata-only
`0.1.1` twice, exports `0.2.0` twice from the accepted atlas, and compares both
outputs with immutable `0.2.0` bytes. It requires the pinned Blender binary SHA
`33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880`.

The accepted atlas is recorded authoring evidence with the pinned CUDA bake
contract: 2048px, 128 samples, scale 0.25, and baked light-map intensity 4.
Materialization verifies and records that contract and the accepted atlas hash;
it does not claim to perform or re-verify the bake. Local runtime loaded the
release in 764ms with 10/10 light-mapped materials, 32,060 triangles, zero
missing assets, and dark-pixel ratio 0.046. Technical visual parity passed at
aggregate PHASH 399.7405 and NCC 0.3496815 against final thresholds 430 and
0.31 respectively.

Committed clean-checkout evidence lives in
`provenance/runtime-capture-0.2.0`. `pnpm validate:visual` reads those four PNGs
by default and recomputes ImageMagick metrics. `scene-debug.json` uses normalized
`local-capture/*` URLs; provenance records every evidence path, SHA-256, size,
capture setting, and normalization policy. The `0.2.0` bundle preview is copied
from this evidence set rather than inherited from `0.1.1`.

`capture-binding.json` is a local capture attestation. It binds the capture to
the exact `0.2.0` GLB and scene manifest, historical review config, platform
capture implementation commit, diagnostics, and capture-file records. It is
explicitly not human visual acceptance. Visual provenance records the local
ImageMagick version. Revalidation allows only the documented absolute
tolerances (PHASH 0.001 per view/0.004 aggregate and NCC 0.000001) while still
requiring exact evidence hashes and all per-view and aggregate thresholds.

Uncommitted rematerialization validates every input and builds the complete
release, provenance, and manifest under `build/` before moving existing
untracked candidates to a rollback backup. A failed validation leaves the
current release and provenance untouched; a failed install restores them.

`pnpm test` intentionally runs `tests/review-release.test.mjs`. The historical
`tests/repository.test.mjs` is retained byte-exact as locked evidence but assumes
the old top-level `0.1.1` version. The active suite repeats its historical file,
tooling, source, metadata-output, rights, and validator-pin integrity checks,
then adds `0.2.0` release, runtime-evidence, visual, and CI coverage.

CI installs ImageMagick, verifies the pinned Blender archive and executable
hashes, performs visual validation, and runs the actual two-export no-bake
reproducibility check. Existing release paths, accepted versioned atlases,
versioned baked provenance, and runtime-capture evidence are immutable after
their first addition. Pull-request and push workflows compare against the event
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
```

Historical previews remain byte-exact. The `0.2.0` preview is the final runtime
entry capture stored with its committed evidence.
