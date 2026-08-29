import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import sharp from "sharp";

import {
  assert,
  createMetadataSceneManifest,
  fileRecord,
  glbInspection,
  readJson,
  toRuntimePosition,
  totalBytes
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const historicalValidatorCommit = "9153bb9818a2907fb33ba96375f7b31c1641f12f";
const metadataValidatorCommit = "61736f6289f941e290f4fe156f17efdd64ef876b";
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
const requiredReviewViews = ["entry", "audience", "presenter", "diagonal-overview"];
const expectedVersions = ["0.1.0", "0.1.1"];
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
    if (["publicationReady", "isCurrent"].includes(key)) assert(child === false, `activation_claim:${path}:${key}`);
    if (key === "status") assert(!["active", "approved"].includes(child), `forbidden_status:${path}:${child}`);
    if (["humanAcceptance", "visualApproval"].includes(key)) assert(child === "pending-human-acceptance", `human_gate_not_pending:${path}:${key}`);
    if (["rightsApproval", "rightsStatus"].includes(key)) assert(child === approvedRightsStatus, `rights_gate_not_approved:${path}:${key}`);
    if (key === "rightsApproved") assert(child === true, `rights_approval_boolean_not_true:${path}`);
    if (["visualAccepted", "acceptedSource", "immutableRelease", "stagingVerified"].includes(key)) assert(child === false, `boundary_must_remain_false:${path}:${key}`);
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

function verifyReleaseRights(scene, version) {
  assert(scene.rights.status === approvedRightsStatus && scene.rights.rightsApproved === true, `release_rights_gate_mismatch:${version}`);
  assert(scene.rights.rightsOwnerVerdict.decisionMaker === "human-rights-owner" && scene.rights.rightsOwnerVerdict.receivedOn === rightsApprovalDate, `release_rights_owner_verdict_mismatch:${version}`);
  assert(scene.rights.ownershipBasis === "entirely-project-authored" && scene.rights.externalAssetsUsed === false, `release_ownership_basis_mismatch:${version}`);
  assert(scene.rights.licenseRef === licenseRef && scene.rights.licenseFile === "LICENSES.md", `release_license_reference_mismatch:${version}`);
  assert(JSON.stringify(scene.rights.clearedFor) === JSON.stringify(allowedUses), `release_rights_scope_mismatch:${version}`);
  assert(JSON.stringify(scene.rights.notGrantedByThisVerdict) === JSON.stringify(notGrantedByRightsVerdict), `release_rights_non_grants_mismatch:${version}`);
}

const config = await readJson(join(root, "scene-repository.json"));
const packageJson = await readJson(join(root, "package.json"));
const contract = await readJson(join(root, "source/scene-contract.json"));
const releaseContract = await readJson(join(root, "source/metadata-release.json"));
const contractLock = await readJson(join(root, "source/scene-contract-lock.json"));
const sourceLock = await readJson(join(root, "source/review-candidate-lock.json"));
const metadataLock = await readJson(join(root, "source/metadata-release-lock.json"));
const manifest = await readJson(join(root, "manifest.json"));
const assetLedger = await readJson(join(root, "provenance/asset-ledger.json"));
const generationLedger = await readJson(join(root, "provenance/generation-ledger.json"));
const rights = await readJson(join(root, "provenance/rights-status.json"));
const validatorCommit = (await readFile(join(root, "platform-validator.lock"), "utf8")).trim();

assert(config.schemaVersion === 1 && config.oneSceneOnly === true, "invalid_repository_config");
assert(config.sceneId === "presentation-room-v1" && contract.sceneId === config.sceneId && releaseContract.sceneId === config.sceneId, "scene_identity_mismatch");
assert(config.repository.endsWith(`/${config.sceneId}`), "repository_scene_identity_mismatch");
assert(config.releaseVersion === "0.1.1" && packageJson.version === config.releaseVersion, "current_release_or_package_version_mismatch");
assert(contract.version === "0.1.0", "historical_source_contract_mismatch");
assert(releaseContract.version === config.releaseVersion && releaseContract.baseVersion === contract.version, "metadata_release_contract_mismatch");
assert(validatorCommit === metadataValidatorCommit, "platform_validator_lock_mismatch");
for (const [name, commit] of [
  ["repository", config.platformValidatorCommit],
  ["metadata-contract", releaseContract.platformValidatorCommit],
  ["metadata-lock", metadataLock.platformValidatorCommit],
  ["manifest", manifest.platformValidatorCommit]
]) {
  assert(commit === validatorCommit, `${name}_validator_commit_mismatch`);
}
for (const [name, commit] of [
  ["contract", contract.toolchain.platformValidatorCommit],
  ["contract-lock", contractLock.platformValidatorCommit],
  ["historical-source-lock", sourceLock.toolchain.platformValidatorCommit],
  ["metadata-lock-historical", metadataLock.historicalValidatorCommit]
]) {
  assert(commit === historicalValidatorCommit, `${name}_historical_validator_commit_mismatch`);
}

for (const value of [config, contract, releaseContract, contractLock, sourceLock, metadataLock, manifest, assetLedger, generationLedger, rights]) {
  verifyPendingGates(value);
}
assert(contract.status === "review" && contract.humanAcceptance === "pending-human-acceptance", "contract_not_review_pending");
assert(releaseContract.releaseKind === "metadata-only-review" && releaseContract.status === "review", "metadata_release_kind_or_status_mismatch");
assert(releaseContract.humanAcceptance === "pending-human-acceptance" && releaseContract.isCurrent === false && releaseContract.publicationReady === false, "metadata_release_gate_mismatch");
assert(releaseContract.renderMode === "clean" && releaseContract.renderProfile === "neutral-pbr", "metadata_release_render_contract_mismatch");
assert(JSON.stringify(releaseContract.unchangedFiles) === JSON.stringify(["LICENSES.md", "preview.webp", "scene.glb"]), "metadata_unchanged_files_mismatch");
assert(releaseContract.historicalReproducibility.blenderVersion === contract.toolchain.blenderVersion, "metadata_blender_version_mismatch");
assert(releaseContract.historicalReproducibility.blenderBuildHash === contract.toolchain.blenderBuildHash, "metadata_blender_build_mismatch");
assert(releaseContract.historicalReproducibility.blenderBinarySha256 === "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880", "metadata_blender_binary_hash_mismatch");
assert(config.rightsStatus === approvedRightsStatus && config.rightsApproved === true, "repository_rights_verdict_mismatch");
assert(config.rightsApprovalDate === rightsApprovalDate && config.licenseRef === licenseRef, "repository_rights_reference_mismatch");
assert(contract.renderMode === "clean", "contract_render_mode_must_be_clean");
assert(contract.productPurpose.joinMuted === true && JSON.stringify(contract.productPurpose.mediaUses) === JSON.stringify(["pdf", "screen-share"]), "product_purpose_contract_mismatch");
assert(JSON.stringify(contract.coordinateAdapter.positionTransform) === JSON.stringify({ x: "x", y: "y", z: "-z" }), "coordinate_adapter_mismatch");
assert(JSON.stringify(contract.coordinateAdapter.blenderAuthoringTransform) === JSON.stringify({ x: "x", y: "z", z: "y" }), "blender_adapter_mismatch");
assert(contract.rights.status === approvedRightsStatus && contract.rights.rightsApproved === true, "contract_rights_verdict_mismatch");
assert(contract.rights.rightsOwnerVerdict.decision === approvedRightsStatus && contract.rights.rightsOwnerVerdict.decisionMaker === "human-rights-owner", "contract_rights_owner_mismatch");
assert(contract.rights.rightsOwnerVerdict.receivedOn === rightsApprovalDate, "contract_rights_date_mismatch");
assert(contract.rights.ownershipBasis === "entirely-project-authored" && contract.rights.externalAssetsUsed === false, "contract_ownership_basis_mismatch");
assert(contract.rights.licenseRef === licenseRef && contract.rights.licensePath === "provenance/LICENSES.review.md", "contract_license_reference_mismatch");
assert(JSON.stringify(contract.rights.allowedUses) === JSON.stringify(allowedUses), "contract_rights_scope_mismatch");
assert(JSON.stringify(contract.rights.notGrantedByThisVerdict) === JSON.stringify(notGrantedByRightsVerdict), "contract_rights_non_grants_mismatch");
assert(contract.releaseBoundary.visualAccepted === false && contract.releaseBoundary.rightsApproved === true, "contract_release_boundary_mismatch");
assert(contract.releaseBoundary.acceptedSource === false && contract.releaseBoundary.immutableRelease === false && contract.releaseBoundary.stagingVerified === false && contract.releaseBoundary.publicationReady === false, "contract_publication_gates_must_remain_false");

const expectedSeatIds = Array.from({ length: 8 }, (_, index) => `seat-${String(index + 1).padStart(2, "0")}`);
assert(JSON.stringify(contract.seats.map(({ id }) => id)) === JSON.stringify(expectedSeatIds), "exact_seat_contract_mismatch");
assert(contract.seats.filter(({ visible }) => visible).length === 8, "insufficient_visible_seat_anchors");
assert(JSON.stringify(contract.seats.map(({ row }) => row)) === JSON.stringify([1, 1, 1, 1, 2, 2, 2, 2]), "seat_row_assignment_mismatch");
assert(contract.seats[0].position.x !== contract.seats[4].position.x, "rows_not_staggered");
assert(contract.seats.every(({ aimTargetSurfaceId }) => aimTargetSurfaceId === "debug-main"), "seat_aim_target_mismatch");
const surface = contract.mediaSurfaces[0];
assert(contract.mediaSurfaces.length === 1 && surface.surfaceId === "debug-main", "exact_media_surface_contract_mismatch");
assert(surface.visible === true && surface.aspectRatio === "16:9" && Math.abs(surface.widthM / surface.heightM - 16 / 9) < 1e-12, "media_surface_contract_mismatch");
assert(contract.seats.every((seat) => seatAimAngleDegrees(seat, surface) <= 30), "seat_not_aimed_at_focal_screen");
assert(contract.spawn.id === "main" && contract.spawn.outsideAudienceRows === true, "main_spawn_contract_mismatch");
assert(contract.spawn.position.z > Math.max(...contract.seats.map(({ position }) => position.z)) + 1, "main_spawn_inside_audience_rows");
assert(contract.circulation.entryToStageClear === true, "entry_to_stage_route_not_clear");
for (const key of ["centerAisleWidthM", "leftSideAisleWidthM", "rightSideAisleWidthM"]) {
  assert(contract.circulation[key] >= contract.circulation.minimumClearWidthM, `unsafe_aisle:${key}`);
}
assert(JSON.stringify(contract.reviewViews.map(({ id }) => id)) === JSON.stringify(requiredReviewViews), "review_view_contract_mismatch");

const sceneRoots = (await readdir(join(root, "assets/scenes"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert(JSON.stringify(sceneRoots) === JSON.stringify([config.sceneId]), "one_scene_boundary_violated");
const versions = (await readdir(join(root, "assets/scenes", config.sceneId), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert(JSON.stringify(versions) === JSON.stringify(expectedVersions), "release_version_boundary_violated");
assert(manifest.sceneId === config.sceneId && JSON.stringify(manifest.releases.map(({ version }) => version)) === JSON.stringify(expectedVersions), "manifest_release_boundary_mismatch");
assert(manifest.status === "review" && manifest.humanAcceptance === "pending-human-acceptance" && manifest.publicationReady === false, "manifest_gate_mismatch");
assert(manifest.rightsStatus === approvedRightsStatus && manifest.rightsApproved === true && manifest.rightsApprovalDate === rightsApprovalDate && manifest.licenseRef === licenseRef, "manifest_rights_mismatch");

const releases = new Map();
for (const release of manifest.releases) {
  const releasePath = join(root, release.releasePath);
  const releaseEntries = (await readdir(releasePath, { withFileTypes: true })).map((entry) => entry.name).sort();
  assert(release.releasePath === `assets/scenes/${config.sceneId}/${release.version}`, `release_path_mismatch:${release.version}`);
  assert(JSON.stringify(releaseEntries) === JSON.stringify(requiredReleaseFiles), `release_file_set_mismatch:${release.version}`);
  assert(release.status === "review" && release.humanAcceptance === "pending-human-acceptance", `release_gate_mismatch:${release.version}`);
  assert(release.isCurrent === false && release.publicationReady === false, `review_release_activated:${release.version}`);
  assert(release.rightsStatus === approvedRightsStatus && release.rightsApproved === true && release.rightsApprovalDate === rightsApprovalDate && release.licenseRef === licenseRef, `release_rights_mismatch:${release.version}`);
  assert(release.platformValidatorCommit === (release.version === "0.1.0" ? historicalValidatorCommit : metadataValidatorCommit), `release_validator_commit_mismatch:${release.version}`);
  for (const name of requiredReleaseFiles) {
    assert(JSON.stringify(await fileRecord(join(releasePath, name))) === JSON.stringify(release.files[name]), `release_file_hash_mismatch:${release.version}:${name}`);
  }
  const scene = await readJson(join(releasePath, "scene.json"));
  verifyPendingGates(scene, `${release.version}/scene.json`);
  assert(scene.sceneId === config.sceneId && scene.version === release.version, `scene_manifest_identity_mismatch:${release.version}`);
  assert(scene.status === "review" && scene.humanAcceptance === "pending-human-acceptance" && scene.publicationReady === false, `scene_manifest_gate_mismatch:${release.version}`);
  assert(scene.renderMode === "clean" && release.renderMode === "clean", `release_render_mode_mismatch:${release.version}`);
  assert(scene.glbPath === "scene.glb" && scene.preview === "preview.webp", `unsafe_release_relative_path:${release.version}`);
  verifyReleaseRights(scene, release.version);
  const releaseLicense = await readFile(join(releasePath, "LICENSES.md"), "utf8");
  for (const requiredText of [licenseRef, rightsApprovalDate, "human rights owner", "public web runtime", "publicly downloadable scene bundle", "does not record human visual acceptance"]) {
    assert(releaseLicense.includes(requiredText), `release_license_notice_incomplete:${release.version}:${requiredText}`);
  }
  assert(/production\s+activation/.test(releaseLicense), `release_license_production_non_grant_missing:${release.version}`);
  assert(releaseLicense === await readFile(join(root, "provenance/LICENSES.review.md"), "utf8"), `release_license_not_canonical_notice:${release.version}`);
  const preview = await sharp(join(releasePath, "preview.webp")).metadata();
  assert(preview.format === "webp" && preview.width === 960 && preview.height === 540, `invalid_release_preview:${release.version}`);
  const glbPath = join(releasePath, "scene.glb");
  const inspection = await glbInspection(glbPath);
  assert(inspection.scenes === 1 && inspection.animations === 0, `invalid_glb_scene_or_animation_count:${release.version}`);
  assert(inspection.nodeNames.includes("media.debug-main"), `glb_missing_debug_main_surface:${release.version}`);
  for (const nodeName of ["functional.presenter-monitor", "functional.stage-av-credenza", "functional.aisle-marker.01.left"]) {
    assert(inspection.nodeNames.includes(nodeName), `glb_missing_presentation_detail:${release.version}:${nodeName}`);
  }
  for (const seatId of expectedSeatIds) {
    assert(inspection.nodeNames.includes(`anchor.${seatId}`), `glb_missing_anchor:${release.version}:${seatId}`);
    assert(inspection.nodeNames.includes(`chair.${seatId}`), `glb_missing_visible_chair:${release.version}:${seatId}`);
    assert(inspection.nodeNames.includes(`chair.${seatId}.back-shell`), `glb_missing_constructed_chair_shell:${release.version}:${seatId}`);
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
  assert(JSON.stringify(actualStats) === JSON.stringify(release.stats) && JSON.stringify(actualStats) === JSON.stringify(scene.stats), `release_metrics_mismatch:${release.version}`);
  assert(release.files["scene.glb"].sizeBytes <= contract.budgets.glbBytesMax, `glb_size_budget_exceeded:${release.version}`);
  assert(actualStats.triangles <= contract.budgets.trianglesMax && actualStats.objects <= contract.budgets.objectsMax && actualStats.meshes <= contract.budgets.meshesMax, `geometry_budget_exceeded:${release.version}`);
  assert(actualStats.materials <= contract.budgets.materialsMax && actualStats.textures <= contract.budgets.texturesMax, `material_budget_exceeded:${release.version}`);
  assert(await totalBytes(requiredReleaseFiles.map((name) => join(releasePath, name))) > release.files["scene.glb"].sizeBytes, `bundle_size_measurement_failed:${release.version}`);
  releases.set(release.version, { release, releasePath, scene, actualStats });
}

const historical = releases.get("0.1.0");
const current = releases.get("0.1.1");
for (const name of requiredReleaseFiles) {
  assert(JSON.stringify(historical.release.files[name]) === JSON.stringify(historicalFileRecords[name]), `historical_0.1.0_bytes_changed:${name}`);
  assert(JSON.stringify(sourceLock.release.files[name]) === JSON.stringify(historicalFileRecords[name]), `historical_source_lock_changed:${name}`);
}
assert(historical.scene.renderProfile === undefined && historical.scene.spawnPoints[0].yaw === contract.spawn.yaw, "historical_scene_metadata_changed");
assert(JSON.stringify(historical.scene.spawnPoints[0].position) === JSON.stringify(toRuntimePosition(contract.spawn.position)), "historical_runtime_spawn_transform_mismatch");
assert(JSON.stringify(historical.scene.anchors.seatAnchors.map(({ id, position }) => ({ id, position }))) === JSON.stringify(contract.seats.map(({ id, position }) => ({ id, position: toRuntimePosition(position) }))), "historical_runtime_seat_transform_mismatch");
assert(JSON.stringify(historical.scene.mediaSurfaces.map(({ surfaceId, transform }) => ({ surfaceId, transform }))) === JSON.stringify(contract.mediaSurfaces.map(({ surfaceId, position, yaw }) => ({ surfaceId, transform: { ...toRuntimePosition(position), yaw } }))), "historical_runtime_surface_transform_mismatch");

assert(current.release.baseVersion === "0.1.0" && current.release.releaseKind === "metadata-only-review", "current_release_derivation_mismatch");
assert(current.release.renderProfile === "neutral-pbr" && current.scene.renderProfile === "neutral-pbr", "current_release_render_profile_mismatch");
assert(current.scene.isCurrent === false, "current_scene_is_current_claim");
assert(JSON.stringify(current.scene) === JSON.stringify(createMetadataSceneManifest(historical.scene, releaseContract)), "current_scene_not_reproducible_from_metadata_contract");
assert(JSON.stringify(current.scene.spawnPoints[0].position) === JSON.stringify({ x: 0, y: 0, z: -4.95 }), "current_runtime_spawn_position_mismatch");
assert(current.scene.spawnPoints[0].yaw === Math.PI, "current_runtime_spawn_yaw_mismatch");
const runtimeTarget = releaseContract.runtimeSpawn.lookAt;
const runtimeSpawn = current.scene.spawnPoints[0];
const dx = runtimeTarget.x - runtimeSpawn.position.x;
const dz = runtimeTarget.z - runtimeSpawn.position.z;
const length = Math.hypot(dx, dz);
assert(Math.abs(Math.sin(runtimeSpawn.yaw) - dx / length) < 1e-12 && Math.abs(-Math.cos(runtimeSpawn.yaw) - dz / length) < 1e-12, "current_runtime_spawn_not_facing_screen");
for (const name of releaseContract.unchangedFiles) {
  assert(JSON.stringify(current.release.files[name]) === JSON.stringify(historical.release.files[name]), `metadata_payload_hash_differs:${name}`);
}
assert(JSON.stringify(current.actualStats) === JSON.stringify(historical.actualStats), "release_binary_stats_differ");

const allowedBinaryPaths = new Set([
  "source/review-candidate.blend",
  ...requiredReviewViews.map((id) => `source/review/${id}.webp`),
  ...manifest.releases.flatMap((release) => [
    `${release.releasePath}/scene.glb`,
    `${release.releasePath}/preview.webp`
  ])
]);
for (const path of await walk(root)) {
  const repositoryPath = posix(relative(root, path));
  if (binaryExtensions.has(extname(repositoryPath).toLowerCase())) assert(allowedBinaryPaths.has(repositoryPath), `unexpected_binary:${repositoryPath}`);
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
for (const release of manifest.releases) {
  assert(release.files["preview.webp"].sha256 === (await fileRecord(join(root, "source/review/entry.webp"))).sha256, `preview_must_be_entry_view:${release.version}`);
}
for (const [path, expected] of [
  ["source/review-candidate.blend", sourceLock.source.blend],
  ["source/author_scene.py", sourceLock.source.authorScript],
  ["source/export_scene.py", sourceLock.source.exportScript],
  ["source/render_review.py", sourceLock.source.renderScript]
]) {
  assert(JSON.stringify(await fileRecord(join(root, path))) === JSON.stringify(expected), `source_lock_mismatch:${path}`);
}
assert(sourceLock.version === "0.1.0", "historical_source_lock_version_mismatch");
assert(sourceLock.coordinateTransform === "x=x,y=y,z=-z" && sourceLock.renderMode === "clean", "source_lock_transform_or_render_mode_mismatch");
assert(sourceLock.reproducibility.result === "byte-identical-glb" && sourceLock.reproducibility.runs === 2 && sourceLock.reproducibility.sha256 === historical.release.files["scene.glb"].sha256, "source_lock_reproducibility_mismatch");
assert(metadataLock.version === "0.1.1" && metadataLock.baseVersion === "0.1.0" && metadataLock.releaseKind === "metadata-only-review", "metadata_lock_identity_mismatch");
assert(metadataLock.renderProfile === "neutral-pbr" && metadataLock.isCurrent === false && metadataLock.publicationReady === false, "metadata_lock_gate_or_profile_mismatch");
assert(JSON.stringify(metadataLock.historicalReproducibility) === JSON.stringify(releaseContract.historicalReproducibility), "metadata_lock_historical_reproducibility_mismatch");
assert(JSON.stringify(metadataLock.release.files) === JSON.stringify(current.release.files), "metadata_lock_release_files_mismatch");
assert(JSON.stringify(metadataLock.historicalRelease.files) === JSON.stringify(historical.release.files), "metadata_lock_historical_files_mismatch");
for (const name of releaseContract.unchangedFiles) {
  assert(JSON.stringify(metadataLock.unchangedPayload[name].historical) === JSON.stringify(metadataLock.unchangedPayload[name].release), `metadata_lock_payload_differs:${name}`);
}
for (const [repositoryPath, expected] of Object.entries(historicalEvidenceRecords)) {
  assert(JSON.stringify(await fileRecord(join(root, repositoryPath))) === JSON.stringify(expected), `historical_evidence_changed:${repositoryPath}`);
}
assert(metadataLock.sourceContract.path === "source/scene-contract.json" && metadataLock.sourceContract.version === "0.1.0" && metadataLock.sourceContract.role === "historical-authoring-source", "metadata_source_contract_reference_mismatch");
assert(JSON.stringify({ sha256: metadataLock.sourceContract.sha256, sizeBytes: metadataLock.sourceContract.sizeBytes }) === JSON.stringify(historicalEvidenceRecords["source/scene-contract.json"]), "metadata_source_contract_record_mismatch");
assert(JSON.stringify(metadataLock.historicalEvidence.map(({ repositoryPath }) => repositoryPath)) === JSON.stringify(Object.keys(historicalEvidenceRecords)), "metadata_historical_evidence_paths_mismatch");
for (const record of metadataLock.historicalEvidence) {
  assert(JSON.stringify({ sha256: record.sha256, sizeBytes: record.sizeBytes }) === JSON.stringify(historicalEvidenceRecords[record.repositoryPath]), `metadata_historical_evidence_record_mismatch:${record.repositoryPath}`);
}
assert(metadataLock.releaseContract.path === "source/metadata-release.json", "metadata_release_contract_path_mismatch");
assert(JSON.stringify(await fileRecord(join(root, metadataLock.releaseContract.path))) === JSON.stringify({ sha256: metadataLock.releaseContract.sha256, sizeBytes: metadataLock.releaseContract.sizeBytes }), "metadata_release_contract_record_mismatch");
assert(JSON.stringify(sourceLock.tooling.map(({ repositoryPath }) => repositoryPath)) === JSON.stringify(toolingPaths), "source_lock_tooling_paths_mismatch");
assert(JSON.stringify(metadataLock.tooling.map(({ repositoryPath }) => repositoryPath)) === JSON.stringify(toolingPaths), "metadata_lock_tooling_paths_mismatch");
for (const record of metadataLock.tooling) {
  assert(JSON.stringify(await fileRecord(join(root, record.repositoryPath))) === JSON.stringify({ sha256: record.sha256, sizeBytes: record.sizeBytes }), `metadata_tooling_hash_mismatch:${record.repositoryPath}`);
}

for (const record of assetLedger.records) {
  assert(record.externalSource === null && record.rightsStatus === approvedRightsStatus && record.licenseRef === licenseRef, `asset_provenance_gate_mismatch:${record.id}`);
  if (record.kind !== "repository-tooling") {
    assert(JSON.stringify(await fileRecord(join(root, record.repositoryPath))) === JSON.stringify({ sha256: record.sha256, sizeBytes: record.sizeBytes }), `asset_ledger_hash_mismatch:${record.id}`);
  }
}
for (const output of generationLedger.outputs) {
  assert(JSON.stringify(await fileRecord(join(root, output.repositoryPath))) === JSON.stringify({ sha256: output.sha256, sizeBytes: output.sizeBytes }), `generation_ledger_hash_mismatch:${output.repositoryPath}`);
}
assert(JSON.stringify(generationLedger.tooling.map(({ repositoryPath }) => repositoryPath)) === JSON.stringify(toolingPaths), "generation_ledger_tooling_paths_mismatch");
assert(JSON.stringify(generationLedger.tooling) === JSON.stringify(sourceLock.tooling), "historical_generation_tooling_evidence_mismatch");
assert(JSON.stringify(assetLedger.records.filter(({ kind }) => kind === "repository-tooling").map(({ repositoryPath, sha256, sizeBytes }) => ({ repositoryPath, sha256, sizeBytes }))) === JSON.stringify(sourceLock.tooling), "historical_asset_tooling_evidence_mismatch");
assert(requiredReleaseFiles.every((name) => generationLedger.outputs.some(({ repositoryPath }) => repositoryPath === `${historical.release.releasePath}/${name}`)), "historical_generation_outputs_missing_release");
for (const output of metadataLock.outputs) {
  assert(JSON.stringify(await fileRecord(join(root, output.repositoryPath))) === JSON.stringify({ sha256: output.sha256, sizeBytes: output.sizeBytes }), `metadata_output_hash_mismatch:${output.repositoryPath}`);
}
assert(requiredReleaseFiles.every((name) => metadataLock.outputs.some(({ repositoryPath }) => repositoryPath === `${current.release.releasePath}/${name}`)), "metadata_outputs_missing_release");
assert(metadataLock.outputs.some(({ repositoryPath }) => repositoryPath === "manifest.json"), "metadata_outputs_missing_manifest");
assert(assetLedger.records.some(({ repositoryPath, kind }) => repositoryPath === "source/scene-contract.json" && kind === "project-authored-scene-source"), "historical_source_provenance_missing");
assert(assetLedger.externalAssetsUsed === false && generationLedger.externalAssetsUsed === false && generationLedger.downloadedReferencesUsed === false, "external_asset_claim_mismatch");
assert(toolingPaths.every((repositoryPath) => assetLedger.records.some((record) => record.repositoryPath === repositoryPath && record.kind === "repository-tooling")), "asset_ledger_tooling_records_missing");
assert(assetLedger.rightsStatus === approvedRightsStatus && assetLedger.rightsApproved === true && assetLedger.licenseRef === licenseRef, "asset_ledger_rights_mismatch");
assert(generationLedger.rightsStatus === approvedRightsStatus && generationLedger.rightsApproved === true && generationLedger.licenseRef === licenseRef, "generation_ledger_rights_mismatch");
assert(rights.status === approvedRightsStatus && rights.rightsApproval === approvedRightsStatus && rights.rightsApproved === true, "rights_verdict_mismatch");
assert(rights.visualApproval === "pending-human-acceptance" && rights.publicationReady === false, "rights_record_visual_or_publication_claim");
assert(rights.rightsOwnerVerdict.decisionMaker === "human-rights-owner" && rights.rightsOwnerVerdict.receivedOn === rightsApprovalDate, "rights_owner_verdict_mismatch");
assert(rights.ownershipBasis === "entirely-project-authored" && rights.licenseRef === licenseRef, "rights_record_basis_or_license_mismatch");
assert(JSON.stringify(rights.allowedUses) === JSON.stringify(allowedUses) && JSON.stringify(rights.notGrantedByThisVerdict) === JSON.stringify(notGrantedByRightsVerdict), "rights_record_scope_mismatch");

let validator;
try {
  validator = (await import("gltf-validator")).default;
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
if (validator) {
  for (const { release, releasePath } of releases.values()) {
    const report = await validator.validateBytes(new Uint8Array(await readFile(join(releasePath, "scene.glb"))), {
      uri: `${config.sceneId}@${release.version}/scene.glb`,
      maxIssues: 200
    });
    assert(report.issues.numErrors === 0, `khronos_gltf_validation_errors:${release.version}:${report.issues.numErrors}`);
    process.stdout.write(`Khronos glTF ${release.version}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings\n`);
  }
} else {
  process.stdout.write("Khronos glTF validation skipped: validator unavailable\n");
}

process.stdout.write(`Repository valid: ${config.sceneId} has immutable review paths ${expectedVersions.join(", ")} with no active/current release\n`);
process.stdout.write(`Metadata-only ${config.releaseVersion} preserves GLB sha256=${current.release.files["scene.glb"].sha256} and faces the runtime screen with yaw=pi\n`);
