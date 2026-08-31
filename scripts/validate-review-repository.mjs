import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import sharp from "sharp";
import validator from "gltf-validator";

import { assert, fileRecord, glbInspection, readJson, toRuntimePosition } from "./lib.mjs";
import {
  captureEvidenceFileNames,
  computeLocalCaptureAttestation,
  measureVisualParity,
  readRuntimeEvidence,
  runtimeEvidenceFileNames,
  visualMeasurementsWithinTolerance
} from "./review-evidence.mjs";
import { canonicalRightsScope, reviewRelease } from "./review-release-config.mjs";

const root = resolve(import.meta.dirname, "..");
const historicalValidatorCommit = "9153bb9818a2907fb33ba96375f7b31c1641f12f";
const metadataValidatorCommit = "61736f6289f941e290f4fe156f17efdd64ef876b";
const reviewValidatorCommit = "c54edb2239d225a71e9b934316f70792b3faafb6";
const historicalVersions = ["0.1.0", "0.1.1"];
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
const approvedRightsStatus = canonicalRightsScope.status;
const rightsApprovalDate = canonicalRightsScope.rightsApprovalDate;
const licenseRef = canonicalRightsScope.licenseRef;
const historicalRightsStatusRecord = { sha256: "837a3509afaaf1e95e3c80f3060a48362664cd9be6f11bd207ad6bf7bb444b43", sizeBytes: 1047 };
const expectedSeatIds = Array.from({ length: 8 }, (_, index) => `seat-${String(index + 1).padStart(2, "0")}`);
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
const binaryExtensions = new Set([".blend", ".glb", ".png", ".webp", ".jpg", ".jpeg", ".fbx", ".gltf"]);
const textExtensions = new Set([".json", ".md", ".mjs", ".js", ".py", ".yml", ".yaml", ".toml", ".txt", ".lock"]);
const machineLocalPathPattern = /(?:\/tmp\/|\/home\/|\/Users\/|\/private\/tmp\/|\/mnt\/[A-Za-z]\/|(?:^|[\s"'=(])[A-Za-z]:[\\/])/m;

function posix(path) {
  return path.split(sep).join("/");
}

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "build"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    paths.push(path);
    if (entry.isDirectory()) paths.push(...await walk(path));
  }
  return paths;
}

function verifyPendingGates(value, path = "json") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => verifyPendingGates(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["publicationReady", "isCurrent"].includes(key)) assert(child === false, `activation_claim:${path}:${key}`);
    if (key === "status") assert(!["active", "approved"].includes(child), `forbidden_status:${path}:${child}`);
    if (["humanAcceptance", "visualApproval"].includes(key)) assert(child === "pending-human-acceptance", `human_gate_not_pending:${path}:${key}`);
    if (["rightsApproval", "rightsStatus"].includes(key)) assert(child === approvedRightsStatus, `rights_gate_not_approved:${path}:${key}`);
    if (["visualAccepted", "acceptedSource", "immutableRelease", "stagingVerified"].includes(key)) assert(child === false, `boundary_must_remain_false:${path}:${key}`);
    verifyPendingGates(child, `${path}.${key}`);
  }
}

function glbJson(bytes) {
  assert(bytes.subarray(0, 4).toString("utf8") === "glTF", "invalid_glb_magic");
  const jsonLength = bytes.readUInt32LE(12);
  assert(bytes.subarray(16, 20).toString("utf8") === "JSON", "invalid_glb_json_chunk");
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/, ""));
}

function releaseStats(inspection) {
  return {
    triangles: inspection.triangles,
    objects: inspection.objects,
    meshes: inspection.meshes,
    primitives: inspection.primitives,
    materials: inspection.materials,
    textures: inspection.textures,
    animations: inspection.animations
  };
}

function verifyCanonicalRightsStatus(rights) {
  assert(rights.status === canonicalRightsScope.status && rights.rightsApproval === canonicalRightsScope.status && rights.rightsApproved === true, "rights_status_verdict_mismatch");
  assert(rights.rightsOwnerVerdict.decision === canonicalRightsScope.status && rights.rightsOwnerVerdict.decisionMaker === canonicalRightsScope.decisionMaker && rights.rightsOwnerVerdict.receivedOn === canonicalRightsScope.rightsApprovalDate, "rights_status_decision_mismatch");
  assert(rights.ownershipBasis === canonicalRightsScope.ownershipBasis && rights.licenseRef === canonicalRightsScope.licenseRef, "rights_status_basis_mismatch");
  assert(JSON.stringify(rights.allowedUses) === JSON.stringify(canonicalRightsScope.allowedUses), "rights_status_allowed_uses_mismatch");
  assert(JSON.stringify(rights.notGrantedByThisVerdict) === JSON.stringify(canonicalRightsScope.notGrantedByThisVerdict), "rights_status_not_granted_mismatch");
  for (const key of ["externalAssetsUsed", "downloadedAssetsUsed", "privateSenseTowerMaterialsUsed", "imageTo3dOutputUsed", "brandingUsed", "publicationReady"]) {
    assert(rights[key] === false, `rights_status_boundary_mismatch:${key}`);
  }
}

