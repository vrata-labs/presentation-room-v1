# Local Review Contract

- This repository owns exactly one scene: `presentation-room-v1`.
- Prefer project-authored geometry and lighting. Cleared PBR/photographic inputs may be used with exact source/license/provenance and required rights approval; never import private or uncleared assets. Asset method does not lower the realistic quality target.
- Blender authoring coordinates are semantic `(x,y,z)` and runtime positions are always `(x,y,-z)`.
- Release status remains `review` and human visual acceptance remains pending until explicitly recorded by a human.
- Rights are approved only for the public staging review scope recorded in `provenance/rights-status.json`; do not infer production activation or visual acceptance from that verdict.
- Never set release status `active`, visual acceptance, or `publicationReady=true` during local candidate work.
- Run `pnpm test && pnpm validate && pnpm inspect && pnpm verify:reproducibility` before handing off for visual review.

## Shared scene-quality workflow

- Presentation Room 0.4.1 at `b6e0bcb1bb61136b5d7b4d6c05b4ea0032c7c787` was explicitly visually accepted by the user on 2026-09-21: `VISUALLY_ACCEPTED`. See `docs/reviews/2026-09-21-0.4.1-visual-acceptance.md`. Preserve this accepted quality in future revisions; immutable pre-review pending fields do not negate the later verdict. Rights and promotion remain separate gates.

- Read the [shared quality contract](https://github.com/vrata-labs/platform/blob/a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d/docs/scene-quality-contract.md) and fill the [task packet](https://github.com/vrata-labs/platform/blob/a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d/docs/scene-authoring-task-template.md) before every new or resumed scene task; record the revision and later applicable user feedback.
- Review every object/family and placement as User/Builder/Physics: real purpose/actions, approach, seated sightlines, assembly/joints, materials and actual support. Deferred/passive objects need plausible affordances, not mandatory runtime interaction.
- Inspect real source/browser images against the accepted Warm Modern Meeting 0.3.3 quality level. Realistic material finish and photographic-quality visible distant surroundings are mandatory unless the user explicitly requests another style. Technical passes and own-capture thresholds cannot prove this quality.
- 0.3.0 has no human visual acceptance. The 2026-09-19 cross-scene feedback requires a full shared-quality audit before another finished handoff; workflow outcome is `REWORK_REQUIRED` while that evidence is incomplete. Do not invent specific user rejection of this room from the Personal example.
- Preserve immutable artifacts; record later assessments separately and fix the scene in a new version. Apply general corrections to all in-scope scene tasks before moving on. Documentation-only updates do not require rebuilding unchanged scene binaries.
- 2026-09-20 shared feedback (Q8): inspect arrangements as the result of real use, not independent placed props. Apply reference-based group reasoning to audience seating/sightlines, presenter notes/microphone and AV/cable servicing. Regularity is valid when activity or construction explains it; random disorder is not a remedy. The book defect was observed in Personal, not claimed as an observed Presentation defect.
