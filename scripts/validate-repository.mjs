import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import sharp from "sharp";

import {
  assert,
  fileRecord,
  glbInspection,
  readJson,
  toRuntimePosition,
  totalBytes
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
const requiredReviewViews = ["entry", "audience", "presenter", "diagonal-overview"];
const binaryExtensions = new Set([".blend", ".glb", ".png", ".webp", ".jpg", ".jpeg", ".fbx", ".gltf"]);
const textExtensions = new Set([".json", ".md", ".mjs", ".js", ".py", ".yml", ".yaml", ".toml", ".txt", ".lock"]);
const machineLocalPathPattern = /(?:\/tmp\/|\/home\/|\/Users\/|\/private\/tmp\/|\/mnt\/[A-Za-z]\/|[A-Za-z]:[\\/])/;
const toolingPaths = [
  "scripts/lib.mjs",
  "scripts/build-review-candidate.mjs",
  "scripts/inspect-release.mjs",
  "scripts/validate-repository.mjs",
  "scripts/verify-reproducibility.mjs",
  "tests/repository.test.mjs"
];
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
const notGrantedByRightsVerdict = ["production-activation", "human-visual-acceptance"];

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
    if (key === "publicationReady") assert(child === false, `publication_ready_claim:${path}`);
    if (key === "status") assert(!["active", "approved"].includes(child), `forbidden_status:${path}:${child}`);
    if (["humanAcceptance", "visualApproval"].includes(key)) {
      assert(child === "pending-human-acceptance", `human_gate_not_pending:${path}:${key}`);
    }
    if (["rightsApproval", "rightsStatus"].includes(key)) {
      assert(child === approvedRightsStatus, `rights_gate_not_approved:${path}:${key}`);
    }
    if (key === "rightsApproved") assert(child === true, `rights_approval_boolean_not_true:${path}`);
    if (["visualAccepted", "acceptedSource", "immutableRelease", "stagingVerified"].includes(key)) {
      assert(child === false, `boundary_must_remain_false:${path}:${key}`);
    }
    verifyPendingGates(child, `${path}.${key}`);
  }
}

