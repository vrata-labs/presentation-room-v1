import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

import sharp from "sharp";

import { acceptanceIndexEntryRecord, assert, fileRecord, readJson, repositoryToolingPaths } from "./lib.mjs";
import {
  assertPendingGates,
  measureRuntimeCapture,
  requiredReleaseFiles,
  reviewEvidence,
  root,
  runtimeCaptureBaseFiles,
  runtimeEvidenceFiles,
  validateRuntimeDiagnostics,
  validateRuntimeStability,
  validateCandidate
} from "./release-0.3-lib.mjs";
import { release030 as release } from "./release-0.3-config.mjs";

const visualOnly = process.argv.includes("--visual-only");
assert(process.argv.slice(2).every((argument) => argument === "--visual-only"), "unknown_validation_argument");

const historicalFiles = {
  "0.1.0": {
    "LICENSES.md": { sha256: "42a4d1ca687ca375f38db222e4fe7c3ed99af9dca4730f288cc910daf3df9d1b", sizeBytes: 836 },
    "preview.webp": { sha256: "2e5880e76d6ef1136aabdf8c8ef1eea999be0bad6415ab57997f2ec4ac61ff88", sizeBytes: 33512 },
    "scene.glb": { sha256: "1c44b52b9f70ecad9401b703176c460b6a909e3f22b2566a98caedb4a0c90a63", sizeBytes: 2142756 },
    "scene.json": { sha256: "0bf3f15a068a1edf735f48d05c2bec17d1b1878aa75b2dd0e2847065857e0115", sizeBytes: 4947 }
  },
  "0.1.1": {
    "LICENSES.md": { sha256: "42a4d1ca687ca375f38db222e4fe7c3ed99af9dca4730f288cc910daf3df9d1b", sizeBytes: 836 },
    "preview.webp": { sha256: "2e5880e76d6ef1136aabdf8c8ef1eea999be0bad6415ab57997f2ec4ac61ff88", sizeBytes: 33512 },
    "scene.glb": { sha256: "1c44b52b9f70ecad9401b703176c460b6a909e3f22b2566a98caedb4a0c90a63", sizeBytes: 2142756 },
    "scene.json": { sha256: "300f9d26bd2e583c2afcdd3f7d75c7f6a9b9a56a332fdaf9482b85c545cc7fc6", sizeBytes: 5019 }
  },
  "0.2.0": {
    "LICENSES.md": { sha256: "42a4d1ca687ca375f38db222e4fe7c3ed99af9dca4730f288cc910daf3df9d1b", sizeBytes: 836 },
    "preview.webp": { sha256: "22fc9f09b10913e54c3378be3d8be0dcde80340ad4bafdedf5f4c684f09aa720", sizeBytes: 269892 },
    "scene.glb": { sha256: "25dc4d0dad2039b7c533448c163490760ec8378187d82ed0b7a98214fc6acaec", sizeBytes: 11990268 },
    "scene.json": { sha256: "366c03557d69162ecb92a64fd8834434d7175d5248be46488d890dd62189cb9a", sizeBytes: 5020 }
  }
};
const historicalEvidence = {
  "source/review-candidate.blend": { sha256: "12afe2c438266db169922326f589a2e81478c9ef15111bbdb06a49ce71d7a89f", sizeBytes: 3100004 },
  "source/review-candidate-lock.json": { sha256: "a51706b416ce925750bd6918a96ce74bf9242167072daa513eff11538216ef0e", sizeBytes: 4451 },
  "source/metadata-release.json": { sha256: "3fdc02d742e3d17328f55389139a2eaf06fedddba4df64ef37ce4b07cb48cdfe", sizeBytes: 932 },
  "source/metadata-release-lock.json": { sha256: "b80eab78d8269355720f4c0973e6a683f8ba74d0780b873e7abe011e9b64c48f", sizeBytes: 7464 },
  "source/scene-contract.json": { sha256: "2a6b41e3de3e6821c2b8d34bec52c7847a5b78c6ff1f16b528078a450d3e5cd2", sizeBytes: 5957 },
  "source/scene-contract-lock.json": { sha256: "8d33d5fa9a2d20c88886589b873e41de652a6104196e1b285441beb65a913e61", sizeBytes: 586 },
  "source/baked-review-lightmap-0.2.0.png": { sha256: "cdeb7e52d539c17408acf6eaf39ac3a598ee06e731283f4d5b867ad45eb5fb66", sizeBytes: 9273628 },
  "provenance/rights-status.json": { sha256: "837a3509afaaf1e95e3c80f3060a48362664cd9be6f11bd207ad6bf7bb444b43", sizeBytes: 1047 },
  "provenance/asset-ledger.json": { sha256: "73db387dc2c90d3b109230adccac64b639ac810aa3be4b72022c520ed6d33ab0", sizeBytes: 5799 },
  "provenance/generation-ledger.json": { sha256: "d0ac8195d521007c385abbdcf5bedefe849afab035bfb859228a6c0c2ce1f36d", sizeBytes: 3418 }
};
const historicalPins = {
  "0.1.0": "9153bb9818a2907fb33ba96375f7b31c1641f12f",
  "0.1.1": "61736f6289f941e290f4fe156f17efdd64ef876b",
  "0.2.0": "c54edb2239d225a71e9b934316f70792b3faafb6"
};
const approvedRightsStatus = "approved-for-public-staging-review";
const binaryExtensions = new Set([".blend", ".glb", ".png", ".webp", ".jpg", ".jpeg", ".fbx", ".gltf"]);
const textExtensions = new Set([".json", ".md", ".mjs", ".js", ".py", ".yml", ".yaml", ".toml", ".txt", ".lock", ".patch"]);
const machineLocalPathPattern = /(?:\/tmp\/|\/home\/|\/Users\/|\/private\/tmp\/|\/mnt\/[A-Za-z]\/|(?:^|[\s"'=(])[A-Za-z]:[\\/])/m;
const historicalRightsJsonPaths = new Set([
  ...Object.keys(historicalEvidence),
  "source/metadata-release.json",
  "provenance/baked-lightmap-0.2.0.json"
]);

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

async function relativeFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await relativeFiles(join(directory, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function assertRecord(actual, expected, code) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), code);
}

function withinTolerance(recorded, actual, tolerance) {
  return Number.isFinite(recorded) && Number.isFinite(actual) && Math.abs(recorded - actual) <= tolerance;
}

const [config, packageJson, manifest, acceptedLock, acceptanceIndex, capturePlan, visualConfig, captureBinding, stability, visualParity, reviews] = await Promise.all([
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, "package.json")),
  readJson(join(root, "manifest.json")),
  readJson(join(root, release.acceptanceLockPath)),
  readJson(join(root, release.acceptanceIndexPath)),
  readJson(join(root, release.capturePlanPath)),
  readJson(join(root, release.visualConfigPath)),
  readJson(join(root, release.runtimeEvidencePath, "capture-binding.json")),
  readJson(join(root, release.runtimeEvidencePath, "stability.json")),
  readJson(join(root, release.runtimeEvidencePath, "visual-parity.json")),
  reviewEvidence()
]);

