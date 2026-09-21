import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { assertScratchOutput } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, process.argv[2]);
await assertScratchOutput(root, directory);
const repository = JSON.parse(await readFile(join(root, "scene-repository.json"), "utf8"));
const decision = await readFile(join(root, "docs/scene-0.4.1-task.md"), "utf8");
if (!decision.includes("Да, разрешаю review-публикацию")) throw new Error("explicit_review_publication_authorization_required");
const previous = join(root, "assets/scenes", repository.sceneId, "0.4.0");
const scene = JSON.parse(await readFile(join(previous, "scene.json"), "utf8"));
const glb = await readFile(join(directory, "scene.glb"));
scene.version = "0.4.1";
scene.glbSha256 = createHash("sha256").update(glb).digest("hex");
scene.status = "review";
scene.isCurrent = scene.publicationReady = false;
scene.humanAcceptance = "pending-human-acceptance";
scene.rights.approvalStatus = "approved-for-public-staging-review";
scene.rights.rightsApproved = true;
scene.rights.approvedBy = "human-rights-owner";
scene.rights.clearedFor = ["staging", "public-web-runtime", "screenshots", "publicly-downloadable-scene-bundle-redistribution"];
await writeFile(join(directory, "scene.json"), JSON.stringify(scene, null, 2)+"\n");
await copyFile(join(previous, "preview.webp"), join(directory, "preview.webp"));
await writeFile(join(directory, "LICENSES.md"), `# ${scene.label} 0.4.1 — rights for public staging review

- Release status: review; isCurrent=false; publicationReady=false.
- Rights status: approved-for-public-staging-review.
- License reference: LicenseRef-Project-Authored-Public-Staging-Review.
- Human visual acceptance: pending-human-acceptance.
- Release GLB SHA-256: ${scene.glbSha256}.

The user explicitly answered «Да, разрешаю review-публикацию» for the corrected
Personal and Presentation scenes using the existing documented Poly Haven CC0
inputs. This permits isolated public staging review, browser delivery, screenshots
and the scene-bundle download necessary for that review. It does not grant human
visual acceptance, current-release selection or production activation.

Geometry, original labels, material derivatives and authoring/review tooling are
project-authored. Previously documented Poly Haven photographic inputs retain
CC0-1.0 terms: https://polyhaven.com/license . Exact original inputs and attribution
remain recorded in source/releases/0.4.0/textures/source-ledger.json; the new
accepted source lock binds that earlier immutable source and the new derivatives.

This is a new, scoped review-publication decision for 0.4.1. It does not rewrite
the pending-rights or REWORK_REQUIRED records of 0.4.0 or earlier review versions.
`);
await writeFile(join(directory, "rights-review-authorization.json"), JSON.stringify({
  sceneId: repository.sceneId,
  releaseVersion: "0.4.1",
  glbSha256: scene.glbSha256,
  approvalStatus: "approved-for-public-staging-review",
  userDecision: "Да, разрешаю review-публикацию",
  scope: "Existing documented Poly Haven CC0 inputs and project-authored corrected scenes in isolated public staging review rooms; current rooms stay unchanged pending evaluation.",
  humanAcceptance: "pending-human-acceptance",
  isCurrent: false,
  publicationReady: false
}, null, 2)+"\n");
console.log(`${repository.sceneId}@0.4.1 review manifest prepared for ${scene.glbSha256}`);
