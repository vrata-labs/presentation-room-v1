import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import sharp from "sharp";

import { createMetadataSceneManifest, fileRecord, glbInspection, readJson, toRuntimePosition } from "../scripts/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const historicalValidatorCommit = "9153bb9818a2907fb33ba96375f7b31c1641f12f";
const metadataValidatorCommit = "61736f6289f941e290f4fe156f17efdd64ef876b";
const approvedRightsStatus = "approved-for-public-staging-review";
const rightsApprovalDate = "2026-08-29";
const licenseRef = "LicenseRef-Vrata-Public-Staging-Review-2026-08-29";
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
const historicalFileRecords = {
  "LICENSES.md": { sha256: "42a4d1ca687ca375f38db222e4fe7c3ed99af9dca4730f288cc910daf3df9d1b", sizeBytes: 836 },
  "preview.webp": { sha256: "2e5880e76d6ef1136aabdf8c8ef1eea999be0bad6415ab57997f2ec4ac61ff88", sizeBytes: 33512 },
  "scene.glb": { sha256: "1c44b52b9f70ecad9401b703176c460b6a909e3f22b2566a98caedb4a0c90a63", sizeBytes: 2142756 },
  "scene.json": { sha256: "0bf3f15a068a1edf735f48d05c2bec17d1b1878aa75b2dd0e2847065857e0115", sizeBytes: 4947 }
};
const historicalEvidenceRecords = {
  "source/scene-contract.json": { sha256: "2a6b41e3de3e6821c2b8d34bec52c7847a5b78c6ff1f16b528078a450d3e5cd2", sizeBytes: 5957 },
  "source/scene-contract-lock.json": { sha256: "8d33d5fa9a2d20c88886589b873e41de652a6104196e1b285441beb65a913e61", sizeBytes: 586 },
  "source/review-candidate-lock.json": { sha256: "a51706b416ce925750bd6918a96ce74bf9242167072daa513eff11538216ef0e", sizeBytes: 4451 },
  "provenance/asset-ledger.json": { sha256: "73db387dc2c90d3b109230adccac64b639ac810aa3be4b72022c520ed6d33ab0", sizeBytes: 5799 },
  "provenance/generation-ledger.json": { sha256: "d0ac8195d521007c385abbdcf5bedefe849afab035bfb859228a6c0c2ce1f36d", sizeBytes: 3418 }
};
const historicalMetadataLockRecord = { sha256: "b80eab78d8269355720f4c0973e6a683f8ba74d0780b873e7abe011e9b64c48f", sizeBytes: 7464 };