function verifySceneRights(scene, version) {
  assert(scene.rights.status === canonicalRightsScope.status && scene.rights.rightsApproved === canonicalRightsScope.rightsApproved, `release_rights_mismatch:${version}`);
  assert(scene.rights.rightsOwnerVerdict.decision === canonicalRightsScope.status && scene.rights.rightsOwnerVerdict.decisionMaker === canonicalRightsScope.decisionMaker && scene.rights.rightsOwnerVerdict.receivedOn === canonicalRightsScope.rightsApprovalDate, `scene_rights_verdict_mismatch:${version}`);
  assert(scene.rights.ownershipBasis === canonicalRightsScope.ownershipBasis && scene.rights.externalAssetsUsed === false, `scene_rights_ownership_mismatch:${version}`);
  assert(scene.rights.licenseRef === canonicalRightsScope.licenseRef && scene.rights.licenseFile === "LICENSES.md" && scene.rights.sourceLedger === "provenance/asset-ledger.json", `scene_rights_evidence_mismatch:${version}`);
  assert(JSON.stringify(scene.rights.clearedFor) === JSON.stringify(canonicalRightsScope.allowedUses), `scene_rights_allowed_uses_mismatch:${version}`);
  assert(JSON.stringify(scene.rights.notGrantedByThisVerdict) === JSON.stringify(canonicalRightsScope.notGrantedByThisVerdict), `scene_rights_not_granted_mismatch:${version}`);
  assert(scene.publicationReady === canonicalRightsScope.publicationReady, `scene_rights_publication_boundary_mismatch:${version}`);
}

const config = await readJson(join(root, "scene-repository.json"));
const packageJson = await readJson(join(root, "package.json"));
const manifest = await readJson(join(root, "manifest.json"));
const contract = await readJson(join(root, "source/scene-contract.json"));
const releaseContract = await readJson(join(root, "source/metadata-release.json"));
const contractLock = await readJson(join(root, "source/scene-contract-lock.json"));
const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
const metadataLock = await readJson(join(root, "source/metadata-release-lock.json"));
const bakedEvidence = await readJson(join(root, reviewRelease.provenancePath));
const rightsStatus = await readJson(join(root, "provenance/rights-status.json"));
const assetLedger = await readJson(join(root, "provenance/asset-ledger.json"));
const runtimeEvidence = await readRuntimeEvidence(root, reviewRelease);
const visualMeasurement = await measureVisualParity(root, reviewRelease);
const validatorCommit = (await readFile(join(root, "platform-validator.lock"), "utf8")).trim();
const manifestVersions = manifest.releases.map(({ version }) => version);
const releaseMaterialized = manifestVersions.includes(reviewRelease.version);

