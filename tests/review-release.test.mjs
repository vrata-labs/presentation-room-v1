import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { fileRecord, glbInspection, readJson } from "../scripts/lib.mjs";
import {
  captureEvidenceFileNames,
  computeLocalCaptureAttestation,
  measureVisualParity,
  readRuntimeEvidence,
  runtimeEvidenceFileNames,
  visualMeasurementsWithinTolerance
} from "../scripts/review-evidence.mjs";
import { canonicalRightsScope, reviewRelease } from "../scripts/review-release-config.mjs";

const root = resolve(import.meta.dirname, "..");
const historicalValidatorCommit = "9153bb9818a2907fb33ba96375f7b31c1641f12f";
const metadataValidatorCommit = "61736f6289f941e290f4fe156f17efdd64ef876b";
const reviewValidatorCommit = "c54edb2239d225a71e9b934316f70792b3faafb6";
const currentValidatorCommit = "c6343de81b038b7937addac44c24fa7c46adf341";
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
const historicalFileRecords = {
  "LICENSES.md": { sha256: "42a4d1ca687ca375f38db222e4fe7c3ed99af9dca4730f288cc910daf3df9d1b", sizeBytes: 836 },
  "preview.webp": { sha256: "2e5880e76d6ef1136aabdf8c8ef1eea999be0bad6415ab57997f2ec4ac61ff88", sizeBytes: 33512 },
  "scene.glb": { sha256: "1c44b52b9f70ecad9401b703176c460b6a909e3f22b2566a98caedb4a0c90a63", sizeBytes: 2142756 },
  "scene.json": { sha256: "0bf3f15a068a1edf735f48d05c2bec17d1b1878aa75b2dd0e2847065857e0115", sizeBytes: 4947 }
};
const historicalRightsStatusRecord = { sha256: "837a3509afaaf1e95e3c80f3060a48362664cd9be6f11bd207ad6bf7bb444b43", sizeBytes: 1047 };
const historicalMetadataLockRecord = { sha256: "b80eab78d8269355720f4c0973e6a683f8ba74d0780b873e7abe011e9b64c48f", sizeBytes: 7464 };

function glbJson(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/, ""));
}