test("repository points to 0.4.0 while all review releases remain non-current", async () => {
  const config = await readJson(join(root, "scene-repository.json"));
  const packageJson = await readJson(join(root, "package.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  const lock = (await readFile(join(root, "platform-validator.lock"), "utf8")).trim();
  assert.equal(config.sceneId, "presentation-room-v1");
  assert.equal(config.oneSceneOnly, true);
  assert.equal(config.releaseVersion, "0.4.0");
  assert.equal(packageJson.version, "0.4.0");
  assert.equal(config.status, "review");
  assert.equal(config.humanAcceptance, "pending-human-acceptance");
  assert.equal(config.rightsStatus, "pending-human-rights-approval");
  assert.equal(config.rightsApproved, false);
  assert.equal(config.rightsApprovalDate, null);
  assert.equal(config.licenseRef, null);
  assert.equal(config.platformValidatorCommit, "c6343de81b038b7937addac44c24fa7c46adf341");
  assert.equal(lock, "c6343de81b038b7937addac44c24fa7c46adf341");
  assert.equal(manifest.platformValidatorCommit, "c6343de81b038b7937addac44c24fa7c46adf341");
  assert.deepEqual(manifest.releases.map(({ version }) => version), ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0"]);
  assert.ok(manifest.releases.every(({ status, humanAcceptance, isCurrent, publicationReady }) =>
    status === "review" && humanAcceptance === "pending-human-acceptance" && isCurrent === false && publicationReady === false));
  assert.equal(manifest.releases[0].platformValidatorCommit, historicalValidatorCommit);
  assert.equal(manifest.releases[1].platformValidatorCommit, metadataValidatorCommit);
  assert.deepEqual(await readdir(join(root, "assets/scenes")), ["presentation-room-v1"]);
  assert.deepEqual((await readdir(join(root, "assets/scenes/presentation-room-v1"))).sort(), ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0"]);
});

test("0.1.0 remains the byte-exact historical authoring release", async () => {
  const contract = await readJson(join(root, "source/scene-contract.json"));
  const contractLock = await readJson(join(root, "source/scene-contract-lock.json"));
  const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
  const releasePath = join(root, "assets/scenes/presentation-room-v1/0.1.0");
  assert.equal(contract.version, "0.1.0");
  assert.equal(sourceLock.version, "0.1.0");
  assert.equal(contract.toolchain.platformValidatorCommit, historicalValidatorCommit);
  assert.equal(contractLock.platformValidatorCommit, historicalValidatorCommit);
  assert.equal(sourceLock.toolchain.platformValidatorCommit, historicalValidatorCommit);
  assert.deepEqual((await readdir(releasePath)).sort(), requiredReleaseFiles);
  for (const name of requiredReleaseFiles) {
    assert.deepEqual(await fileRecord(join(releasePath, name)), historicalFileRecords[name]);
    assert.deepEqual(sourceLock.release.files[name], historicalFileRecords[name]);
  }
  for (const [repositoryPath, expected] of Object.entries(historicalEvidenceRecords)) {
    assert.deepEqual(await fileRecord(join(root, repositoryPath)), expected);
  }
});

test("metadata-only 0.1.1 has neutral PBR and faces the runtime screen with Three -Z forward", async () => {
  const contract = await readJson(join(root, "source/scene-contract.json"));
  const releaseContract = await readJson(join(root, "source/metadata-release.json"));
  const historicalScene = await readJson(join(root, "assets/scenes/presentation-room-v1/0.1.0/scene.json"));
  const scene = await readJson(join(root, "assets/scenes/presentation-room-v1/0.1.1/scene.json"));
  const runtimeSpawn = scene.spawnPoints[0];
  assert.equal(releaseContract.releaseKind, "metadata-only-review");
  assert.equal(releaseContract.baseVersion, "0.1.0");
  assert.equal(releaseContract.platformValidatorCommit, metadataValidatorCommit);
  assert.deepEqual(releaseContract.historicalReproducibility, {
    blenderVersion: "4.5.12 LTS",
    blenderBuildHash: "84afd5f785f7",
    blenderBinarySha256: "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
  });
  assert.equal(scene.version, "0.1.1");
  assert.equal(scene.status, "review");
  assert.equal(scene.humanAcceptance, "pending-human-acceptance");
  assert.equal(scene.isCurrent, false);
  assert.equal(scene.publicationReady, false);
  assert.equal(scene.renderProfile, "neutral-pbr");
  assert.deepEqual(scene, createMetadataSceneManifest(historicalScene, releaseContract));
  assert.deepEqual(runtimeSpawn.position, { x: 0, y: 0, z: -4.95 });
  assert.equal(runtimeSpawn.yaw, Math.PI);
  assert.deepEqual(releaseContract.runtimeSpawn.lookAt, { x: 0, y: 2.48, z: 5.33 });
  assert.equal(releaseContract.runtimeSpawn.forwardAxis, "-Z");
  const dx = releaseContract.runtimeSpawn.lookAt.x - runtimeSpawn.position.x;
  const dz = releaseContract.runtimeSpawn.lookAt.z - runtimeSpawn.position.z;
  const length = Math.hypot(dx, dz);
  assert.ok(Math.abs(Math.sin(runtimeSpawn.yaw) - dx / length) < 1e-12);
  assert.ok(Math.abs(-Math.cos(runtimeSpawn.yaw) - dz / length) < 1e-12);
  assert.deepEqual(runtimeSpawn.position, toRuntimePosition(contract.spawn.position));
});

test("0.1.1 preserves rights and all three unchanged payload hashes", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  const historical = manifest.releases.find(({ version }) => version === "0.1.0");
  const current = manifest.releases.find(({ version }) => version === "0.1.1");
  const historicalScene = await readJson(join(root, historical.releasePath, "scene.json"));
  const currentScene = await readJson(join(root, current.releasePath, "scene.json"));
  assert.equal(current.baseVersion, "0.1.0");
  assert.equal(current.releaseKind, "metadata-only-review");
  assert.equal(current.renderProfile, "neutral-pbr");
  assert.deepEqual(currentScene.rights, historicalScene.rights);
  assert.equal(currentScene.rights.status, approvedRightsStatus);
  assert.equal(currentScene.rights.rightsApproved, true);
  assert.deepEqual(currentScene.rights.notGrantedByThisVerdict, ["production-activation", "human-visual-acceptance"]);
  for (const name of ["LICENSES.md", "preview.webp", "scene.glb"]) {
    assert.deepEqual(current.files[name], historical.files[name]);
    assert.deepEqual(await fileRecord(join(root, current.releasePath, name)), await fileRecord(join(root, historical.releasePath, name)));
  }
  const currentLicense = await readFile(join(root, current.releasePath, "LICENSES.md"), "utf8");
  assert.ok(currentLicense.includes("does not record human visual acceptance"));
  assert.match(currentLicense, /production\s+activation/);
});

test("the two historical base releases contain the same measured GLB within product budgets", async () => {
  const contract = await readJson(join(root, "source/scene-contract.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  const inspections = [];
  for (const release of manifest.releases.slice(0, 2)) {
    const releasePath = join(root, release.releasePath);
    const inspection = await glbInspection(join(releasePath, "scene.glb"));
    const preview = await sharp(join(releasePath, "preview.webp")).metadata();
    assert.deepEqual({ format: preview.format, width: preview.width, height: preview.height }, { format: "webp", width: 960, height: 540 });
    assert.equal(inspection.scenes, 1);
    assert.equal(inspection.animations, 0);
    assert.ok(inspection.nodeNames.includes("media.debug-main"));
    assert.ok(contract.seats.every(({ id }) => inspection.nodeNames.includes(`chair.${id}`) && inspection.nodeNames.includes(`anchor.${id}`)));
    assert.ok(inspection.nodeNames.includes("functional.presenter-monitor"));
    assert.ok(inspection.nodeNames.includes("functional.stage-av-credenza"));
    assert.ok(inspection.nodeNames.includes("functional.aisle-marker.01.left"));
    assert.ok(release.files["scene.glb"].sizeBytes <= contract.budgets.glbBytesMax);
    assert.ok(inspection.triangles <= contract.budgets.trianglesMax);
    assert.ok(inspection.objects <= contract.budgets.objectsMax);
    assert.ok(inspection.meshes <= contract.budgets.meshesMax);
    assert.ok(inspection.materials <= contract.budgets.materialsMax);
    assert.ok(inspection.textures <= contract.budgets.texturesMax);
    assert.deepEqual(release.stats, {
      triangles: inspection.triangles,
      objects: inspection.objects,
      meshes: inspection.meshes,
      primitives: inspection.primitives,
      materials: inspection.materials,
      textures: inspection.textures,
      animations: inspection.animations
    });
    inspections.push(release.stats);
  }
  assert.deepEqual(inspections[0], inspections[1]);
});

test("source, tooling, provenance, and output records cover both releases without acceptance claims", async () => {
  const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
  const metadataLock = await readJson(join(root, "source/metadata-release-lock.json"));
  const assets = await readJson(join(root, "provenance/asset-ledger.json"));
  const generations = await readJson(join(root, "provenance/generation-ledger.json"));
  const rights = await readJson(join(root, "provenance/rights-status.json"));
  assert.equal(sourceLock.toolchain.platformValidatorCommit, historicalValidatorCommit);
  assert.equal(metadataLock.historicalValidatorCommit, historicalValidatorCommit);
  assert.equal(metadataLock.platformValidatorCommit, metadataValidatorCommit);
  assert.equal(sourceLock.status, "review");
  assert.equal(sourceLock.humanAcceptance, "pending-human-acceptance");
  assert.equal(metadataLock.status, "review");
  assert.equal(metadataLock.humanAcceptance, "pending-human-acceptance");
  assert.equal(metadataLock.isCurrent, false);
  assert.equal(metadataLock.publicationReady, false);
  assert.equal(metadataLock.renderProfile, "neutral-pbr");
  assert.equal(metadataLock.historicalReproducibility.blenderBinarySha256, "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880");
  assert.equal(metadataLock.reproducibility.result, "byte-identical-release-files");
  assert.equal(metadataLock.reproducibility.runs, 2);
  assert.equal(sourceLock.boundaries.visualAccepted, false);
  assert.equal(sourceLock.boundaries.immutableRelease, false);
  assert.equal(metadataLock.boundaries.visualAccepted, false);
  assert.equal(metadataLock.boundaries.immutableRelease, false);
  assert.equal(metadataLock.boundaries.publicationReady, false);
  assert.equal(assets.externalAssetsUsed, false);
  assert.equal(generations.externalAssetsUsed, false);
  assert.equal(generations.downloadedReferencesUsed, false);
  assert.equal(rights.status, approvedRightsStatus);
  assert.equal(rights.visualApproval, "pending-human-acceptance");
  assert.equal(rights.publicationReady, false);
  assert.ok(assets.records.some(({ repositoryPath, kind }) => repositoryPath === "source/scene-contract.json" && kind === "project-authored-scene-source"));
  assert.ok(!assets.records.some(({ repositoryPath }) => repositoryPath === "source/metadata-release.json"));
  assert.deepEqual(sourceLock.tooling, generations.tooling);
  assert.deepEqual(
    assets.records.filter(({ kind }) => kind === "repository-tooling").map(({ repositoryPath, sha256, sizeBytes }) => ({ repositoryPath, sha256, sizeBytes })),
    sourceLock.tooling
  );
  assert.deepEqual(await fileRecord(join(root, "source/metadata-release-lock.json")), historicalMetadataLockRecord);
  assert.deepEqual(metadataLock.historicalEvidence.map(({ repositoryPath }) => repositoryPath), Object.keys(historicalEvidenceRecords));
  for (const record of metadataLock.historicalEvidence) {
    assert.deepEqual({ sha256: record.sha256, sizeBytes: record.sizeBytes }, historicalEvidenceRecords[record.repositoryPath]);
  }
  assert.deepEqual(await fileRecord(join(root, metadataLock.releaseContract.path)), {
    sha256: metadataLock.releaseContract.sha256,
    sizeBytes: metadataLock.releaseContract.sizeBytes
  });
  for (const output of generations.outputs.filter(({ repositoryPath }) => repositoryPath !== "manifest.json")) {
    assert.deepEqual(await fileRecord(join(root, output.repositoryPath)), { sha256: output.sha256, sizeBytes: output.sizeBytes });
  }
  for (const output of metadataLock.outputs.filter(({ repositoryPath }) => repositoryPath !== "manifest.json")) {
    assert.deepEqual(await fileRecord(join(root, output.repositoryPath)), { sha256: output.sha256, sizeBytes: output.sizeBytes });
  }
  assert.ok(requiredReleaseFiles.every((name) => generations.outputs.some(({ repositoryPath }) => repositoryPath === `assets/scenes/presentation-room-v1/0.1.0/${name}`)));
  assert.ok(requiredReleaseFiles.every((name) => metadataLock.outputs.some(({ repositoryPath }) => repositoryPath === `assets/scenes/presentation-room-v1/0.1.1/${name}`)));
  assert.ok(metadataLock.outputs.some(({ repositoryPath }) => repositoryPath === "manifest.json"));
});

test("four historical cwebp review views remain 960x540", async () => {
  const views = ["entry", "audience", "presenter", "diagonal-overview"];
  assert.deepEqual((await readdir(join(root, "source/review"))).sort(), views.map((id) => `${id}.webp`).sort());
  for (const view of views) {
    const metadata = await sharp(join(root, `source/review/${view}.webp`)).metadata();
    assert.deepEqual({ format: metadata.format, width: metadata.width, height: metadata.height }, { format: "webp", width: 960, height: 540 });
  }
});
