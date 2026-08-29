# Local Review Contract

- This repository owns exactly one scene: `presentation-room-v1`.
- Keep all geometry, materials, lighting, and review imagery project-authored; do not import external assets or references.
- Blender authoring coordinates are semantic `(x,y,z)` and runtime positions are always `(x,y,-z)`.
- Release status remains `review` and human visual acceptance remains pending until explicitly recorded by a human.
- Rights are approved only for the public staging review scope recorded in `provenance/rights-status.json`; do not infer production activation or visual acceptance from that verdict.
- Never set release status `active`, visual acceptance, or `publicationReady=true` during local candidate work.
- Run `pnpm test && pnpm validate && pnpm inspect && pnpm verify:reproducibility` before handing off for visual review.