test("historical materialized 0.2.0 remains review-only and non-current", async () => {
  const config = await readJson(join(root, "scene-repository.json"));
  const packageJson = await readJson(join(root, "package.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  assert.equal(packageJson.version, "0.4.0");
  assert.equal(packageJson.scripts.test, "node --test tests/*.test.mjs");
  assert.equal(config.releaseVersion, "0.4.0");
  assert.equal(config.releaseMaterialized, true);
  assert.deepEqual(manifest.releases.map(({ version }) => version), ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0"]);
  assert.equal(config.status, "review");
  assert.equal(config.humanAcceptance, "pending-human-acceptance");
  assert.equal(config.isCurrent, false);
  assert.equal(config.publicationReady, false);
  assert.equal(config.platformValidatorCommit, currentValidatorCommit);
  assert.equal((await readFile(join(root, "platform-validator.lock"), "utf8")).trim(), currentValidatorCommit);
  assert.deepEqual({
    status: reviewRelease.status,
    humanAcceptance: reviewRelease.humanAcceptance,
    isCurrent: reviewRelease.isCurrent,
    publicationReady: reviewRelease.publicationReady,
    renderProfile: reviewRelease.renderProfile
  }, {
    status: "review",
    humanAcceptance: "pending-human-acceptance",
    isCurrent: false,
    publicationReady: false,
    renderProfile: "baked-pbr-v1"
  });
  assert.equal(reviewRelease.bake.defaultIntensity, 4);
  assert.equal(reviewRelease.bake.device, "CUDA");
  assert.equal(reviewRelease.blender.archiveSha256, "95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25");
  assert.equal(reviewRelease.blender.binarySha256, "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880");
  assert.equal(reviewRelease.visualParity.finalThresholdsDefined, true);
  assert.equal(reviewRelease.visualParity.thresholdState, "final-technical-regression");
  assert.deepEqual(reviewRelease.visualParity.perView, {
    entry: { phashMax: 95, nccMin: 0.3 },
    audience: { phashMax: 66, nccMin: 0.29 },
    presenter: { phashMax: 175, nccMin: 0.35 },
    "diagonal-overview": { phashMax: 105, nccMin: 0.25 }
  });
  assert.deepEqual(reviewRelease.visualParity.aggregate, { phashTotalMax: 430, nccMeanMin: 0.31 });
  assert.deepEqual(reviewRelease.visualParity.metricTolerance, {
    perViewPhashAbsolute: 0.001,
    perViewNccAbsolute: 0.000001,
    aggregatePhashAbsolute: 0.004,
    aggregateNccAbsolute: 0.000001
  });
  assert.deepEqual(reviewRelease.reviewViews, ["entry", "audience", "presenter", "diagonal-overview"]);
});

test("historical 0.1.0 and metadata-only 0.1.1 bytes and validator pins remain intact", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
  const metadataLock = await readJson(join(root, "source/metadata-release-lock.json"));
  const versions = manifest.releases.map(({ version }) => version);
  assert.deepEqual(versions.slice(0, 2), ["0.1.0", "0.1.1"]);
  assert.equal(manifest.releases[0].platformValidatorCommit, historicalValidatorCommit);
  assert.equal(manifest.releases[1].platformValidatorCommit, metadataValidatorCommit);
  assert.equal(sourceLock.toolchain.platformValidatorCommit, historicalValidatorCommit);
  assert.equal(metadataLock.historicalValidatorCommit, historicalValidatorCommit);
  assert.equal(metadataLock.platformValidatorCommit, metadataValidatorCommit);
  for (const name of requiredReleaseFiles) {
    assert.deepEqual(await fileRecord(join(root, "assets/scenes/presentation-room-v1/0.1.0", name)), historicalFileRecords[name]);
    assert.deepEqual(sourceLock.release.files[name], historicalFileRecords[name]);
    assert.deepEqual(await fileRecord(join(root, "assets/scenes/presentation-room-v1/0.1.1", name)), manifest.releases[1].files[name]);
  }
  for (const name of ["LICENSES.md", "preview.webp", "scene.glb"]) {
    assert.deepEqual(manifest.releases[1].files[name], manifest.releases[0].files[name]);
  }
  assert.ok(manifest.releases.every(({ status, humanAcceptance, isCurrent, publicationReady }) =>
    status === "review" && humanAcceptance === "pending-human-acceptance" && isCurrent === false && publicationReady === false));
  assert.deepEqual(await fileRecord(join(root, "source/metadata-release-lock.json")), historicalMetadataLockRecord);
  for (const [path, record] of [
    ["source/review-candidate.blend", sourceLock.source.blend],
    ["source/author_scene.py", sourceLock.source.authorScript],
    ["source/export_scene.py", sourceLock.source.exportScript],
    ["source/render_review.py", sourceLock.source.renderScript]
  ]) {
    assert.deepEqual(await fileRecord(join(root, path)), record);
  }
  assert.deepEqual(sourceLock.reviewViews.map(({ id }) => id), reviewRelease.reviewViews);
  assert.deepEqual((await readdir(join(root, "source/review"))).sort(), reviewRelease.reviewViews.map((id) => `${id}.webp`).sort());
  for (const view of sourceLock.reviewViews) {
    assert.deepEqual(await fileRecord(join(root, view.path)), { sha256: view.sha256, sizeBytes: view.sizeBytes });
  }
  assert.deepEqual(await fileRecord(join(root, "provenance/rights-status.json")), historicalRightsStatusRecord);
  for (const output of metadataLock.outputs.filter(({ repositoryPath }) => repositoryPath !== "manifest.json")) {
    assert.deepEqual(await fileRecord(join(root, output.repositoryPath)), { sha256: output.sha256, sizeBytes: output.sizeBytes });
  }
});

test("historical rights stay approved while current root and 0.3.0 remain exact-byte pending", async () => {
  const config = await readJson(join(root, "scene-repository.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  const rightsStatus = await readJson(join(root, "provenance/rights-status.json"));
  const bakedEvidence = await readJson(join(root, reviewRelease.provenancePath));
  const assetLedger = await readJson(join(root, "provenance/asset-ledger.json"));
  const expected = {
    rightsStatus: canonicalRightsScope.status,
    rightsApproved: canonicalRightsScope.rightsApproved,
    rightsApprovalDate: canonicalRightsScope.rightsApprovalDate,
    licenseRef: canonicalRightsScope.licenseRef
  };
  const pending = { rightsStatus: "pending-human-rights-approval", rightsApproved: false, rightsApprovalDate: null, licenseRef: null };
  assert.deepEqual({ rightsStatus: config.rightsStatus, rightsApproved: config.rightsApproved, rightsApprovalDate: config.rightsApprovalDate, licenseRef: config.licenseRef }, pending);
  assert.deepEqual({ rightsStatus: manifest.rightsStatus, rightsApproved: manifest.rightsApproved, rightsApprovalDate: manifest.rightsApprovalDate, licenseRef: manifest.licenseRef }, pending);
  assert.equal(rightsStatus.status, expected.rightsStatus);
  assert.equal(rightsStatus.rightsOwnerVerdict.receivedOn, expected.rightsApprovalDate);
  assert.deepEqual({
    status: rightsStatus.status,
    rightsApproved: rightsStatus.rightsApproved,
    rightsApprovalDate: rightsStatus.rightsOwnerVerdict.receivedOn,
    licenseRef: rightsStatus.licenseRef,
    decision: rightsStatus.rightsOwnerVerdict.decision,
    decisionMaker: rightsStatus.rightsOwnerVerdict.decisionMaker,
    ownershipBasis: rightsStatus.ownershipBasis,
    allowedUses: rightsStatus.allowedUses,
    notGrantedByThisVerdict: rightsStatus.notGrantedByThisVerdict,
    externalAssetsUsed: rightsStatus.externalAssetsUsed,
    downloadedAssetsUsed: rightsStatus.downloadedAssetsUsed,
    privateSenseTowerMaterialsUsed: rightsStatus.privateSenseTowerMaterialsUsed,
    imageTo3dOutputUsed: rightsStatus.imageTo3dOutputUsed,
    brandingUsed: rightsStatus.brandingUsed,
    publicationReady: rightsStatus.publicationReady
  }, {
    status: canonicalRightsScope.status,
    rightsApproved: canonicalRightsScope.rightsApproved,
    rightsApprovalDate: canonicalRightsScope.rightsApprovalDate,
    licenseRef: canonicalRightsScope.licenseRef,
    decision: canonicalRightsScope.status,
    decisionMaker: canonicalRightsScope.decisionMaker,
    ownershipBasis: canonicalRightsScope.ownershipBasis,
    allowedUses: [...canonicalRightsScope.allowedUses],
    notGrantedByThisVerdict: [...canonicalRightsScope.notGrantedByThisVerdict],
    externalAssetsUsed: false,
    downloadedAssetsUsed: false,
    privateSenseTowerMaterialsUsed: false,
    imageTo3dOutputUsed: false,
    brandingUsed: false,
    publicationReady: false
  });
  const rightsLedgerRecord = assetLedger.records.find(({ repositoryPath }) => repositoryPath === "provenance/rights-status.json");
  assert.deepEqual({ sha256: rightsLedgerRecord.sha256, sizeBytes: rightsLedgerRecord.sizeBytes }, historicalRightsStatusRecord);
  for (const release of manifest.releases.filter(({ version }) => ["0.1.0", "0.1.1", "0.2.0"].includes(version))) {
    assert.deepEqual({ rightsStatus: release.rightsStatus, rightsApproved: release.rightsApproved, rightsApprovalDate: release.rightsApprovalDate, licenseRef: release.licenseRef }, expected);
    const scene = await readJson(join(root, release.releasePath, "scene.json"));
    assert.equal(scene.rights.status, expected.rightsStatus);
    assert.equal(scene.rights.rightsApproved, expected.rightsApproved);
    assert.equal(scene.rights.rightsOwnerVerdict.receivedOn, expected.rightsApprovalDate);
    assert.equal(scene.rights.rightsOwnerVerdict.decisionMaker, canonicalRightsScope.decisionMaker);
    assert.equal(scene.rights.ownershipBasis, canonicalRightsScope.ownershipBasis);
    assert.equal(scene.rights.externalAssetsUsed, false);
    assert.deepEqual(scene.rights.clearedFor, [...canonicalRightsScope.allowedUses]);
    assert.deepEqual(scene.rights.notGrantedByThisVerdict, [...canonicalRightsScope.notGrantedByThisVerdict]);
    assert.equal(scene.rights.licenseRef, expected.licenseRef);
    assert.equal(scene.publicationReady, false);
  }
  const candidate = manifest.releases.find(({ version }) => version === "0.3.0");
  const candidateScene = await readJson(join(root, candidate.releasePath, "scene.json"));
  assert.deepEqual({ rightsStatus: candidate.rightsStatus, rightsApproved: candidate.rightsApproved, rightsApprovalDate: candidate.rightsApprovalDate, licenseRef: candidate.licenseRef }, pending);
  assert.equal(candidateScene.rights.status, pending.rightsStatus);
  assert.equal(candidateScene.rights.rightsApproved, false);
  assert.deepEqual(candidateScene.rights.clearedFor, []);
  assert.deepEqual(bakedEvidence.rights, {
    status: canonicalRightsScope.status,
    rightsApproved: canonicalRightsScope.rightsApproved,
    rightsApprovalDate: canonicalRightsScope.rightsApprovalDate,
    licenseRef: canonicalRightsScope.licenseRef,
    rightsOwnerVerdict: {
      decision: canonicalRightsScope.status,
      decisionMaker: canonicalRightsScope.decisionMaker,
      receivedOn: canonicalRightsScope.rightsApprovalDate
    },
    ownershipBasis: canonicalRightsScope.ownershipBasis,
    allowedUses: [...canonicalRightsScope.allowedUses],
    notGrantedByThisVerdict: [...canonicalRightsScope.notGrantedByThisVerdict],
    externalAssetsUsed: false,
    downloadedAssetsUsed: false,
    privateSenseTowerMaterialsUsed: false,
    imageTo3dOutputUsed: false,
    brandingUsed: false,
    publicationReady: false
  });
});

test("baked exporter is syntactically valid and exports every visible mesh plus the full non-camera scene graph", async () => {
  const exporterPath = join(root, reviewRelease.exportScriptPath);
  const syntax = spawnSync("python3", ["-c", "import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))", exporterPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const source = await readFile(exporterPath, "utf8");
  assert.match(source, /DEFAULT_LIGHTMAP_INTENSITY = 4\.0/);
  assert.match(source, /if obj\.type == "MESH" and not obj\.hide_render and obj\.visible_get\(\)/);
  assert.match(source, /material\["vrataOriginalEmissive"\] = original_color/);
  assert.match(source, /material\["vrataOriginalEmissiveIntensity"\] = original_intensity/);
  assert.match(source, /use_visible=True/);
  assert.match(source, /export_cameras=False/);
  assert.match(source, /export_lights=False/);
  assert.doesNotMatch(source, /use_selection=True/);
  assert.doesNotMatch(source, /baked_objects\s*=\s*\[/);
  assert.match(source, /if not cuda_devices:/);
  assert.match(source, /raise RuntimeError\("cuda_device_not_found"\)/);
  assert.match(source, /if args\.bake and args\.device != SUPPORTED_BAKE_DEVICE:/);
  assert.match(source, /raise RuntimeError\(f"bake_requires_\{SUPPORTED_BAKE_DEVICE\.lower\(\)\}"\)/);
  const rejectedCpuBake = spawnSync(process.execPath, [join(root, "scripts/build-baked-review.mjs"), "--bake"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SCENE_BAKE_DEVICE: "CPU", SCENE_BUILD_OUTPUT: "build/rejected-cpu-bake.glb" }
  });
  assert.notEqual(rejectedCpuBake.status, 0);
  assert.match(rejectedCpuBake.stderr, /bake_device_must_be_cuda:CPU/);
});

test("0.2.0 is an append-only immutable release derived from 0.1.1 metadata", async () => {
  const config = await readJson(join(root, "scene-repository.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  const versions = manifest.releases.map(({ version }) => version);
  const directories = (await readdir(join(root, "assets/scenes", config.sceneId), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(directories, [...versions].sort());
  const baked = manifest.releases.find(({ version }) => version === reviewRelease.version);
  const base = manifest.releases.find(({ version }) => version === "0.1.1");
  const scene = await readJson(join(root, baked.releasePath, "scene.json"));
  const baseScene = await readJson(join(root, base.releasePath, "scene.json"));
  assert.equal(config.releaseMaterialized, true);
  assert.equal(baked.baseVersion, "0.1.1");
  assert.equal(baked.releaseKind, "baked-lightmap-review");
  assert.equal(baked.status, "review");
  assert.equal(baked.humanAcceptance, "pending-human-acceptance");
  assert.equal(baked.isCurrent, false);
  assert.equal(baked.publicationReady, false);
  assert.equal(baked.renderProfile, "baked-pbr-v1");
  assert.deepEqual(scene, {
    ...baseScene,
    version: "0.2.0",
    glbSha256: reviewRelease.releaseGlbSha256,
    stats: baked.stats,
    renderProfile: "baked-pbr-v1"
  });
  assert.deepEqual((await readdir(join(root, baked.releasePath))).sort(), [...requiredReleaseFiles].sort());
  for (const name of requiredReleaseFiles) {
    assert.deepEqual(await fileRecord(join(root, baked.releasePath, name)), baked.files[name]);
  }
  assert.deepEqual(baked.files["LICENSES.md"], base.files["LICENSES.md"]);
  assert.deepEqual(baked.files["preview.webp"], await fileRecord(join(root, reviewRelease.runtimeEvidencePath, "preview.webp")));
  assert.equal(baked.files["scene.glb"].sha256, reviewRelease.releaseGlbSha256);
});

test("0.2.0 GLB has exactly ten TEXCOORD_1 lightmapped materials and no cameras or lights", async () => {
  const glbPath = join(root, reviewRelease.releasePath, "scene.glb");
  const bytes = await readFile(glbPath);
  const gltf = glbJson(bytes);
  const inspection = await glbInspection(glbPath);
  assert.deepEqual({
    triangles: inspection.triangles,
    objects: inspection.objects,
    meshes: inspection.meshes,
    primitives: inspection.primitives,
    materials: inspection.materials,
    textures: inspection.textures,
    animations: inspection.animations
  }, {
    triangles: 32060,
    objects: 210,
    meshes: 193,
    primitives: 193,
    materials: 10,
    textures: 1,
    animations: 0
  });
  assert.equal((gltf.cameras ?? []).length, 0);
  assert.equal((gltf.extensionsUsed ?? []).includes("KHR_lights_punctual"), false);
  assert.equal(gltf.materials.length, 10);
  assert.ok(gltf.materials.every((material) => material.emissiveTexture?.texCoord === 1
    && material.extras?.vrataLightMap === true
    && material.extras?.vrataLightMapIntensity === 4
    && material.extras?.vrataOriginalEmissive?.length === 3
    && typeof material.extras?.vrataOriginalEmissiveIntensity === "number"));
  assert.ok(gltf.meshes.flatMap(({ primitives }) => primitives).every((primitive) => Number.isInteger(primitive.attributes.TEXCOORD_1)));
});

test("baked release provenance records passed technical runtime and visual evidence without human acceptance", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  const release = manifest.releases.find(({ version }) => version === reviewRelease.version);
  const evidence = await readJson(join(root, reviewRelease.provenancePath));
  const runtimeEvidence = await readRuntimeEvidence(root, reviewRelease);
  const visualMeasurement = await measureVisualParity(root, reviewRelease);
  const captureAttestation = await computeLocalCaptureAttestation(root, reviewRelease);
  assert.equal(evidence.source.atlas.sha256, reviewRelease.acceptedLightmapSha256);
  assert.equal(evidence.source.exporter.sha256, (await fileRecord(join(root, reviewRelease.exportScriptPath))).sha256);
  assert.deepEqual(evidence.release.files, release.files);
  assert.deepEqual(evidence.release.stats, release.stats);
  assert.deepEqual(evidence.reproducibility, release.reproducibility);
  assert.equal(evidence.runtimeEvidence.basePath, reviewRelease.runtimeEvidencePath);
  assert.deepEqual(evidence.runtimeEvidence.files, runtimeEvidence.files);
  assert.deepEqual(Object.keys(evidence.runtimeEvidence.files), runtimeEvidenceFileNames);
  assert.deepEqual(evidence.runtimeEvidence.captureSettings, runtimeEvidence.captureSettings);
  assert.deepEqual(evidence.runtimeEvidence.normalization, runtimeEvidence.normalization);
  assert.deepEqual(runtimeEvidence.captureBinding, captureAttestation);
  assert.equal(runtimeEvidence.captureBinding.attestationType, "local-capture-attestation");
  assert.equal(runtimeEvidence.captureBinding.humanAcceptanceRecorded, false);
  assert.equal(runtimeEvidence.captureBinding.platformCaptureImplementationCommit, reviewValidatorCommit);
  assert.deepEqual(Object.keys(runtimeEvidence.captureBinding.captureFiles), captureEvidenceFileNames);
  assert.deepEqual(evidence.runtimeEvidence.localCaptureAttestation, {
    ...runtimeEvidence.files["capture-binding.json"],
    attestationType: "local-capture-attestation",
    humanAcceptanceRecorded: false
  });
  assert.equal(runtimeEvidence.normalization.bundleUrl, "local-capture/scene.json");
  assert.equal(runtimeEvidence.normalization.assetUrl, "local-capture/scene.glb");
  assert.equal(runtimeEvidence.normalization.machineLocalUrlsRemoved, true);
  assert.deepEqual(evidence.localRuntime, runtimeEvidence.localRuntime);
  assert.equal(runtimeEvidence.localRuntime.status, "passed");
  assert.equal(runtimeEvidence.localRuntime.assetBytesLoaded, release.files["scene.glb"].sizeBytes);
  assert.deepEqual(evidence.toolchain.acceptedBakeAuthoringEvidence, {
    evidenceType: "recorded-authoring-evidence",
    materializationPerformedBake: false,
    acceptedAtlasSha256: reviewRelease.acceptedLightmapSha256,
    contract: { ...reviewRelease.bake, transport: "emissiveTexture TEXCOORD_1 with baked-pbr-v1 metadata" }
  });
  assert.equal(evidence.visualParity.status, "passed");
  assert.equal(evidence.visualParity.metricTool, "ImageMagick compare");
  assert.match(evidence.visualParity.metricToolVersion, /^Version: ImageMagick /);
  assert.deepEqual(evidence.visualParity.metricTolerance, reviewRelease.visualParity.metricTolerance);
  assert.equal(evidence.visualParity.finalThresholdsDefined, true);
  assert.deepEqual(evidence.visualParity.aggregateThresholds, { phashTotalMax: 430, nccMeanMin: 0.31 });
  assert.equal(visualMeasurementsWithinTolerance(evidence.visualParity, visualMeasurement, reviewRelease.visualParity.metricTolerance), true);
  assert.equal(evidence.visualParity.humanAcceptanceRecorded, false);
  assert.equal(evidence.humanAcceptance, "pending-human-acceptance");
  assert.equal(evidence.isCurrent, false);
  assert.equal(evidence.publicationReady, false);
});

test("workflow installs pinned tools, performs actual rebuilds, and protects versioned release evidence", async () => {
  const workflow = await readFile(join(root, ".github/workflows/validate.yml"), "utf8");
  assert.ok(workflow.includes("imagemagick"));
  assert.ok(workflow.includes(reviewRelease.blender.archiveUrl));
  assert.ok(workflow.includes(reviewRelease.blender.archiveSha256));
  assert.ok(workflow.includes(reviewRelease.blender.binarySha256));
  assert.ok(workflow.includes("pnpm validate:visual"));
  assert.ok(workflow.includes("pnpm verify:reproducibility"));
  assert.ok(workflow.includes('git ls-tree --name-only "$BASE_SHA" -- "$protected_path"'));
  assert.doesNotMatch(workflow, /workflow_dispatch|git rev-parse HEAD\^/);
  assert.ok(workflow.includes("fetch-depth: 1"));
  assert.ok(workflow.includes("immutable_baseline_missing"));
  assert.match(workflow, /if \[\[ -z "\$BASE_SHA" \|\| "\$BASE_SHA" =~ \^0\+\$ \]\]; then\s+echo "immutable_baseline_missing" >&2\s+exit 1/);
  assert.ok(workflow.includes("immutable_versioned_artifact_changed:$path"));
  assert.ok(workflow.includes("immutable_diff_failed"));
  assert.ok(workflow.includes('done < "$changed_paths"'));
  assert.doesNotMatch(workflow, /done < <\(git diff/);
  assert.ok(workflow.includes("source/review/*"));
  assert.ok(workflow.includes("source/review-candidate-lock.json"));
  assert.ok(workflow.includes("validate-acceptance-index-prefix.mjs"));
  assert.ok(workflow.includes("provenance/runtime-capture-*"));
  assert.ok(workflow.includes("source/baked-review-lightmap-*.png"));
});

test("failed uncommitted rematerialization preserves current release and provenance", async () => {
  const releaseGlbPath = join(root, reviewRelease.releasePath, "scene.glb");
  const provenancePath = join(root, reviewRelease.provenancePath);
  const before = {
    releaseGlb: await fileRecord(releaseGlbPath),
    provenance: await fileRecord(provenancePath)
  };
  const result = spawnSync(process.execPath, [join(root, "scripts/build-baked-review.mjs"), "--materialize", "--replace-materialized"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SCENE_BUILD_OUTPUT: "build/does-not-exist/rematerialize.glb" }
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await fileRecord(releaseGlbPath), before.releaseGlb);
  assert.deepEqual(await fileRecord(provenancePath), before.provenance);
});
