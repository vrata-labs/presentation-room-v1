import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assert, fileRecord, materializeMetadataRelease, readJson, resolveBlenderExecutable, run, verifyBlender } from "./lib.mjs";
import { reviewRelease } from "./review-release-config.mjs";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "build/reproducibility-review");
const metadataFirst = join(output, "metadata-first");
const metadataSecond = join(output, "metadata-second");
const manifest = await readJson(join(root, "manifest.json"));
const metadataContract = await readJson(join(root, "source/metadata-release.json"));
const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
const bakedEvidence = await readJson(join(root, reviewRelease.provenancePath));
const historical = manifest.releases.find(({ version }) => version === "0.1.0");
const metadata = manifest.releases.find(({ version }) => version === "0.1.1");
const baked = manifest.releases.find(({ version }) => version === reviewRelease.version);
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];

assert(historical.files["scene.glb"].sha256 === sourceLock.reproducibility.sha256, "historical_reproducibility_pin_mismatch");
assert(JSON.stringify(await fileRecord(join(root, historical.releasePath, "scene.glb"))) === JSON.stringify(historical.files["scene.glb"]), "historical_release_glb_changed");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await materializeMetadataRelease(join(root, historical.releasePath), metadataFirst, metadataContract);
await materializeMetadataRelease(join(root, historical.releasePath), metadataSecond, metadataContract);

for (const name of requiredReleaseFiles) {
  const [first, second, published] = await Promise.all([
    readFile(join(metadataFirst, name)),
    readFile(join(metadataSecond, name)),
    readFile(join(root, metadata.releasePath, name))
  ]);
  assert(first.equals(second), `metadata_two_run_output_differs:${name}`);
  assert(first.equals(published), `metadata_rebuild_differs_from_release:${name}`);
  assert(JSON.stringify(await fileRecord(join(metadataFirst, name))) === JSON.stringify(metadata.files[name]), `metadata_rebuild_record_mismatch:${name}`);
}
process.stdout.write(`Historical evidence pin preserved and metadata-only 0.1.1 rebuilt byte-identically twice.\n`);

assert(baked?.reproducibility?.runs === 2 && baked.reproducibility.result === "byte-identical-glb", "baked_two_run_evidence_missing");
assert(baked.reproducibility.sha256 === reviewRelease.releaseGlbSha256, "baked_reproducibility_digest_mismatch");
assert(JSON.stringify(baked.reproducibility) === JSON.stringify(bakedEvidence.reproducibility), "baked_reproducibility_provenance_mismatch");
assert(JSON.stringify(await fileRecord(join(root, baked.releasePath, "scene.glb"))) === JSON.stringify(baked.files["scene.glb"]), "baked_release_glb_changed");
assert((await fileRecord(join(root, reviewRelease.acceptedLightmapPath))).sha256 === baked.reproducibility.lightmapSha256, "baked_reproducibility_atlas_changed");
const blender = resolveBlenderExecutable();
verifyBlender(blender);
assert((await fileRecord(blender)).sha256 === reviewRelease.blender.binarySha256, "blender_binary_digest_mismatch");
run(process.execPath, [join(root, "scripts/build-baked-review.mjs"), "--twice"], { cwd: root });
assert((await fileRecord(join(root, reviewRelease.buildOutputPath))).sha256 === baked.reproducibility.sha256, "baked_two_run_output_differs_from_release");
process.stdout.write(`${reviewRelease.version} actual two-run GLB export and immutable release bytes verified at sha256=${baked.reproducibility.sha256}.\n`);