assert(config.schemaVersion === 1 && config.oneSceneOnly === true && config.sceneId === release.sceneId, "repository_identity_mismatch");
assert(config.releaseVersion === release.version && config.releaseMaterialized === true && packageJson.version === release.version, "repository_release_version_mismatch");
assert(config.status === release.status && config.humanAcceptance === release.humanAcceptance, "repository_review_gate_mismatch");
assertRecord({ rightsStatus: config.rightsStatus, rightsApproved: config.rightsApproved, rightsApprovalDate: config.rightsApprovalDate, licenseRef: config.licenseRef }, {
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  rightsApprovalDate: null,
  licenseRef: null
}, "repository_rights_gate_mismatch");
assert(config.isCurrent === false && config.publicationReady === false, "repository_activation_claim");
assert(config.platformValidatorCommit === release.platformValidatorCommit, "repository_platform_pin_mismatch");
assert((await readFile(join(root, "platform-validator.lock"), "utf8")).trim() === release.platformValidatorCommit, "platform_lock_mismatch");
assert(packageJson.scripts.test === "node --test tests/*.test.mjs", "active_test_command_mismatch");
assert(packageJson.scripts.validate === "node scripts/validate-release-0.3.mjs", "active_validation_command_mismatch");
assert(packageJson.scripts["validate:visual"] === "node scripts/validate-release-0.3.mjs --visual-only", "active_visual_validation_command_mismatch");
assert(packageJson.scripts["verify:reproducibility"] === "node scripts/verify-release-0.3-reproducibility.mjs", "active_reproducibility_command_mismatch");

const versions = manifest.releases.map(({ version }) => version);
assert(JSON.stringify(versions) === JSON.stringify(["0.1.0", "0.1.1", "0.2.0", release.version]), "release_history_not_append_only");
assert(manifest.status === release.status && manifest.humanAcceptance === release.humanAcceptance && manifest.publicationReady === false, "manifest_review_gate_mismatch");
assertRecord({ rightsStatus: manifest.rightsStatus, rightsApproved: manifest.rightsApproved, rightsApprovalDate: manifest.rightsApprovalDate, licenseRef: manifest.licenseRef }, {
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  rightsApprovalDate: null,
  licenseRef: null
}, "manifest_rights_gate_mismatch");
assert(manifest.platformValidatorCommit === release.platformValidatorCommit, "manifest_platform_pin_mismatch");

for (const [version, expectedFiles] of Object.entries(historicalFiles)) {
  const record = manifest.releases.find((candidate) => candidate.version === version);
  assert(record && record.platformValidatorCommit === historicalPins[version], `historical_release_pin_mismatch:${version}`);
  assert(record.status === "review" && record.humanAcceptance === "pending-human-acceptance" && record.isCurrent === false && record.publicationReady === false, `historical_release_gate_mismatch:${version}`);
  assert(record.rightsStatus === approvedRightsStatus && record.rightsApproved === true, `historical_release_rights_changed:${version}`);
  for (const [name, expected] of Object.entries(expectedFiles)) {
    assertRecord(record.files[name], expected, `historical_manifest_record_changed:${version}:${name}`);
    assertRecord(await fileRecord(join(root, record.releasePath, name)), expected, `historical_release_bytes_changed:${version}:${name}`);
  }
}
for (const [repositoryPath, expected] of Object.entries(historicalEvidence)) {
  assertRecord(await fileRecord(join(root, repositoryPath)), expected, `historical_evidence_changed:${repositoryPath}`);
}

