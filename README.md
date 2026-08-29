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

Both bundles use `renderMode: clean`, so runtime fallback floor, grid, room box,
and fog do not contaminate the authored composition. The metadata-only `0.1.1`
release also selects the `neutral-pbr` render profile.

## Pipeline

1. `source/scene-contract.json`, `source/review-candidate.blend`, and the
   pinned Blender scripts remain the historical authoring source for the
   byte-exact `0.1.0` review release.
2. `source/metadata-release.json` describes the metadata-only `0.1.1`
   derivation, including the runtime spawn heading and render profile.
3. Node tooling copies `scene.glb`, `preview.webp`, and `LICENSES.md` byte for
   byte from `0.1.0`, then deterministically generates only the new
   `scene.json`. It never deletes or rewrites the `0.1.0` catalog.
4. Reproducibility verification first uses pinned Blender 4.5.12 LTS build
   `84afd5f785f7` to export the saved Blend twice and compares both exports with
   the historical `0.1.0` GLB. It then builds the metadata-only release twice,
   compares every output byte with `0.1.1`, and compares all unchanged payload
   hashes with `0.1.0`.
5. A later human gate may accept visual quality. The immutable versioned paths
   do not record visual acceptance, immutable acceptance, production
   activation, or staging deployment.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm validate
pnpm inspect
BLENDER_BIN=/path/to/blender pnpm verify:reproducibility
```

The reproducibility command requires the pinned Blender binary with SHA-256
`33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880`.

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
```

`preview.webp` is the `entry` review view. All review images are 960x540 WebP
encoded by cwebp 1.6.0 at quality 90.
