import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  assert,
  fileRecord,
  materializeMetadataRelease,
  readJson,
  resolveBlenderExecutable,
  run,
  sha256,
  verifyBlender
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = await readJson(join(root, "manifest.json"));
const releaseContract = await readJson(join(root, "source/metadata-release.json"));
const historicalLock = await readJson(join(root, "source/review-candidate-lock.json"));
const historicalRelease = manifest.releases.find(({ version }) => version === releaseContract.baseVersion);
const metadataRelease = manifest.releases.find(({ version }) => version === releaseContract.version);
const blender = resolveBlenderExecutable();
const output = join(root, "build/reproducibility");
const historicalFirst = join(output, "historical-first.glb");
const historicalSecond = join(output, "historical-second.glb");
const metadataFirst = join(output, "metadata-first");
const metadataSecond = join(output, "metadata-second");
const historicalPath = join(root, historicalRelease.releasePath);
const publishedPath = join(root, metadataRelease.releasePath);
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];

verifyBlender(blender);
const blenderRecord = await fileRecord(blender);
assert(blenderRecord.sha256 === releaseContract.historicalReproducibility.blenderBinarySha256, `blender_binary_hash_mismatch:${blenderRecord.sha256}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of [historicalFirst, historicalSecond]) {
  run(blender, [
    "--background",
    join(root, "source/review-candidate.blend"),
    "--python",
    join(root, "source/export_scene.py"),
    "--",
    "--output",
    path
  ]);
}

const [historicalFirstBytes, historicalSecondBytes, publishedHistoricalBytes] = await Promise.all([
  readFile(historicalFirst),
  readFile(historicalSecond),
  readFile(join(historicalPath, "scene.glb"))
]);
const historicalDigest = sha256(historicalFirstBytes);
assert(historicalFirstBytes.equals(historicalSecondBytes), "same_host_two_run_glb_not_byte_identical");
assert(historicalFirstBytes.equals(publishedHistoricalBytes), `reproducible_glb_differs_from_historical_release:${historicalDigest}`);
assert(historicalDigest === historicalLock.reproducibility.sha256, `reproducible_glb_differs_from_historical_lock:${historicalDigest}`);
assert(historicalDigest === historicalRelease.files["scene.glb"].sha256, `reproducible_glb_differs_from_manifest:${historicalDigest}`);
process.stdout.write(`Historical Blender reproducibility passed: two byte-identical exports sha256=${historicalDigest}\n`);

await materializeMetadataRelease(historicalPath, metadataFirst, releaseContract);
await materializeMetadataRelease(historicalPath, metadataSecond, releaseContract);

for (const name of requiredReleaseFiles) {
  const [firstBytes, secondBytes, publishedBytes] = await Promise.all([
    readFile(join(metadataFirst, name)),
    readFile(join(metadataSecond, name)),
    readFile(join(publishedPath, name))
  ]);
  assert(firstBytes.equals(secondBytes), `metadata_two_run_output_differs:${name}`);
  assert(firstBytes.equals(publishedBytes), `metadata_rebuild_differs_from_release:${name}`);
  assert(JSON.stringify(await fileRecord(join(metadataFirst, name))) === JSON.stringify(metadataRelease.files[name]), `metadata_rebuild_record_mismatch:${name}`);
}
for (const name of releaseContract.unchangedFiles) {
  assert(JSON.stringify(await fileRecord(join(metadataFirst, name))) === JSON.stringify(historicalRelease.files[name]), `historical_payload_not_preserved:${name}`);
}

process.stdout.write(`Metadata reproducibility passed: two byte-identical builds for ${manifest.sceneId}@${metadataRelease.version}\n`);