assert(config.schemaVersion === 1 && config.oneSceneOnly === true, "invalid_repository_config");
assert(config.sceneId === reviewRelease.sceneId && packageJson.name === "@vrata/presentation-room-v1", "scene_identity_mismatch");
assert(config.releaseVersion === reviewRelease.version && packageJson.version === reviewRelease.version, "review_release_version_mismatch");
assert(config.releaseMaterialized === releaseMaterialized, "release_materialization_state_mismatch");
assert(config.status === "review" && config.humanAcceptance === "pending-human-acceptance", "repository_review_gate_mismatch");
assert(config.isCurrent === false && config.publicationReady === false, "repository_activation_claim");
assert(validatorCommit === reviewValidatorCommit && config.platformValidatorCommit === reviewValidatorCommit, "review_validator_pin_mismatch");
const canonicalRights = {
  rightsStatus: config.rightsStatus,
  rightsApproved: config.rightsApproved,
  rightsApprovalDate: config.rightsApprovalDate,
  licenseRef: config.licenseRef
};
assert(canonicalRights.rightsStatus === approvedRightsStatus && canonicalRights.rightsApproved === true && canonicalRights.rightsApprovalDate === rightsApprovalDate && canonicalRights.licenseRef === licenseRef, "repository_rights_mismatch");
assert(JSON.stringify({ rightsStatus: manifest.rightsStatus, rightsApproved: manifest.rightsApproved, rightsApprovalDate: manifest.rightsApprovalDate, licenseRef: manifest.licenseRef }) === JSON.stringify(canonicalRights), "manifest_rights_mismatch");
assert(rightsStatus.status === canonicalRights.rightsStatus && rightsStatus.rightsApproval === canonicalRights.rightsStatus && rightsStatus.rightsApproved === true && rightsStatus.rightsOwnerVerdict.receivedOn === canonicalRights.rightsApprovalDate && rightsStatus.licenseRef === canonicalRights.licenseRef, "rights_status_record_mismatch");
verifyCanonicalRightsStatus(rightsStatus);
assert(assetLedger.rightsStatus === canonicalRights.rightsStatus && assetLedger.rightsApproved === true && assetLedger.rightsOwnerVerdict.receivedOn === canonicalRights.rightsApprovalDate && assetLedger.licenseRef === canonicalRights.licenseRef, "asset_ledger_rights_mismatch");
assert(reviewRelease.status === "review" && reviewRelease.humanAcceptance === "pending-human-acceptance", "review_build_gate_mismatch");
assert(reviewRelease.isCurrent === false && reviewRelease.publicationReady === false, "review_build_activation_claim");
assert(reviewRelease.renderMode === "clean" && reviewRelease.renderProfile === "baked-pbr-v1", "review_build_render_profile_mismatch");
assert(reviewRelease.bake.defaultIntensity === 4, "review_build_lightmap_intensity_mismatch");
assert(reviewRelease.bake.device === "CUDA", "review_build_bake_device_mismatch");
assert(reviewRelease.blender.archiveSha256 === "95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25" && reviewRelease.blender.binarySha256 === "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880", "review_blender_pin_mismatch");
assert(reviewRelease.visualParity.thresholdState === "final-technical-regression" && reviewRelease.visualParity.finalThresholdsDefined === true, "visual_parity_final_thresholds_missing");
assert(JSON.stringify(reviewRelease.visualParity.perView) === JSON.stringify({
  entry: { phashMax: 95, nccMin: 0.3 },
  audience: { phashMax: 66, nccMin: 0.29 },
  presenter: { phashMax: 175, nccMin: 0.35 },
  "diagonal-overview": { phashMax: 105, nccMin: 0.25 }
}) && JSON.stringify(reviewRelease.visualParity.aggregate) === JSON.stringify({ phashTotalMax: 430, nccMeanMin: 0.31 }), "visual_parity_threshold_drift");
assert(JSON.stringify(reviewRelease.reviewViews) === JSON.stringify(["entry", "audience", "presenter", "diagonal-overview"]), "review_view_config_mismatch");

assert(JSON.stringify(manifestVersions) === JSON.stringify([...historicalVersions, reviewRelease.version]), "release_history_not_append_only");
assert(manifest.sceneId === config.sceneId, "manifest_scene_identity_mismatch");
assert(manifest.status === "review" && manifest.humanAcceptance === "pending-human-acceptance" && manifest.publicationReady === false, "manifest_gate_mismatch");
assert(manifest.platformValidatorCommit === (releaseMaterialized ? reviewValidatorCommit : metadataValidatorCommit), "manifest_validator_pin_mismatch");