const versionDirectories = (await readdir(join(root, "assets/scenes", release.sceneId), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert(JSON.stringify(versionDirectories) === JSON.stringify([...versions].sort()), "release_directory_set_mismatch");
for (const manifestRelease of manifest.releases) {
  const entries = (await readdir(join(root, manifestRelease.releasePath), { withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  assert(JSON.stringify(entries) === JSON.stringify([...requiredReleaseFiles].sort()), `release_file_set_mismatch:${manifestRelease.version}`);
}

assert(acceptedLock.schemaVersion === 1 && acceptedLock.status === "review-source-lock" && acceptedLock.sceneId === release.sceneId, "accepted_lock_identity_mismatch");
assertPendingGates(acceptedLock, release.acceptanceLockPath);
for (const [key, repositoryPath] of Object.entries(acceptedLock.acceptedSource).filter(([key]) => key.endsWith("Path"))) {
  const prefix = key.slice(0, -4);
  const expected = {
    sha256: acceptedLock.acceptedSource[`${prefix}Sha256`],
    sizeBytes: acceptedLock.acceptedSource[`${prefix}SizeBytes`]
  };
  assertRecord(await fileRecord(join(root, repositoryPath)), expected, `accepted_source_record_mismatch:${key}`);
}
assert(acceptedLock.acceptedSource.blendSha256 === release.accepted.sourceBlendSha256, "accepted_source_config_drift");
assert(acceptedLock.acceptedSource.authorScriptSha256 === release.accepted.authorScriptSha256, "accepted_author_script_config_drift");
assert(acceptedLock.acceptedSource.exportScriptSha256 === release.accepted.exportScriptSha256, "accepted_export_script_config_drift");
assert(acceptedLock.acceptedSource.lightmapSha256 === release.accepted.lightmapSha256, "accepted_lightmap_config_drift");
assert(acceptedLock.acceptedSource.sceneRealityContractSha256 === release.accepted.realitySha256, "accepted_reality_config_drift");
assert(acceptedLock.acceptedSource.captureHarnessPatchSha256 === release.runtimeCapture.harnessPatchSha256, "accepted_capture_harness_config_drift");
assert(acceptedLock.acceptedSource.runtimeCapturePlanSha256 === release.runtimeCapture.capturePlanSha256, "accepted_capture_plan_config_drift");
const expectedToolingPaths = await repositoryToolingPaths(root);
assertRecord(acceptedLock.tooling.map(({ path }) => path), expectedToolingPaths, "accepted_tooling_paths_mismatch");
for (const record of acceptedLock.tooling) {
  assertRecord(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `accepted_tooling_record_mismatch:${record.path}`);
}
assert(acceptedLock.boundaries.runtimeCaptureArtifactsValidated === true && acceptedLock.boundaries.visualAccepted === false && acceptedLock.boundaries.rightsApproved === false, "accepted_runtime_boundary_mismatch");
assert(acceptedLock.reviewViews.length === release.reviewViews.length, "accepted_review_view_count_mismatch");
for (const [index, review] of reviews.entries()) {
  const locked = acceptedLock.reviewViews[index];
  assert(locked.id === review.id && locked.path === review.path && locked.sha256 === review.sha256 && locked.sizeBytes === review.sizeBytes, `accepted_review_record_mismatch:${review.id}`);
  assert(locked.meanLuminance === review.meanLuminance && locked.darkPixelRatioBelow10Percent === review.darkPixelRatioBelow10Percent, `accepted_review_metric_mismatch:${review.id}`);
}

assert(acceptanceIndex.schemaVersion === 1 && acceptanceIndex.sceneId === release.sceneId && acceptanceIndex.releases.length >= 1, "acceptance_index_identity_mismatch");
assert(new Set(acceptanceIndex.releases.map(({ version }) => version)).size === acceptanceIndex.releases.length, "acceptance_index_duplicate_versions");
const acceptance = acceptanceIndex.releases.find(({ version }) => version === release.version);
assert(acceptance?.version === release.version && acceptance.lockPath === release.acceptanceLockPath && acceptance.visualParityConfigPath === release.visualConfigPath, "acceptance_index_release_mismatch");
assert((await fileRecord(join(root, acceptance.lockPath))).sha256 === acceptance.lockSha256, "acceptance_lock_digest_drift");
assert((await fileRecord(join(root, acceptance.visualParityConfigPath))).sha256 === acceptance.visualParityConfigSha256, "visual_config_digest_drift");

assert(capturePlan.schemaVersion === 1 && capturePlan.sceneId === release.sceneId && capturePlan.releaseVersion === release.version, "capture_plan_identity_mismatch");
assertPendingGates(capturePlan, release.capturePlanPath);
assert((await fileRecord(join(root, release.capturePlanPath))).sha256 === release.runtimeCapture.capturePlanSha256, "capture_plan_digest_drift");
assert(capturePlan.capture.status === "pending-platform-dependent-local-capture" && capturePlan.capture.bindingFile === null && capturePlan.capture.evidencePath === null, "capture_plan_not_pre_capture");
assert(capturePlan.thresholds.finalThresholdsDefined === false && capturePlan.thresholds.perView === null && capturePlan.thresholds.aggregate === null, "capture_plan_fabricated_thresholds");

const actualRuntimeEvidenceNames = (await relativeFiles(join(root, release.runtimeEvidencePath))).sort();
assert(JSON.stringify(actualRuntimeEvidenceNames) === JSON.stringify([...runtimeEvidenceFiles].sort()), "runtime_evidence_file_set_mismatch");
assertPendingGates(captureBinding, `${release.runtimeEvidencePath}/capture-binding.json`);
assertPendingGates(stability, `${release.runtimeEvidencePath}/stability.json`);
assertPendingGates(visualParity, `${release.runtimeEvidencePath}/visual-parity.json`);
const capturedRuns = await Promise.all(release.runtimeCapture.runs.map(async (runId) => {
  const evidenceRunPath = `${release.runtimeEvidencePath}/runs/${runId}`;
  const [sceneDebug, settings] = await Promise.all([
    readJson(join(root, evidenceRunPath, "scene-debug.json")),
    readJson(join(root, evidenceRunPath, "capture-settings.json"))
  ]);
  assert(sceneDebug.bundleUrl === `local-capture/${runId}/scene.json` && sceneDebug.assetUrl === `local-capture/${runId}/scene.glb`, `runtime_capture_urls_not_normalized:${runId}`);
  const diagnostics = validateRuntimeDiagnostics(sceneDebug, settings);
  const measurement = await measureRuntimeCapture(join(root, evidenceRunPath), evidenceRunPath);
  const files = Object.fromEntries(await Promise.all(runtimeCaptureBaseFiles.map(async (name) => [
    name,
    { path: `${evidenceRunPath}/${name}`, ...await fileRecord(join(root, evidenceRunPath, name)) }
  ])));
  return { id: runId, diagnostics, measurement, files };
}));
const measuredStability = validateRuntimeStability(capturedRuns);
assert(stability.schemaVersion === 1 && stability.sceneId === release.sceneId && stability.releaseVersion === release.version, "runtime_stability_identity_mismatch");
assert(stability.runtimeBuildModified === false && stability.platformRuntimeCommit === release.platformValidatorCommit, "runtime_stability_platform_binding_mismatch");
for (const key of ["requiredRuns", "completedRuns", "fullViewIds", "allRunsComplete", "imageComparison", "perView", "diagnosticsDarkPixelRatio", "thresholdDerivation", "result"]) {
  assertRecord(stability[key], measuredStability[key], `runtime_stability_measurement_mismatch:${key}`);
}
assert(stability.runs.length === capturedRuns.length, "runtime_stability_recorded_run_count_mismatch");
for (const [index, run] of capturedRuns.entries()) {
  const recorded = stability.runs[index];
  assert(recorded.id === run.id && recorded.result === "passed", `runtime_stability_recorded_run_mismatch:${run.id}`);
  assertRecord(recorded.viewIds, release.reviewViews, `runtime_stability_view_set_mismatch:${run.id}`);
  assertRecord(recorded.diagnostics, run.diagnostics, `runtime_stability_diagnostics_mismatch:${run.id}`);
  assertRecord(recorded.files, run.files, `runtime_stability_files_mismatch:${run.id}`);
}
const canonicalRun = capturedRuns.find(({ id }) => id === release.runtimeCapture.canonicalRunId);
assert(canonicalRun, "runtime_canonical_run_missing");
const measuredParity = canonicalRun.measurement;
const tolerance = release.runtimeCapture.visualParity.metricTolerance;
const expectedCaptureRuns = release.runtimeCapture.runs.map((id) => ({
  id,
  viewIds: release.reviewViews,
  result: "passed"
}));
assert(visualParity.result === "passed" && visualParity.technicalResult === "passed" && visualParity.humanAcceptanceRecorded === false, "runtime_visual_parity_status_mismatch");
assert(visualParity.runtimeBuildModified === false && visualParity.platformRuntimeCommit === release.platformValidatorCommit, "runtime_visual_platform_binding_mismatch");
assert(visualParity.canonicalRunId === release.runtimeCapture.canonicalRunId, "runtime_visual_canonical_run_mismatch");
assertRecord(visualParity.normalization, release.runtimeCapture.normalization, "runtime_capture_normalization_mismatch");
assertRecord(visualParity.capturePlan, { path: release.capturePlanPath, ...await fileRecord(join(root, release.capturePlanPath)) }, "runtime_visual_capture_plan_mismatch");
assertRecord(visualParity.runs, expectedCaptureRuns, "runtime_visual_runs_mismatch");
assertRecord(visualParity.diagnostics, Object.fromEntries(capturedRuns.map(({ id, diagnostics }) => [id, diagnostics])), "runtime_visual_diagnostics_mismatch");
assertRecord(visualParity.stability, { path: `${release.runtimeEvidencePath}/stability.json`, ...await fileRecord(join(root, release.runtimeEvidencePath, "stability.json")), result: measuredStability.result }, "runtime_visual_stability_mismatch");
assert(visualParity.metricTool === measuredParity.metricTool && visualParity.metricToolVersion === measuredParity.metricToolVersion, "runtime_visual_metric_tool_mismatch");
assertRecord(visualParity.metricTolerance, tolerance, "runtime_visual_tolerance_mismatch");
assertRecord(visualParity.aggregateThreshold, release.runtimeCapture.visualParity.aggregate, "runtime_visual_threshold_mismatch");
assert(visualParity.views.length === measuredParity.views.length, "runtime_visual_view_count_mismatch");
for (const [index, measured] of measuredParity.views.entries()) {
  const recorded = visualParity.views[index];
  assert(recorded.id === measured.id && recorded.status === "passed" && JSON.stringify(recorded.threshold) === JSON.stringify(measured.threshold), `runtime_visual_record_mismatch:${measured.id}`);
  assertRecord(recorded.reference, measured.reference, `runtime_visual_reference_mismatch:${measured.id}`);
  assertRecord(recorded.capture, measured.capture, `runtime_visual_capture_mismatch:${measured.id}`);
  assert(withinTolerance(recorded.phash, measured.phash, tolerance.perViewPhashAbsolute), `runtime_visual_phash_drift:${measured.id}`);
  assert(withinTolerance(recorded.ncc, measured.ncc, tolerance.perViewNccAbsolute), `runtime_visual_ncc_drift:${measured.id}`);
}
assert(withinTolerance(visualParity.aggregate.phashTotal, measuredParity.aggregate.phashTotal, tolerance.aggregatePhashAbsolute), "runtime_visual_aggregate_phash_drift");
assert(withinTolerance(visualParity.aggregate.nccMean, measuredParity.aggregate.nccMean, tolerance.aggregateNccAbsolute), "runtime_visual_aggregate_ncc_drift");
assert(captureBinding.recordType === "candidate-local-repeated-capture-record" && captureBinding.platformRuntimeCommit === release.platformValidatorCommit && captureBinding.runtimeBuildModified === false, "runtime_capture_binding_identity_mismatch");
assert(captureBinding.provenanceScope?.candidateCiReplaysCapture === false
  && captureBinding.provenanceScope?.candidateCiValidatesCommittedArtifacts === true
  && captureBinding.provenanceScope?.independentVerification === "required-on-exact-merge-sha-staging", "runtime_capture_provenance_scope_mismatch");
assert(captureBinding.captureHarness.sourceSha256 === release.runtimeCapture.harnessSourceSha256 && captureBinding.captureHarness.patchSha256 === release.runtimeCapture.harnessPatchSha256 && captureBinding.captureHarness.patchedSha256 === release.runtimeCapture.patchedHarnessSha256, "runtime_capture_harness_binding_mismatch");
assertRecord(captureBinding.execution.runs, expectedCaptureRuns, "runtime_capture_runs_mismatch");
assert(captureBinding.execution.canonicalRunId === release.runtimeCapture.canonicalRunId, "runtime_capture_canonical_run_mismatch");
assertRecord(captureBinding.execution.settings, release.runtimeCapture.captureSettings, "runtime_capture_settings_mismatch");
assertRecord(captureBinding.execution.normalization, release.runtimeCapture.normalization, "runtime_capture_execution_normalization_mismatch");
assertRecord(captureBinding.inputs.capturePlan, { path: release.capturePlanPath, ...await fileRecord(join(root, release.capturePlanPath)) }, "runtime_capture_plan_binding_mismatch");
assertRecord(captureBinding.inputs.sceneGlb, { path: `${release.releasePath}/scene.glb`, ...await fileRecord(join(root, release.releasePath, "scene.glb")) }, "runtime_capture_glb_binding_mismatch");
assertRecord(captureBinding.inputs.sceneManifest, { path: `${release.releasePath}/scene.json`, ...await fileRecord(join(root, release.releasePath, "scene.json")) }, "runtime_capture_manifest_binding_mismatch");
assertRecord(captureBinding.diagnostics, Object.fromEntries(capturedRuns.map(({ id, diagnostics }) => [id, diagnostics])), "runtime_capture_diagnostics_binding_mismatch");
assertRecord(captureBinding.stability, { path: `${release.runtimeEvidencePath}/stability.json`, ...await fileRecord(join(root, release.runtimeEvidencePath, "stability.json")), result: measuredStability.result }, "runtime_capture_stability_binding_mismatch");
assert(JSON.stringify(Object.keys(captureBinding.captureFiles).sort()) === JSON.stringify(runtimeEvidenceFiles.filter((name) => name !== "capture-binding.json").sort()), "runtime_capture_binding_file_set_mismatch");
for (const [name, record] of Object.entries(captureBinding.captureFiles)) {
  assertRecord(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `runtime_capture_file_binding_mismatch:${name}`);
}

assert(visualConfig.schemaVersion === 1 && visualConfig.sceneId === release.sceneId && visualConfig.releaseVersion === release.version, "visual_config_identity_mismatch");
assertPendingGates(visualConfig, release.visualConfigPath);
assert(visualConfig.capture.status === "passed-repeatable-technical-local-capture" && visualConfig.capture.platformCommit === release.platformValidatorCommit && visualConfig.capture.runtimeBuildModified === false, "runtime_capture_status_mismatch");
assert(visualConfig.capture.bindingFile === `${release.runtimeEvidencePath}/capture-binding.json` && visualConfig.capture.stabilityFile === `${release.runtimeEvidencePath}/stability.json` && visualConfig.capture.evidencePath === release.runtimeEvidencePath, "runtime_capture_evidence_binding_mismatch");
assertRecord(visualConfig.capture.diagnosticsFiles, release.runtimeCapture.runs.map((id) => `${release.runtimeEvidencePath}/runs/${id}/scene-debug.json`), "runtime_capture_diagnostics_paths_mismatch");
assert(visualConfig.capture.canonicalRunId === release.runtimeCapture.canonicalRunId && visualConfig.capture.stabilitySha256 === (await fileRecord(join(root, release.runtimeEvidencePath, "stability.json"))).sha256, "runtime_capture_stability_record_mismatch");
assert(visualConfig.capture.bindingSha256 === (await fileRecord(join(root, release.runtimeEvidencePath, "capture-binding.json"))).sha256, "runtime_capture_binding_digest_drift");
assert(visualConfig.thresholds.state === release.runtimeCapture.visualParity.thresholdState && visualConfig.thresholds.finalThresholdsDefined === true, "runtime_visual_threshold_state_mismatch");
assertRecord(visualConfig.thresholds.perView, release.runtimeCapture.visualParity.perView, "runtime_visual_per_view_threshold_mismatch");
assertRecord(visualConfig.thresholds.aggregate, release.runtimeCapture.visualParity.aggregate, "runtime_visual_aggregate_threshold_mismatch");
assertRecord(visualConfig.thresholds.derivation, measuredStability.thresholdDerivation, "runtime_visual_threshold_derivation_mismatch");
assert(visualConfig.views.length === reviews.length, "visual_config_view_count_mismatch");
for (const [index, view] of visualConfig.views.entries()) {
  const review = reviews[index];
  const measured = measuredParity.views[index];
  assert(view.id === review.id && view.referenceSha256 === review.sha256 && view.referenceSizeBytes === review.sizeBytes, `visual_config_reference_mismatch:${review.id}`);
  assert(view.captureFile === `${release.runtimeEvidencePath}/runs/${release.runtimeCapture.canonicalRunId}/${review.id}.png` && view.captureSha256 === release.runtimeCapture.acceptedViews[review.id].sha256, `visual_config_capture_mismatch:${review.id}`);
  assert(withinTolerance(view.phash, measured.phash, tolerance.perViewPhashAbsolute) && withinTolerance(view.ncc, measured.ncc, tolerance.perViewNccAbsolute) && view.status === "passed", `visual_config_metric_mismatch:${review.id}`);
}

if (visualOnly) {
  process.stdout.write(`0.3.0 source and three-run runtime visual evidence valid across ${reviews.length} views; human acceptance remains pending.\n`);
  process.exit(0);
}

const releaseRecord = manifest.releases.at(-1);
assert(releaseRecord.version === release.version && releaseRecord.baseVersion === release.baseVersion && releaseRecord.releaseKind === release.releaseKind, "release_manifest_identity_mismatch");
assert(releaseRecord.status === release.status && releaseRecord.humanAcceptance === release.humanAcceptance, "release_manifest_review_gate_mismatch");
assert(releaseRecord.rightsStatus === release.rightsStatus && releaseRecord.rightsApproved === false && releaseRecord.rightsApprovalDate === null && releaseRecord.licenseRef === null, "release_manifest_rights_gate_mismatch");
assert(releaseRecord.isCurrent === false && releaseRecord.publicationReady === false, "release_manifest_activation_claim");
assert(releaseRecord.renderProfile === release.renderProfile && releaseRecord.platformValidatorCommit === release.platformValidatorCommit, "release_manifest_profile_or_pin_mismatch");
assert(releaseRecord.provenancePath === `${release.provenancePath}/release-provenance.json`, "release_provenance_path_mismatch");
for (const name of requiredReleaseFiles) {
  assertRecord(await fileRecord(join(root, release.releasePath, name)), releaseRecord.files[name], `release_file_record_mismatch:${name}`);
}
assert(releaseRecord.files["scene.glb"].sha256 === release.accepted.releaseGlbSha256 && releaseRecord.files["scene.glb"].sizeBytes === release.accepted.releaseGlbSizeBytes, "release_glb_config_mismatch");
assert(releaseRecord.files["preview.webp"].sha256 === reviews[0].sha256, "release_preview_source_mismatch");
assert(releaseRecord.files["LICENSES.md"].sha256 !== historicalFiles["0.2.0"]["LICENSES.md"].sha256, "pending_rights_notice_reused_approved_license");

const scene = await readJson(join(root, release.releasePath, "scene.json"));
assertPendingGates(scene, `${release.releasePath}/scene.json`);
assert(scene.sceneId === release.sceneId && scene.version === release.version && scene.glbSha256 === release.accepted.releaseGlbSha256, "release_scene_identity_mismatch");
assert(scene.source === release.sourceBlendPath && scene.renderProfile === release.renderProfile, "release_scene_source_or_profile_mismatch");
assert(scene.rights.status === release.rightsStatus && scene.rights.rightsApproved === false && scene.rights.clearedFor.length === 0, "release_scene_rights_claim");
assert(scene.rights.externalAssetsUsed === false && scene.rights.licenseRef === null, "release_scene_external_or_license_claim");
const preview = await sharp(join(root, release.releasePath, "preview.webp")).metadata();
assert(preview.format === "webp" && preview.width === release.reviewImages.width && preview.height === release.reviewImages.height, "release_preview_format_mismatch");

const candidate = await validateCandidate(join(root, release.releasePath, "scene.glb"));
assertRecord(candidate.stats, releaseRecord.stats, "release_stats_mismatch");
assert(candidate.geometry.sha256 === acceptedLock.geometry.sha256 && candidate.geometry.unchanged === true, "release_geometry_lock_mismatch");
assertRecord(releaseRecord.reproducibility, acceptedLock.reproducibility, "release_reproducibility_lock_mismatch");
assert(releaseRecord.reproducibility.runs === 2 && releaseRecord.reproducibility.result === "byte-identical-glb", "release_reproducibility_claim_missing");

const provenanceNames = [
  "generation-ledger.json",
  "release-asset-ledger.json",
  "release-provenance.json",
  "runtime-coordinates.json",
  "scene-reality-report.json",
  "visual-review.json"
];
const actualProvenanceNames = (await readdir(join(root, release.provenancePath), { withFileTypes: true }))
  .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
assert(JSON.stringify(actualProvenanceNames) === JSON.stringify([...provenanceNames].sort()), "release_provenance_file_set_mismatch");
const [assetLedger, generationLedger, runtimeCoordinates, realityReport, visualReview, releaseProvenance] = await Promise.all([
  readJson(join(root, release.provenancePath, "release-asset-ledger.json")),
  readJson(join(root, release.provenancePath, "generation-ledger.json")),
  readJson(join(root, release.provenancePath, "runtime-coordinates.json")),
  readJson(join(root, release.provenancePath, "scene-reality-report.json")),
  readJson(join(root, release.provenancePath, "visual-review.json")),
  readJson(join(root, release.provenancePath, "release-provenance.json"))
]);
for (const [name, value] of [["asset-ledger", assetLedger], ["generation-ledger", generationLedger], ["reality-report", realityReport], ["visual-review", visualReview], ["release-provenance", releaseProvenance]]) {
  assertPendingGates(value, `${release.provenancePath}/${name}`);
}
assert(assetLedger.ownershipBasis === "entirely-project-authored" && assetLedger.externalAssetsUsed === false, "asset_ledger_origin_mismatch");
assert(assetLedger.embeddedGeneratedTextures.length === 7 && assetLedger.embeddedGeneratedTextures.every(({ externalSource }) => externalSource === null), "generated_texture_ledger_incomplete");
for (const record of assetLedger.records) {
  assertRecord(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `asset_ledger_record_mismatch:${record.path}`);
}
assert(generationLedger.externalAssetsUsed === false && generationLedger.steps.length === 5, "generation_ledger_incomplete");
assertRecord(generationLedger.tooling.map(({ path }) => path), expectedToolingPaths, "generation_tooling_paths_mismatch");
assertRecord(generationLedger.tooling, acceptedLock.tooling, "generation_and_accepted_tooling_mismatch");
for (const record of generationLedger.tooling) {
  assertRecord(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `generation_tooling_record_mismatch:${record.path}`);
}
assert(runtimeCoordinates.status === "passed" && runtimeCoordinates.transform === "x=x,y=y,z=-z", "runtime_coordinate_report_mismatch");
assert(runtimeCoordinates.checks.spawnPoints === 1 && runtimeCoordinates.checks.seatAnchors === 8 && runtimeCoordinates.checks.mediaSurfaces === 1, "runtime_coordinate_binding_coverage_mismatch");
assert(runtimeCoordinates.checks.sceneManifestSpawnBindingsMatch === true && runtimeCoordinates.checks.sceneManifestSeatBindingsMatch === true && runtimeCoordinates.checks.sceneManifestMediaBindingsMatch === true, "runtime_coordinate_manifest_binding_mismatch");
assert(realityReport.status === "passed" && realityReport.result === "passed", "scene_reality_report_failed");
assert(realityReport.geometry.unchanged === true && realityReport.geometry.sha256 === release.accepted.geometryFingerprintSha256, "scene_reality_geometry_mismatch");
assert(realityReport.meshTags.validatedParts === 193 && realityReport.khronos.errors === 0 && realityReport.khronos.warnings === 0, "scene_reality_glb_validation_mismatch");
assert(visualReview.sourceReview.status === "passed-technical-source-review" && visualReview.runtimeParity.status === "passed-repeatable-technical-local-capture", "visual_review_status_mismatch");
assert(visualReview.runtimeParity.thresholdsDefined === true && visualReview.runtimeParity.result === "passed" && visualReview.visualAccepted === false, "visual_review_acceptance_claim");
assert(visualReview.runtimeParity.stabilityResult === release.runtimeCapture.stability.requiredResult, "visual_review_stability_claim_missing");
assert(visualReview.runtimeParity.bindingSha256 === (await fileRecord(join(root, release.runtimeEvidencePath, "capture-binding.json"))).sha256, "visual_review_binding_mismatch");
assert(releaseProvenance.release.files["scene.glb"].sha256 === release.accepted.releaseGlbSha256, "release_provenance_glb_mismatch");
assertRecord(releaseProvenance.source.acceptanceIndex, {
  path: release.acceptanceIndexPath,
  ...acceptanceIndexEntryRecord(acceptanceIndex, release.version)
}, "release_acceptance_entry_digest_mismatch");
assert(releaseProvenance.runtimeCapture.status === "passed-repeatable-technical-local-capture" && releaseProvenance.runtimeCapture.evidencePath === release.runtimeEvidencePath && releaseProvenance.runtimeCapture.runtimeBuildModified === false, "release_provenance_runtime_claim");
assert(releaseProvenance.runtimeCapture.stability.result === release.runtimeCapture.stability.requiredResult, "release_provenance_stability_claim_missing");
assert(releaseProvenance.runtimeCapture.binding.sha256 === (await fileRecord(join(root, releaseProvenance.runtimeCapture.binding.path))).sha256, "release_provenance_runtime_binding_mismatch");
for (const [name, expected] of Object.entries(releaseProvenance.evidenceFiles)) {
  assertRecord(await fileRecord(join(root, release.provenancePath, name)), expected, `release_provenance_evidence_record_mismatch:${name}`);
}

const sourceReleaseEntries = (await readdir(join(root, `source/releases/${release.version}`), { withFileTypes: true }))
  .map((entry) => entry.name).sort();
assert(JSON.stringify(sourceReleaseEntries) === JSON.stringify([
  "accepted-lightmap.png",
  "accepted-scene.blend",
  "accepted-source-lock.json",
  "author-release.py",
  "capture-harness.patch",
  "export-release.py",
  "review",
  "runtime-capture-plan.json",
  "scene-reality.json",
  "user-scenarios.json",
  "visual-parity-config.json"
]), "versioned_source_file_set_mismatch");

const allowedBinaryPaths = new Set([
  "source/review-candidate.blend",
  "source/baked-review-lightmap-0.2.0.png",
  ...["entry", "audience", "presenter", "diagonal-overview"].map((id) => `source/review/${id}.webp`),
  ...release.reviewViews.map((id) => `${release.sourceReviewPath}/${id}.webp`),
  release.sourceBlendPath,
  release.lightmapPath,
  ...release.runtimeCapture.runs.flatMap((runId) => release.reviewViews.map((id) => `${release.runtimeEvidencePath}/runs/${runId}/${id}.png`)),
  ...manifest.releases.flatMap((manifestRelease) => [
    `${manifestRelease.releasePath}/scene.glb`,
    `${manifestRelease.releasePath}/preview.webp`
  ]),
  ...["entry.png", "audience.png", "presenter.png", "diagonal-overview.png", "preview.webp"].map((name) => `provenance/runtime-capture-0.2.0/${name}`)
]);
for (const path of await walk(root)) {
  const repositoryPath = posix(relative(root, path));
  const extension = extname(repositoryPath).toLowerCase();
  if (binaryExtensions.has(extension)) assert(allowedBinaryPaths.has(repositoryPath), `unexpected_binary:${repositoryPath}`);
  if (textExtensions.has(extension) || repositoryPath === ".gitignore") {
    const text = await readFile(path, "utf8");
    assert(!machineLocalPathPattern.test(text), `machine_local_absolute_path:${repositoryPath}`);
    if (extension === ".json") {
      const allowApprovedRights = historicalRightsJsonPaths.has(repositoryPath)
        || repositoryPath.startsWith(`assets/scenes/${release.sceneId}/0.1.`)
        || repositoryPath.startsWith(`assets/scenes/${release.sceneId}/0.2.`)
        || repositoryPath.startsWith("provenance/runtime-capture-0.2.0/");
      assertPendingGates(JSON.parse(text), repositoryPath, {
        allowApprovedRights,
        allowHistoricalManifestRecords: repositoryPath === "manifest.json"
      });
    }
  }
}
const acceptedBlendText = (await readFile(join(root, release.sourceBlendPath))).toString("latin1");
assert(!machineLocalPathPattern.test(acceptedBlendText), `machine_local_absolute_path:${release.sourceBlendPath}`);
assert(!/https?:\/\//i.test(acceptedBlendText)
  && !acceptedBlendText.includes("0dac0b05ae44d0d8663c049cdde90b2ced7ef559_1_500x500.jpg"), `external_reference_in_blend:${release.sourceBlendPath}`);

const workflow = await readFile(join(root, ".github/workflows/validate.yml"), "utf8");
assert(workflow.includes("source/releases/*") && workflow.includes("provenance/releases/*"), "ci_versioned_source_protection_missing");
assert(workflow.includes(release.blender.archiveSha256) && workflow.includes(release.blender.binarySha256), "ci_blender_pin_mismatch");
assert(workflow.includes(release.runtimeCapture.harnessSourceSha256) && workflow.includes(release.runtimeCapture.harnessPatchSha256) && workflow.includes(release.runtimeCapture.patchedHarnessSha256), "ci_capture_harness_pin_mismatch");
assert(workflow.includes("git apply --check") && workflow.includes("git apply --reverse"), "ci_capture_harness_transform_check_missing");
assert(workflow.includes("pnpm validate:visual") && workflow.includes("pnpm verify:reproducibility"), "ci_required_gate_missing");
assert(!workflow.includes("workflow_dispatch"), "ci_immutable_baseline_bypass");

process.stdout.write(`Repository valid: ${release.sceneId}@${release.version} is a four-file, non-current review candidate.\n`);
process.stdout.write(`Geometry unchanged at ${candidate.geometry.sha256}; Khronos ${candidate.khronos.errors} errors/${candidate.khronos.warnings} warnings.\n`);
process.stdout.write(`Bound runtime capture passed: PHASH total ${measuredParity.aggregate.phashTotal}, NCC mean ${measuredParity.aggregate.nccMean}.\n`);
process.stdout.write("Human visual acceptance and exact-byte rights approval remain pending.\n");
