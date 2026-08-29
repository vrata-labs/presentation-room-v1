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

The bundle uses `renderMode: clean`, so runtime fallback floor, grid, room box,
and fog do not contaminate the authored composition.

## Pipeline

1. `source/author_scene.py` builds this scene from scratch with pinned Blender.
2. The authoring run saves `source/review-candidate.blend`, emits an initial
   GLB, and renders the four review views.
3. `source/export_scene.py` exports the saved Blend deterministically.
4. `source/render_review.py` renders the saved Blend independently.
5. Node tooling derives hashes and metrics, assembles the local `0.1.0`
   review bundle, validates it, inspects it, and verifies same-host two-run
   byte reproducibility.
6. A later human gate may accept visual quality. Production activation,
   immutable release, and staging deployment are deliberately out of scope
   here.

## Commands

```bash
pnpm install
BLENDER_BIN=/path/to/blender pnpm build
pnpm test
pnpm validate
pnpm inspect
BLENDER_BIN=/path/to/blender pnpm verify:reproducibility
```

If `BLENDER_BIN` is omitted, the scripts use `blender` from `PATH`.

The local review bundle contains exactly:

```text
assets/scenes/presentation-room-v1/0.1.0/scene.json
assets/scenes/presentation-room-v1/0.1.0/scene.glb
assets/scenes/presentation-room-v1/0.1.0/preview.webp
assets/scenes/presentation-room-v1/0.1.0/LICENSES.md
```

`preview.webp` is the `entry` review view. All review images are 960x540 WebP
encoded by cwebp 1.6.0 at quality 90.