assert(contract.version === "0.1.0" && contract.toolchain.platformValidatorCommit === historicalValidatorCommit, "historical_contract_pin_mismatch");
assert(contractLock.platformValidatorCommit === historicalValidatorCommit && sourceLock.toolchain.platformValidatorCommit === historicalValidatorCommit, "historical_source_pin_mismatch");
assert(releaseContract.version === "0.1.1" && releaseContract.platformValidatorCommit === metadataValidatorCommit, "metadata_contract_pin_mismatch");
assert(metadataLock.version === "0.1.1" && metadataLock.historicalValidatorCommit === historicalValidatorCommit && metadataLock.platformValidatorCommit === metadataValidatorCommit, "metadata_lock_pin_mismatch");
for (const [name, record] of [["source_lock", sourceLock], ["metadata_lock", metadataLock]]) {
  assert(record.rightsStatus === canonicalRights.rightsStatus && record.rightsApproved === canonicalRights.rightsApproved && record.rightsApprovalDate === canonicalRights.rightsApprovalDate && record.licenseRef === canonicalRights.licenseRef, `${name}_rights_mismatch`);
}
assert(releaseContract.releaseKind === "metadata-only-review" && releaseContract.baseVersion === "0.1.0", "metadata_contract_rights_inheritance_mismatch");
assert(contract.rights.status === canonicalRights.rightsStatus && contract.rights.rightsApproved === canonicalRights.rightsApproved && contract.rights.rightsOwnerVerdict.receivedOn === canonicalRights.rightsApprovalDate && contract.rights.licenseRef === canonicalRights.licenseRef, "historical_contract_rights_mismatch");
assert(contract.rights.rightsOwnerVerdict.decisionMaker === canonicalRightsScope.decisionMaker && contract.rights.ownershipBasis === canonicalRightsScope.ownershipBasis && contract.rights.externalAssetsUsed === false, "historical_contract_rights_semantics_mismatch");
assert(JSON.stringify(contract.rights.allowedUses) === JSON.stringify(canonicalRightsScope.allowedUses) && JSON.stringify(contract.rights.notGrantedByThisVerdict) === JSON.stringify(canonicalRightsScope.notGrantedByThisVerdict), "historical_contract_rights_scope_mismatch");

