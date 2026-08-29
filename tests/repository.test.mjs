import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import sharp from "sharp";

import { fileRecord, glbInspection, readJson, resolveBlenderExecutable, toRuntimePosition, verifyBlender } from "../scripts/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const approvedRightsStatus = "approved-for-public-staging-review";
const rightsApprovalDate = "2026-08-29";
const licenseRef = "LicenseRef-Vrata-Public-Staging-Review-2026-08-29";
const allowedUses = [
  "staging",
  "public-web-runtime",
  "screenshots",
  "optimization",
  "derivative-builds",
  "redistribution-in-publicly-downloadable-scene-bundle"
];

test("Blender selection is portable and missing executables fail clearly", () => {
  assert.equal(resolveBlenderExecutable({ BLENDER_BIN: " /path/to/blender " }), "/path/to/blender");
  assert.equal(resolveBlenderExecutable({}), "blender");
  assert.throws(
    () => verifyBlender("vrata-missing-blender-executable"),
    /Set BLENDER_BIN to a Blender executable or install 'blender' on PATH/
  );
});

test("repository is pinned to one pending review scene", async () => {
  const config = await readJson(join(root, "scene-repository.json"));
  const lock = (await readFile(join(root, "platform-validator.lock"), "utf8")).trim();
  assert.equal(config.sceneId, "presentation-room-v1");
  assert.equal(config.oneSceneOnly, true);
  assert.equal(config.status, "review");
  assert.equal(config.humanAcceptance, "pending-human-acceptance");
  assert.equal(config.rightsStatus, approvedRightsStatus);
  assert.equal(config.rightsApproved, true);
  assert.equal(config.rightsApprovalDate, rightsApprovalDate);
  assert.equal(config.licenseRef, licenseRef);
  assert.equal(config.platformValidatorCommit, "9153bb9818a2907fb33ba96375f7b31c1641f12f");
  assert.equal(lock, config.platformValidatorCommit);
  assert.deepEqual(await readdir(join(root, "assets/scenes")), ["presentation-room-v1"]);
});

test("spatial contract has staggered audience seating, safe aisles, and focal media", async () => {
  const contract = await readJson(join(root, "source/scene-contract.json"));
  assert.equal(contract.spawn.id, "main");
  assert.ok(contract.spawn.position.z > Math.max(...contract.seats.map(({ position }) => position.z)) + 1);
  assert.equal(contract.seats.length, 8);
  assert.equal(contract.seats.filter(({ visible }) => visible).length, 8);
  assert.deepEqual(contract.seats.map(({ row }) => row), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.notEqual(contract.seats[0].position.x, contract.seats[4].position.x);
  assert.ok(contract.seats.every(({ aimTargetSurfaceId }) => aimTargetSurfaceId === "debug-main"));
  assert.equal(contract.mediaSurfaces.length, 1);
  assert.equal(contract.mediaSurfaces[0].surfaceId, "debug-main");
  assert.ok(Math.abs(contract.mediaSurfaces[0].widthM / contract.mediaSurfaces[0].heightM - 16 / 9) < 1e-12);
  assert.ok(["centerAisleWidthM", "leftSideAisleWidthM", "rightSideAisleWidthM"].every((key) => contract.circulation[key] >= 0.9));
});

test("runtime manifest applies x=x,y=y,z=-z to spawn, seats, and media", async () => {
  const contract = await readJson(join(root, "source/scene-contract.json"));
  const scene = await readJson(join(root, "assets/scenes/presentation-room-v1/0.1.0/scene.json"));
  assert.equal(scene.renderMode, "clean");
  assert.deepEqual(scene.coordinateAdapter.positionTransform, { x: "x", y: "y", z: "-z" });
  assert.deepEqual(scene.spawnPoints[0].position, toRuntimePosition(contract.spawn.position));
  assert.deepEqual(
    scene.anchors.seatAnchors.map(({ id, position }) => ({ id, position })),
    contract.seats.map(({ id, position }) => ({ id, position: toRuntimePosition(position) }))
  );
  assert.deepEqual(
    scene.mediaSurfaces.map(({ surfaceId, transform }) => ({ surfaceId, transform })),
    contract.mediaSurfaces.map(({ surfaceId, position, yaw }) => ({ surfaceId, transform: { ...toRuntimePosition(position), yaw } }))
  );
});

test("review bundle is exact, hashed, and never publication ready", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  const release = manifest.releases[0];
  const releasePath = join(root, release.releasePath);
  assert.equal(manifest.status, "review");
  assert.equal(release.status, "review");
  assert.equal(release.humanAcceptance, "pending-human-acceptance");
  assert.equal(release.rightsStatus, approvedRightsStatus);
  assert.equal(release.rightsApproved, true);
  assert.equal(release.rightsApprovalDate, rightsApprovalDate);
  assert.equal(release.licenseRef, licenseRef);
  assert.equal(release.isCurrent, false);
  assert.equal(release.publicationReady, false);
  assert.equal(release.renderMode, "clean");
  assert.deepEqual((await readdir(releasePath)).sort(), ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]);
  for (const name of ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]) {
    assert.deepEqual(await fileRecord(join(releasePath, name)), release.files[name]);
  }
  assert.equal((await fileRecord(join(releasePath, "preview.webp"))).sha256, (await fileRecord(join(root, "source/review/entry.webp"))).sha256);
});