function seatAimAngleDegrees(seat, surface) {
  const dx = surface.position.x - seat.position.x;
  const dz = surface.position.z - seat.position.z;
  const length = Math.hypot(dx, dz);
  const forwardX = Math.sin(seat.yaw);
  const forwardZ = -Math.cos(seat.yaw);
  const cosine = (forwardX * dx + forwardZ * dz) / length;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

const config = await readJson(join(root, "scene-repository.json"));
const contract = await readJson(join(root, "source/scene-contract.json"));
const contractLock = await readJson(join(root, "source/scene-contract-lock.json"));
const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
const manifest = await readJson(join(root, "manifest.json"));
const assetLedger = await readJson(join(root, "provenance/asset-ledger.json"));
const generationLedger = await readJson(join(root, "provenance/generation-ledger.json"));
const rights = await readJson(join(root, "provenance/rights-status.json"));
const validatorCommit = (await readFile(join(root, "platform-validator.lock"), "utf8")).trim();

assert(config.schemaVersion === 1 && config.oneSceneOnly === true, "invalid_repository_config");
assert(config.sceneId === "presentation-room-v1" && contract.sceneId === config.sceneId, "scene_identity_mismatch");
assert(config.repository.endsWith(`/${config.sceneId}`), "repository_scene_identity_mismatch");
assert(validatorCommit === "9153bb9818a2907fb33ba96375f7b31c1641f12f", "platform_validator_lock_mismatch");
assert(config.platformValidatorCommit === validatorCommit, "repository_validator_commit_mismatch");
assert(contract.toolchain.platformValidatorCommit === validatorCommit, "contract_validator_commit_mismatch");
assert(contractLock.platformValidatorCommit === validatorCommit, "contract_lock_validator_commit_mismatch");

for (const value of [config, contract, contractLock, sourceLock, manifest, assetLedger, generationLedger, rights]) {
  verifyPendingGates(value);
}
assert(contract.status === "review" && contract.humanAcceptance === "pending-human-acceptance", "contract_not_review_pending");
assert(config.rightsStatus === approvedRightsStatus && config.rightsApproved === true, "repository_rights_verdict_mismatch");
assert(config.rightsApprovalDate === rightsApprovalDate && config.licenseRef === licenseRef, "repository_rights_reference_mismatch");
assert(contract.renderMode === "clean", "contract_render_mode_must_be_clean");
assert(contract.productPurpose.joinMuted === true, "join_muted_contract_missing");
assert(JSON.stringify(contract.productPurpose.mediaUses) === JSON.stringify(["pdf", "screen-share"]), "media_use_contract_mismatch");
assert(JSON.stringify(contract.coordinateAdapter.positionTransform) === JSON.stringify({ x: "x", y: "y", z: "-z" }), "coordinate_adapter_mismatch");
assert(JSON.stringify(contract.coordinateAdapter.blenderAuthoringTransform) === JSON.stringify({ x: "x", y: "z", z: "y" }), "blender_adapter_mismatch");
assert(contract.rights.status === approvedRightsStatus && contract.rights.rightsApproved === true, "contract_rights_verdict_mismatch");
assert(contract.rights.rightsOwnerVerdict.decision === approvedRightsStatus, "contract_rights_decision_mismatch");
assert(contract.rights.rightsOwnerVerdict.decisionMaker === "human-rights-owner", "contract_rights_owner_not_human");
assert(contract.rights.rightsOwnerVerdict.receivedOn === rightsApprovalDate, "contract_rights_date_mismatch");
assert(contract.rights.ownershipBasis === "entirely-project-authored" && contract.rights.externalAssetsUsed === false, "contract_ownership_basis_mismatch");
assert(contract.rights.licenseRef === licenseRef && contract.rights.licensePath === "provenance/LICENSES.review.md", "contract_license_reference_mismatch");
assert(JSON.stringify(contract.rights.allowedUses) === JSON.stringify(allowedUses), "contract_rights_scope_mismatch");
assert(JSON.stringify(contract.rights.notGrantedByThisVerdict) === JSON.stringify(notGrantedByRightsVerdict), "contract_rights_non_grants_mismatch");
assert(contract.releaseBoundary.visualAccepted === false && contract.releaseBoundary.rightsApproved === true, "contract_release_boundary_mismatch");
assert(contract.releaseBoundary.acceptedSource === false && contract.releaseBoundary.immutableRelease === false && contract.releaseBoundary.stagingVerified === false && contract.releaseBoundary.publicationReady === false, "contract_publication_gates_must_remain_false");
assert(contractLock.rightsStatus === approvedRightsStatus && contractLock.rightsApproved === true, "contract_lock_rights_verdict_mismatch");
assert(contractLock.rightsApprovalDate === rightsApprovalDate && contractLock.licenseRef === licenseRef, "contract_lock_rights_reference_mismatch");

const expectedSeatIds = Array.from({ length: 8 }, (_, index) => `seat-${String(index + 1).padStart(2, "0")}`);
assert(JSON.stringify(contract.seats.map(({ id }) => id)) === JSON.stringify(expectedSeatIds), "exact_seat_contract_mismatch");
assert(contract.seats.filter(({ visible }) => visible).length === 8, "insufficient_visible_seat_anchors");
assert(JSON.stringify([...new Set(contract.seats.map(({ row }) => row))]) === JSON.stringify([1, 2]), "audience_rows_mismatch");
assert(contract.seats.slice(0, 4).every(({ row }) => row === 1) && contract.seats.slice(4).every(({ row }) => row === 2), "seat_row_assignment_mismatch");
assert(contract.seats[0].position.x !== contract.seats[4].position.x, "rows_not_staggered");
assert(contract.seats.every(({ aimTargetSurfaceId }) => aimTargetSurfaceId === "debug-main"), "seat_aim_target_mismatch");

assert(contract.mediaSurfaces.length === 1 && contract.mediaSurfaces[0].surfaceId === "debug-main", "exact_media_surface_contract_mismatch");
const surface = contract.mediaSurfaces[0];
assert(surface.visible === true && surface.aspectRatio === "16:9", "media_surface_visibility_or_ratio_label_mismatch");
assert(Math.abs(surface.widthM / surface.heightM - 16 / 9) < 1e-12, "media_surface_not_16_by_9");
assert(contract.seats.every((seat) => seatAimAngleDegrees(seat, surface) <= 30), "seat_not_aimed_at_focal_screen");

const maximumAudienceZ = Math.max(...contract.seats.map(({ position }) => position.z));
assert(contract.spawn.id === "main" && contract.spawn.outsideAudienceRows === true, "main_spawn_contract_mismatch");
assert(contract.spawn.position.z > maximumAudienceZ + 1.0, "main_spawn_inside_audience_rows");
assert(contract.circulation.entryToStageClear === true, "entry_to_stage_route_not_clear");
for (const key of ["centerAisleWidthM", "leftSideAisleWidthM", "rightSideAisleWidthM"]) {
  assert(contract.circulation[key] >= contract.circulation.minimumClearWidthM, `unsafe_aisle:${key}`);
}
assert(JSON.stringify(contract.reviewViews.map(({ id }) => id)) === JSON.stringify(requiredReviewViews), "review_view_contract_mismatch");

const sceneRoots = (await readdir(join(root, "assets/scenes"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
assert(JSON.stringify(sceneRoots) === JSON.stringify([config.sceneId]), "one_scene_boundary_violated");
const versions = (await readdir(join(root, "assets/scenes", config.sceneId), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
assert(JSON.stringify(versions) === JSON.stringify([config.releaseVersion]), "release_version_boundary_violated");

const release = manifest.releases[0];
assert(manifest.releases.length === 1 && manifest.sceneId === config.sceneId, "manifest_release_boundary_mismatch");
assert(manifest.status === "review" && release.status === "review", "manifest_release_status_mismatch");
assert(manifest.humanAcceptance === "pending-human-acceptance" && release.humanAcceptance === "pending-human-acceptance", "manifest_human_gate_mismatch");
assert(manifest.rightsStatus === approvedRightsStatus && release.rightsStatus === approvedRightsStatus, "manifest_rights_status_mismatch");
assert(manifest.rightsApproved === true && release.rightsApproved === true, "manifest_rights_approval_mismatch");
assert(manifest.rightsApprovalDate === rightsApprovalDate && release.rightsApprovalDate === rightsApprovalDate, "manifest_rights_date_mismatch");
assert(manifest.licenseRef === licenseRef && release.licenseRef === licenseRef, "manifest_license_reference_mismatch");
assert(manifest.publicationReady === false && release.publicationReady === false && release.isCurrent === false, "review_release_must_not_be_current_or_publishable");
assert(release.releasePath === `assets/scenes/${config.sceneId}/${config.releaseVersion}`, "release_path_mismatch");
const releasePath = join(root, release.releasePath);
const releaseEntries = (await readdir(releasePath, { withFileTypes: true })).map((entry) => entry.name).sort();
assert(JSON.stringify(releaseEntries) === JSON.stringify(requiredReleaseFiles), "release_must_contain_exactly_four_files");
for (const name of requiredReleaseFiles) {
  assert(JSON.stringify(await fileRecord(join(releasePath, name))) === JSON.stringify(release.files[name]), `release_file_hash_mismatch:${name}`);
}

const scene = await readJson(join(releasePath, "scene.json"));
verifyPendingGates(scene);
assert(scene.sceneId === config.sceneId && scene.version === config.releaseVersion, "scene_manifest_identity_mismatch");
assert(scene.status === "review" && scene.humanAcceptance === "pending-human-acceptance" && scene.publicationReady === false, "scene_manifest_gate_mismatch");
assert(scene.renderMode === "clean" && release.renderMode === "clean", "release_render_mode_must_be_clean");
assert(scene.glbPath === "scene.glb" && scene.preview === "preview.webp", "unsafe_release_relative_path");
assert(JSON.stringify(scene.coordinateAdapter.positionTransform) === JSON.stringify(contract.coordinateAdapter.positionTransform), "release_coordinate_adapter_mismatch");
assert(JSON.stringify(scene.spawnPoints[0].position) === JSON.stringify(toRuntimePosition(contract.spawn.position)), "runtime_spawn_transform_mismatch");
assert(JSON.stringify(scene.anchors.seatAnchors.map(({ id, position }) => ({ id, position }))) === JSON.stringify(contract.seats.map(({ id, position }) => ({ id, position: toRuntimePosition(position) }))), "runtime_seat_transform_mismatch");
assert(JSON.stringify(scene.mediaSurfaces.map(({ surfaceId, transform }) => ({ surfaceId, transform }))) === JSON.stringify(contract.mediaSurfaces.map(({ surfaceId, position, yaw }) => ({ surfaceId, transform: { ...toRuntimePosition(position), yaw } }))), "runtime_surface_transform_mismatch");
assert(scene.rights.status === approvedRightsStatus && scene.rights.rightsApproved === true, "release_rights_gate_mismatch");
assert(scene.rights.rightsOwnerVerdict.decisionMaker === "human-rights-owner" && scene.rights.rightsOwnerVerdict.receivedOn === rightsApprovalDate, "release_rights_owner_verdict_mismatch");
assert(scene.rights.ownershipBasis === "entirely-project-authored" && scene.rights.externalAssetsUsed === false, "release_ownership_basis_mismatch");
assert(scene.rights.licenseRef === licenseRef && scene.rights.licenseFile === "LICENSES.md", "release_license_reference_mismatch");
assert(JSON.stringify(scene.rights.clearedFor) === JSON.stringify(allowedUses), "release_rights_scope_mismatch");
assert(JSON.stringify(scene.rights.notGrantedByThisVerdict) === JSON.stringify(notGrantedByRightsVerdict), "release_rights_non_grants_mismatch");

const releaseLicense = await readFile(join(releasePath, "LICENSES.md"), "utf8");
for (const requiredText of [licenseRef, rightsApprovalDate, "human rights owner", "public web runtime", "publicly downloadable scene bundle", "does not record human visual acceptance"]) {
  assert(releaseLicense.includes(requiredText), `release_license_notice_incomplete:${requiredText}`);
}
assert(/production\s+activation/.test(releaseLicense), "release_license_production_non_grant_missing");
assert(releaseLicense === await readFile(join(root, "provenance/LICENSES.review.md"), "utf8"), "release_license_not_canonical_notice");

const allowedBinaryPaths = new Set([
  "source/review-candidate.blend",
  ...requiredReviewViews.map((id) => `source/review/${id}.webp`),
  `${release.releasePath}/scene.glb`,
  `${release.releasePath}/preview.webp`
]);
for (const path of await walk(root)) {
  const repositoryPath = posix(relative(root, path));
  if (binaryExtensions.has(extname(repositoryPath).toLowerCase())) {
    assert(allowedBinaryPaths.has(repositoryPath), `unexpected_binary:${repositoryPath}`);
  }
  if (extname(repositoryPath) === ".json") {
    const value = await readJson(path);
    if (Object.hasOwn(value, "sceneId")) assert(value.sceneId === config.sceneId, `foreign_scene_json:${repositoryPath}`);
    verifyPendingGates(value, repositoryPath);
  }
  if (textExtensions.has(extname(repositoryPath)) || repositoryPath === ".gitignore") {
    const text = await readFile(path, "utf8");
    assert(!machineLocalPathPattern.test(text), `machine_local_absolute_path:${repositoryPath}`);
  }
}

const reviewEntries = (await readdir(join(root, "source/review"), { withFileTypes: true })).map((entry) => entry.name).sort();
assert(JSON.stringify(reviewEntries) === JSON.stringify(requiredReviewViews.map((id) => `${id}.webp`).sort()), "required_review_files_mismatch");
for (const viewId of requiredReviewViews) {
  const metadata = await sharp(join(root, `source/review/${viewId}.webp`)).metadata();
  assert(metadata.format === "webp" && metadata.width === 960 && metadata.height === 540, `invalid_review_image:${viewId}`);
  const locked = sourceLock.reviewViews.find(({ id }) => id === viewId);
  assert(JSON.stringify(await fileRecord(join(root, locked.path))) === JSON.stringify({ sha256: locked.sha256, sizeBytes: locked.sizeBytes }), `review_lock_mismatch:${viewId}`);
}
assert((await fileRecord(join(releasePath, "preview.webp"))).sha256 === (await fileRecord(join(root, "source/review/entry.webp"))).sha256, "preview_must_be_entry_view");

for (const [path, expected] of [
  ["source/review-candidate.blend", sourceLock.source.blend],
  ["source/author_scene.py", sourceLock.source.authorScript],
  ["source/export_scene.py", sourceLock.source.exportScript],
  ["source/render_review.py", sourceLock.source.renderScript]
]) {
  assert(JSON.stringify(await fileRecord(join(root, path))) === JSON.stringify(expected), `source_lock_mismatch:${path}`);
}
assert(sourceLock.coordinateTransform === "x=x,y=y,z=-z", "source_lock_coordinate_transform_mismatch");
assert(sourceLock.renderMode === "clean", "source_lock_render_mode_mismatch");
assert(sourceLock.rightsStatus === approvedRightsStatus && sourceLock.rightsApproved === true, "source_lock_rights_verdict_mismatch");
assert(sourceLock.rightsApprovalDate === rightsApprovalDate && sourceLock.licenseRef === licenseRef, "source_lock_rights_reference_mismatch");
assert(sourceLock.reproducibility.result === "byte-identical-glb" && sourceLock.reproducibility.runs === 2, "source_lock_reproducibility_missing");
assert(sourceLock.reproducibility.sha256 === release.files["scene.glb"].sha256, "source_lock_reproducibility_digest_mismatch");
assert(JSON.stringify(sourceLock.tooling.map(({ repositoryPath }) => repositoryPath)) === JSON.stringify(toolingPaths), "source_lock_tooling_paths_mismatch");
for (const record of sourceLock.tooling) {
  assert(JSON.stringify(await fileRecord(join(root, record.repositoryPath))) === JSON.stringify({ sha256: record.sha256, sizeBytes: record.sizeBytes }), `source_lock_tooling_hash_mismatch:${record.repositoryPath}`);
}

for (const record of assetLedger.records) {
  assert(record.externalSource === null && record.rightsStatus === approvedRightsStatus, `asset_provenance_gate_mismatch:${record.id}`);
  assert(record.licenseRef === licenseRef, `asset_license_reference_mismatch:${record.id}`);
  assert(JSON.stringify(await fileRecord(join(root, record.repositoryPath))) === JSON.stringify({ sha256: record.sha256, sizeBytes: record.sizeBytes }), `asset_ledger_hash_mismatch:${record.id}`);
}
for (const output of generationLedger.outputs) {
  assert(JSON.stringify(await fileRecord(join(root, output.repositoryPath))) === JSON.stringify({ sha256: output.sha256, sizeBytes: output.sizeBytes }), `generation_ledger_hash_mismatch:${output.repositoryPath}`);
}
assert(JSON.stringify(generationLedger.tooling.map(({ repositoryPath }) => repositoryPath)) === JSON.stringify(toolingPaths), "generation_ledger_tooling_paths_mismatch");
for (const record of generationLedger.tooling) {
  assert(JSON.stringify(await fileRecord(join(root, record.repositoryPath))) === JSON.stringify({ sha256: record.sha256, sizeBytes: record.sizeBytes }), `generation_ledger_tooling_hash_mismatch:${record.repositoryPath}`);
}
assert(assetLedger.externalAssetsUsed === false && generationLedger.externalAssetsUsed === false && generationLedger.downloadedReferencesUsed === false, "external_asset_claim_mismatch");
assert(toolingPaths.every((repositoryPath) => assetLedger.records.some((record) => record.repositoryPath === repositoryPath && record.kind === "repository-tooling")), "asset_ledger_tooling_records_missing");
assert(assetLedger.rightsStatus === approvedRightsStatus && assetLedger.rightsApproved === true && assetLedger.licenseRef === licenseRef, "asset_ledger_rights_mismatch");
assert(generationLedger.rightsStatus === approvedRightsStatus && generationLedger.rightsApproved === true && generationLedger.licenseRef === licenseRef, "generation_ledger_rights_mismatch");
assert(rights.status === approvedRightsStatus && rights.rightsApproval === approvedRightsStatus && rights.rightsApproved === true, "rights_verdict_mismatch");
assert(rights.visualApproval === "pending-human-acceptance" && rights.publicationReady === false, "rights_record_visual_or_publication_claim");
assert(rights.rightsOwnerVerdict.decisionMaker === "human-rights-owner" && rights.rightsOwnerVerdict.receivedOn === rightsApprovalDate, "rights_owner_verdict_mismatch");
assert(rights.ownershipBasis === "entirely-project-authored" && rights.licenseRef === licenseRef, "rights_record_basis_or_license_mismatch");
assert(JSON.stringify(rights.allowedUses) === JSON.stringify(allowedUses), "rights_record_scope_mismatch");
assert(JSON.stringify(rights.notGrantedByThisVerdict) === JSON.stringify(notGrantedByRightsVerdict), "rights_record_non_grants_mismatch");

const glbPath = join(releasePath, "scene.glb");
const glbRecord = await fileRecord(glbPath);
const inspection = await glbInspection(glbPath);
assert(inspection.scenes === 1, "glb_must_contain_exactly_one_scene");
assert(inspection.animations === 0, "unexpected_animation_data");
assert(inspection.nodeNames.includes("media.debug-main"), "glb_missing_debug_main_surface");
for (const nodeName of ["functional.presenter-monitor", "functional.stage-av-credenza", "functional.aisle-marker.01.left"]) {
  assert(inspection.nodeNames.includes(nodeName), `glb_missing_presentation_detail:${nodeName}`);
}
for (const seatId of expectedSeatIds) {
  assert(inspection.nodeNames.includes(`anchor.${seatId}`), `glb_missing_anchor:${seatId}`);
  assert(inspection.nodeNames.includes(`chair.${seatId}`), `glb_missing_visible_chair:${seatId}`);
  assert(inspection.nodeNames.includes(`chair.${seatId}.back-shell`), `glb_missing_constructed_chair_shell:${seatId}`);
}
const actualStats = {
  triangles: inspection.triangles,
  objects: inspection.objects,
  meshes: inspection.meshes,
  primitives: inspection.primitives,
  materials: inspection.materials,
  textures: inspection.textures,
  animations: inspection.animations
};
assert(JSON.stringify(actualStats) === JSON.stringify(release.stats), "manifest_metrics_not_derived_from_glb");
assert(JSON.stringify(actualStats) === JSON.stringify(scene.stats), "scene_metrics_not_derived_from_glb");
assert(glbRecord.sizeBytes <= contract.budgets.glbBytesMax, "glb_size_budget_exceeded");
assert(actualStats.triangles <= contract.budgets.trianglesMax, "triangle_budget_exceeded");
assert(actualStats.objects <= contract.budgets.objectsMax, "object_budget_exceeded");
assert(actualStats.meshes <= contract.budgets.meshesMax, "mesh_budget_exceeded");
assert(actualStats.materials <= contract.budgets.materialsMax, "material_budget_exceeded");
assert(actualStats.textures <= contract.budgets.texturesMax, "texture_budget_exceeded");
assert(await totalBytes(requiredReleaseFiles.map((name) => join(releasePath, name))) > glbRecord.sizeBytes, "bundle_size_measurement_failed");

let validator;
try {
  validator = (await import("gltf-validator")).default;
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
if (validator) {
  const report = await validator.validateBytes(new Uint8Array(await readFile(glbPath)), {
    uri: `${config.sceneId}@${config.releaseVersion}/scene.glb`,
    maxIssues: 200
  });
  assert(report.issues.numErrors === 0, `khronos_gltf_validation_errors:${report.issues.numErrors}`);
  process.stdout.write(`Khronos glTF validation: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings\n`);
} else {
  process.stdout.write("Khronos glTF validation skipped: validator unavailable\n");
}

process.stdout.write(`Repository valid: ${config.sceneId}@${config.releaseVersion} remains review/pending-human-acceptance\n`);
process.stdout.write(`GLB ${glbRecord.sizeBytes} bytes sha256=${glbRecord.sha256} stats=${JSON.stringify(actualStats)}\n`);