for (const value of [config, manifest, contract, releaseContract, contractLock, sourceLock, metadataLock, bakedEvidence]) verifyPendingGates(value);
for (const [repositoryPath, expected] of Object.entries(historicalEvidenceRecords)) {
  assert(JSON.stringify(await fileRecord(join(root, repositoryPath))) === JSON.stringify(expected), `historical_evidence_changed:${repositoryPath}`);
}
assert(JSON.stringify(await fileRecord(join(root, "provenance/rights-status.json"))) === JSON.stringify(historicalRightsStatusRecord), "historical_rights_status_changed");
const rightsLedgerRecord = assetLedger.records.find(({ repositoryPath }) => repositoryPath === "provenance/rights-status.json");
assert(JSON.stringify({ sha256: rightsLedgerRecord?.sha256, sizeBytes: rightsLedgerRecord?.sizeBytes }) === JSON.stringify(historicalRightsStatusRecord), "historical_rights_ledger_record_mismatch");
for (const record of metadataLock.tooling) {
  assert(JSON.stringify(await fileRecord(join(root, record.repositoryPath))) === JSON.stringify({ sha256: record.sha256, sizeBytes: record.sizeBytes }), `historical_tooling_changed:${record.repositoryPath}`);
}
for (const [repositoryPath, expected] of [
  ["source/review-candidate.blend", sourceLock.source.blend],
  ["source/author_scene.py", sourceLock.source.authorScript],
  ["source/export_scene.py", sourceLock.source.exportScript],
  ["source/render_review.py", sourceLock.source.renderScript]
]) {
  assert(JSON.stringify(await fileRecord(join(root, repositoryPath))) === JSON.stringify(expected), `historical_source_changed:${repositoryPath}`);
}
assert(JSON.stringify(sourceLock.reviewViews.map(({ id }) => id)) === JSON.stringify(reviewRelease.reviewViews), "historical_review_view_lock_set_mismatch");
const historicalReviewEntries = (await readdir(join(root, "source/review"), { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
assert(JSON.stringify(historicalReviewEntries) === JSON.stringify(reviewRelease.reviewViews.map((id) => `${id}.webp`).sort()), "historical_review_file_set_mismatch");
for (const view of sourceLock.reviewViews) {
  assert(JSON.stringify(await fileRecord(join(root, view.path))) === JSON.stringify({ sha256: view.sha256, sizeBytes: view.sizeBytes }), `historical_review_view_changed:${view.id}`);
  const metadata = await sharp(join(root, view.path)).metadata();
  assert(metadata.format === "webp" && metadata.width === 960 && metadata.height === 540, `historical_review_view_invalid:${view.id}`);
}

const sceneRoots = (await readdir(join(root, "assets/scenes"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert(JSON.stringify(sceneRoots) === JSON.stringify([config.sceneId]), "one_scene_boundary_violated");
const versionDirectories = (await readdir(join(root, "assets/scenes", config.sceneId), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert(JSON.stringify(versionDirectories) === JSON.stringify([...manifestVersions].sort()), "untracked_or_missing_release_directory");

const releases = new Map();
for (const release of manifest.releases) {
  const releasePath = join(root, release.releasePath);
  const entries = (await readdir(releasePath, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  assert(release.sceneId === config.sceneId && release.releasePath === `assets/scenes/${config.sceneId}/${release.version}`, `release_identity_mismatch:${release.version}`);
  assert(JSON.stringify(entries) === JSON.stringify([...requiredReleaseFiles].sort()), `release_file_set_mismatch:${release.version}`);
  assert(release.status === "review" && release.humanAcceptance === "pending-human-acceptance", `release_gate_mismatch:${release.version}`);
  assert(release.isCurrent === false && release.publicationReady === false, `review_release_activated:${release.version}`);
  assert(JSON.stringify({ rightsStatus: release.rightsStatus, rightsApproved: release.rightsApproved, rightsApprovalDate: release.rightsApprovalDate, licenseRef: release.licenseRef }) === JSON.stringify(canonicalRights), `release_rights_record_mismatch:${release.version}`);
  const expectedPin = release.version === "0.1.0" ? historicalValidatorCommit : release.version === "0.1.1" ? metadataValidatorCommit : reviewValidatorCommit;
  assert(release.platformValidatorCommit === expectedPin, `release_validator_pin_mismatch:${release.version}`);
  for (const name of requiredReleaseFiles) {
    assert(JSON.stringify(await fileRecord(join(releasePath, name))) === JSON.stringify(release.files[name]), `release_file_record_mismatch:${release.version}:${name}`);
  }

  const scene = await readJson(join(releasePath, "scene.json"));
  verifyPendingGates(scene, `${release.version}/scene.json`);
  assert(scene.sceneId === config.sceneId && scene.version === release.version, `scene_manifest_identity_mismatch:${release.version}`);
  assert(scene.status === "review" && scene.humanAcceptance === "pending-human-acceptance", `scene_manifest_gate_mismatch:${release.version}`);
  assert(scene.isCurrent !== true && scene.publicationReady === false, `scene_manifest_activation_claim:${release.version}`);
  if (release.version !== "0.1.0") assert(scene.isCurrent === false, `scene_manifest_current_gate_missing:${release.version}`);
  assert(scene.renderMode === "clean" && release.renderMode === "clean", `scene_render_mode_mismatch:${release.version}`);
  assert(scene.glbPath === "scene.glb" && scene.preview === "preview.webp", `unsafe_release_relative_path:${release.version}`);
  verifySceneRights(scene, release.version);
  const preview = await sharp(join(releasePath, "preview.webp")).metadata();
  assert(preview.format === "webp" && preview.width === 960 && preview.height === 540, `invalid_release_preview:${release.version}`);

  const glbPath = join(releasePath, "scene.glb");
  const glb = await readFile(glbPath);
  const inspection = await glbInspection(glbPath);
  assert(inspection.scenes === 1 && inspection.animations === 0, `invalid_glb_scene_or_animation_count:${release.version}`);
  for (const nodeName of ["spawn.main", "media.debug-main", ...expectedSeatIds.flatMap((seatId) => [`anchor.${seatId}`, `chair.${seatId}`])]) {
    assert(inspection.nodeNames.includes(nodeName), `glb_missing_scene_graph_node:${release.version}:${nodeName}`);
  }
  assert(JSON.stringify(releaseStats(inspection)) === JSON.stringify(release.stats), `release_stats_mismatch:${release.version}`);
  assert(release.files["scene.glb"].sizeBytes <= contract.budgets.glbBytesMax, `release_glb_size_budget_exceeded:${release.version}`);
  assert(inspection.triangles <= contract.budgets.trianglesMax && inspection.objects <= contract.budgets.objectsMax && inspection.meshes <= contract.budgets.meshesMax, `release_geometry_budget_exceeded:${release.version}`);
  assert(inspection.materials <= contract.budgets.materialsMax && inspection.textures <= contract.budgets.texturesMax, `release_material_budget_exceeded:${release.version}`);
  const gltfReport = await validator.validateBytes(new Uint8Array(glb), { uri: `${config.sceneId}@${release.version}/scene.glb`, maxIssues: 200 });
  assert(gltfReport.issues.numErrors === 0, `khronos_gltf_validation_errors:${release.version}:${gltfReport.issues.numErrors}`);
  process.stdout.write(`Khronos glTF ${release.version}: ${gltfReport.issues.numErrors} errors, ${gltfReport.issues.numWarnings} warnings\n`);
  releases.set(release.version, { release, scene, inspection, glb });
}

const historical = releases.get("0.1.0");
const metadata = releases.get("0.1.1");
for (const name of requiredReleaseFiles) {
  assert(JSON.stringify(historical.release.files[name]) === JSON.stringify(historicalFileRecords[name]), `historical_0.1.0_bytes_changed:${name}`);
  assert(JSON.stringify(sourceLock.release.files[name]) === JSON.stringify(historicalFileRecords[name]), `historical_source_lock_changed:${name}`);
}
assert(metadata.release.baseVersion === "0.1.0" && metadata.release.releaseKind === "metadata-only-review", "metadata_release_derivation_mismatch");
assert(metadata.release.renderProfile === "neutral-pbr" && metadata.scene.renderProfile === "neutral-pbr", "metadata_release_profile_mismatch");
for (const name of releaseContract.unchangedFiles) {
  assert(JSON.stringify(metadata.release.files[name]) === JSON.stringify(historical.release.files[name]), `metadata_payload_changed:${name}`);
}
assert(JSON.stringify(metadata.scene.spawnPoints[0].position) === JSON.stringify(toRuntimePosition(contract.spawn.position)), "metadata_runtime_spawn_position_mismatch");
assert(metadata.scene.spawnPoints[0].yaw === Math.PI, "metadata_runtime_spawn_yaw_mismatch");
for (const output of metadataLock.outputs.filter(({ repositoryPath }) => repositoryPath !== "manifest.json")) {
  assert(JSON.stringify(await fileRecord(join(root, output.repositoryPath))) === JSON.stringify({ sha256: output.sha256, sizeBytes: output.sizeBytes }), `metadata_output_changed:${output.repositoryPath}`);
}

if (releaseMaterialized) {
  const baked = releases.get(reviewRelease.version);
  const atlasRecord = await fileRecord(join(root, reviewRelease.acceptedLightmapPath));
  const exporterRecord = await fileRecord(join(root, reviewRelease.exportScriptPath));
  const atlasMetadata = await sharp(join(root, reviewRelease.acceptedLightmapPath)).metadata();
  assert(baked.release.releaseKind === reviewRelease.releaseKind, "baked_release_kind_mismatch");
  assert(baked.release.renderProfile === reviewRelease.renderProfile && baked.scene.renderProfile === reviewRelease.renderProfile, "baked_release_profile_mismatch");
  assert(baked.release.baseVersion === "0.1.1", "baked_release_base_version_mismatch");
  assert(baked.release.files["scene.glb"].sha256 === reviewRelease.releaseGlbSha256 && baked.scene.glbSha256 === reviewRelease.releaseGlbSha256, "baked_release_glb_digest_mismatch");
  assert(atlasRecord.sha256 === reviewRelease.acceptedLightmapSha256, "baked_release_atlas_digest_mismatch");
  assert(atlasMetadata.format === "png" && atlasMetadata.width === 2048 && atlasMetadata.height === 2048 && atlasMetadata.depth === "ushort", "baked_release_atlas_format_mismatch");
  assert(JSON.stringify(baked.release.files["LICENSES.md"]) === JSON.stringify(metadata.release.files["LICENSES.md"]), "baked_release_historical_license_changed");
  assert(JSON.stringify(baked.release.files["preview.webp"]) === JSON.stringify({
    sha256: runtimeEvidence.files["preview.webp"].sha256,
    sizeBytes: runtimeEvidence.files["preview.webp"].sizeBytes
  }), "baked_release_runtime_preview_mismatch");
  const expectedScene = {
    ...metadata.scene,
    version: reviewRelease.version,
    glbSha256: reviewRelease.releaseGlbSha256,
    stats: baked.release.stats,
    renderProfile: reviewRelease.renderProfile
  };
  assert(JSON.stringify(baked.scene) === JSON.stringify(expectedScene), "baked_scene_not_derived_from_0.1.1");
  const gltf = glbJson(baked.glb);
  assert((gltf.cameras ?? []).length === 0 && !(gltf.extensionsUsed ?? []).includes("KHR_lights_punctual"), "baked_release_contains_camera_or_light");
  assert((gltf.materials ?? []).length === 10 && baked.inspection.materials === 10, "baked_release_material_count_mismatch");
  assert((gltf.materials ?? []).every((material) =>
    material.extras?.vrataLightMap === true
    && material.extras?.vrataLightMapIntensity === reviewRelease.bake.defaultIntensity
    && Array.isArray(material.extras?.vrataOriginalEmissive) && material.extras.vrataOriginalEmissive.length === 3
    && typeof material.extras?.vrataOriginalEmissiveIntensity === "number"
    && Number.isInteger(material.emissiveTexture?.index)
    && material.emissiveTexture?.texCoord === 1), "baked_release_material_metadata_mismatch");
  assert((gltf.meshes ?? []).flatMap(({ primitives = [] }) => primitives).every((primitive) => Number.isInteger(primitive.attributes?.TEXCOORD_1)), "baked_release_texcoord_1_missing");
  assert((gltf.images ?? []).length === 1 && baked.inspection.textures === 1, "baked_release_lightmap_missing");

  assert(bakedEvidence.schemaVersion === 1 && bakedEvidence.sceneId === config.sceneId && bakedEvidence.releaseVersion === reviewRelease.version, "baked_evidence_identity_mismatch");
  assert(bakedEvidence.status === "review" && bakedEvidence.humanAcceptance === "pending-human-acceptance", "baked_evidence_gate_mismatch");
  assert(bakedEvidence.isCurrent === false && bakedEvidence.publicationReady === false, "baked_evidence_activation_claim");
  assert(bakedEvidence.platformValidatorCommit === reviewValidatorCommit, "baked_evidence_validator_pin_mismatch");
  assert(JSON.stringify(bakedEvidence.rights) === JSON.stringify({
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
  }), "baked_evidence_rights_mismatch");
  assert(JSON.stringify({ sha256: bakedEvidence.source.atlas.sha256, sizeBytes: bakedEvidence.source.atlas.sizeBytes }) === JSON.stringify(atlasRecord), "baked_evidence_atlas_record_mismatch");
  assert(JSON.stringify({ sha256: bakedEvidence.source.exporter.sha256, sizeBytes: bakedEvidence.source.exporter.sizeBytes }) === JSON.stringify(exporterRecord), "baked_evidence_exporter_record_mismatch");
  assert(JSON.stringify(bakedEvidence.release.files) === JSON.stringify(baked.release.files) && JSON.stringify(bakedEvidence.release.stats) === JSON.stringify(baked.release.stats), "baked_evidence_release_record_mismatch");
  assert(JSON.stringify(bakedEvidence.reproducibility) === JSON.stringify(baked.release.reproducibility), "baked_evidence_reproducibility_mismatch");
  assert(bakedEvidence.reproducibility.runs === 2 && bakedEvidence.reproducibility.result === "byte-identical-glb" && bakedEvidence.reproducibility.sha256 === reviewRelease.releaseGlbSha256, "baked_evidence_two_run_mismatch");
  assert(JSON.stringify(bakedEvidence.toolchain.acceptedBakeAuthoringEvidence) === JSON.stringify({
    evidenceType: "recorded-authoring-evidence",
    materializationPerformedBake: false,
    acceptedAtlasSha256: reviewRelease.acceptedLightmapSha256,
    contract: { ...reviewRelease.bake, transport: "emissiveTexture TEXCOORD_1 with baked-pbr-v1 metadata" }
  }), "baked_evidence_settings_mismatch");
  assert(bakedEvidence.runtimeEvidence.basePath === reviewRelease.runtimeEvidencePath, "baked_runtime_evidence_path_mismatch");
  assert(JSON.stringify(bakedEvidence.runtimeEvidence.files) === JSON.stringify(runtimeEvidence.files), "baked_runtime_evidence_file_records_mismatch");
  assert(JSON.stringify(Object.keys(bakedEvidence.runtimeEvidence.files)) === JSON.stringify(runtimeEvidenceFileNames), "baked_runtime_evidence_file_set_mismatch");
  assert(JSON.stringify(bakedEvidence.runtimeEvidence.captureSettings) === JSON.stringify(runtimeEvidence.captureSettings), "baked_runtime_capture_settings_mismatch");
  assert(JSON.stringify(bakedEvidence.runtimeEvidence.normalization) === JSON.stringify(runtimeEvidence.normalization), "baked_runtime_normalization_record_mismatch");
  const actualCaptureAttestation = await computeLocalCaptureAttestation(root, reviewRelease);
  assert(JSON.stringify(runtimeEvidence.captureBinding) === JSON.stringify(actualCaptureAttestation), "local_capture_attestation_mismatch");
  assert(runtimeEvidence.captureBinding.attestationType === "local-capture-attestation" && runtimeEvidence.captureBinding.humanAcceptanceRecorded === false, "local_capture_attestation_acceptance_claim");
  assert(runtimeEvidence.captureBinding.platformCaptureImplementationCommit === reviewValidatorCommit, "local_capture_implementation_pin_mismatch");
  assert(JSON.stringify(Object.keys(runtimeEvidence.captureBinding.captureFiles)) === JSON.stringify(captureEvidenceFileNames), "local_capture_file_set_mismatch");
  assert(JSON.stringify(bakedEvidence.runtimeEvidence.localCaptureAttestation) === JSON.stringify({
    ...runtimeEvidence.files["capture-binding.json"],
    attestationType: "local-capture-attestation",
    humanAcceptanceRecorded: false
  }), "baked_local_capture_attestation_record_mismatch");
  assert(runtimeEvidence.normalization.machineLocalUrlsRemoved === true && runtimeEvidence.normalization.bundleUrl === "local-capture/scene.json" && runtimeEvidence.normalization.assetUrl === "local-capture/scene.glb", "runtime_evidence_urls_not_normalized");
  assert(JSON.stringify(bakedEvidence.localRuntime) === JSON.stringify(runtimeEvidence.localRuntime) && runtimeEvidence.localRuntime.status === "passed", "baked_evidence_local_runtime_mismatch");
  assert(runtimeEvidence.localRuntime.assetBytesLoaded === baked.release.files["scene.glb"].sizeBytes && runtimeEvidence.localRuntime.renderProfile === reviewRelease.renderProfile, "runtime_evidence_release_mismatch");
  assert(bakedEvidence.visualParity.status === "passed" && bakedEvidence.visualParity.metricTool === "ImageMagick compare", "baked_evidence_visual_parity_status_mismatch");
  assert(typeof bakedEvidence.visualParity.metricToolVersion === "string" && bakedEvidence.visualParity.metricToolVersion.startsWith("Version: ImageMagick "), "baked_evidence_imagemagick_version_missing");
  assert(JSON.stringify(bakedEvidence.visualParity.metricTolerance) === JSON.stringify(reviewRelease.visualParity.metricTolerance), "baked_evidence_visual_tolerance_mismatch");
  assert(bakedEvidence.visualParity.thresholdState === reviewRelease.visualParity.thresholdState && bakedEvidence.visualParity.finalThresholdsDefined === true, "baked_evidence_visual_threshold_state_mismatch");
  assert(JSON.stringify(bakedEvidence.visualParity.aggregateThresholds) === JSON.stringify(reviewRelease.visualParity.aggregate), "baked_evidence_visual_aggregate_threshold_mismatch");
  assert(visualMeasurementsWithinTolerance(bakedEvidence.visualParity, visualMeasurement, reviewRelease.visualParity.metricTolerance) && visualMeasurement.result === "passed", "baked_evidence_visual_metrics_mismatch");
  assert(bakedEvidence.visualParity.humanAcceptanceRecorded === false, "baked_evidence_human_acceptance_claim");
}

const allowedBinaryPaths = new Set([
  "source/review-candidate.blend",
  reviewRelease.acceptedLightmapPath,
  ...reviewRelease.reviewViews.map((id) => `source/review/${id}.webp`),
  ...runtimeEvidenceFileNames.filter((name) => binaryExtensions.has(extname(name))).map((name) => `${reviewRelease.runtimeEvidencePath}/${name}`),
  ...manifest.releases.flatMap((release) => [
    `${release.releasePath}/scene.glb`,
    `${release.releasePath}/preview.webp`
  ])
]);
for (const path of await walk(root)) {
  const repositoryPath = posix(relative(root, path));
  if (binaryExtensions.has(extname(repositoryPath).toLowerCase())) assert(allowedBinaryPaths.has(repositoryPath), `unexpected_binary:${repositoryPath}`);
  if (extname(repositoryPath) === ".json") verifyPendingGates(await readJson(path), repositoryPath);
  if (textExtensions.has(extname(repositoryPath)) || repositoryPath === ".gitignore") {
    assert(!machineLocalPathPattern.test(await readFile(path, "utf8")), `machine_local_absolute_path:${repositoryPath}`);
  }
}

process.stdout.write(`Repository valid: immutable historical review releases ${historicalVersions.join(", ")} are unchanged.\n`);
process.stdout.write(`${reviewRelease.version} baked-pbr-v1 materialization: ${releaseMaterialized ? "present and non-current" : "pending real atlas and release outputs"}.\n`);