test("four cwebp review views are 960x540", async () => {
  const views = ["entry", "audience", "presenter", "diagonal-overview"];
  assert.deepEqual((await readdir(join(root, "source/review"))).sort(), views.map((id) => `${id}.webp`).sort());
  for (const view of views) {
    const metadata = await sharp(join(root, `source/review/${view}.webp`)).metadata();
    assert.deepEqual({ format: metadata.format, width: metadata.width, height: metadata.height }, { format: "webp", width: 960, height: 540 });
  }
});

test("measured GLB fits the hard product budgets and contains contract nodes", async () => {
  const contract = await readJson(join(root, "source/scene-contract.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  const release = manifest.releases[0];
  const glbPath = join(root, release.releasePath, "scene.glb");
  const inspection = await glbInspection(glbPath);
  const glb = await fileRecord(glbPath);
  assert.equal(inspection.scenes, 1);
  assert.ok(inspection.nodeNames.includes("media.debug-main"));
  assert.ok(contract.seats.every(({ id }) => inspection.nodeNames.includes(`chair.${id}`) && inspection.nodeNames.includes(`anchor.${id}`)));
  assert.ok(inspection.nodeNames.includes("functional.presenter-monitor"));
  assert.ok(inspection.nodeNames.includes("functional.stage-av-credenza"));
  assert.ok(inspection.nodeNames.includes("functional.aisle-marker.01.left"));
  assert.ok(glb.sizeBytes <= contract.budgets.glbBytesMax);
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
});

test("source and provenance locks separate approved rights from pending visual gates", async () => {
  const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
  const assets = await readJson(join(root, "provenance/asset-ledger.json"));
  const generations = await readJson(join(root, "provenance/generation-ledger.json"));
  const rights = await readJson(join(root, "provenance/rights-status.json"));
  assert.equal(sourceLock.status, "review");
  assert.equal(sourceLock.humanAcceptance, "pending-human-acceptance");
  assert.equal(sourceLock.rightsStatus, approvedRightsStatus);
  assert.equal(sourceLock.rightsApproved, true);
  assert.equal(sourceLock.rightsApprovalDate, rightsApprovalDate);
  assert.equal(sourceLock.licenseRef, licenseRef);
  assert.equal(sourceLock.publicationReady, false);
  assert.equal(sourceLock.renderMode, "clean");
  assert.equal(sourceLock.reproducibility.result, "byte-identical-glb");
  assert.equal(sourceLock.reproducibility.runs, 2);
  assert.equal(assets.externalAssetsUsed, false);
  assert.equal(generations.externalAssetsUsed, false);
  assert.equal(generations.downloadedReferencesUsed, false);
  assert.equal(rights.status, approvedRightsStatus);
  assert.equal(rights.visualApproval, "pending-human-acceptance");
  assert.equal(rights.rightsApproval, approvedRightsStatus);
  assert.equal(rights.rightsApproved, true);
  assert.deepEqual(rights.rightsOwnerVerdict, {
    decision: approvedRightsStatus,
    decisionMaker: "human-rights-owner",
    receivedOn: rightsApprovalDate
  });
  assert.equal(rights.ownershipBasis, "entirely-project-authored");
  assert.equal(rights.licenseRef, licenseRef);
  assert.deepEqual(rights.allowedUses, allowedUses);
  assert.deepEqual(rights.notGrantedByThisVerdict, ["production-activation", "human-visual-acceptance"]);
  assert.equal(rights.publicationReady, false);
  assert.equal(sourceLock.boundaries.visualAccepted, false);
  assert.equal(sourceLock.boundaries.rightsApproved, true);
  assert.equal(sourceLock.boundaries.acceptedSource, false);
  assert.equal(sourceLock.boundaries.immutableRelease, false);
  assert.equal(sourceLock.boundaries.stagingVerified, false);
  assert.equal(sourceLock.boundaries.publicationReady, false);
  assert.equal(assets.rightsStatus, approvedRightsStatus);
  assert.equal(assets.rightsApproved, true);
  assert.equal(assets.licenseRef, licenseRef);
  assert.equal(generations.rightsStatus, approvedRightsStatus);
  assert.equal(generations.rightsApproved, true);
  assert.equal(generations.licenseRef, licenseRef);
  assert.ok(assets.records.every((record) => record.rightsStatus === approvedRightsStatus && record.licenseRef === licenseRef));
  assert.deepEqual(sourceLock.tooling, generations.tooling);
  for (const record of sourceLock.tooling) {
    assert.deepEqual(await fileRecord(join(root, record.repositoryPath)), { sha256: record.sha256, sizeBytes: record.sizeBytes });
  }
  const releaseLicense = await readFile(join(root, "assets/scenes/presentation-room-v1/0.1.0/LICENSES.md"), "utf8");
  assert.ok(releaseLicense.includes(licenseRef));
  assert.ok(releaseLicense.includes("does not record human visual acceptance"));
  assert.match(releaseLicense, /production\s+activation/);
  assert.deepEqual(await fileRecord(join(root, sourceLock.source.blendPath)), sourceLock.source.blend);
  for (const output of generations.outputs) {
    assert.deepEqual(await fileRecord(join(root, output.repositoryPath)), { sha256: output.sha256, sizeBytes: output.sizeBytes });
  }
});
