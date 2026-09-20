import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import { acceptanceIndexEntryRecord, assert, fileRecord, readJson, repositoryToolingPaths } from "./lib.mjs";
import {
  assertPendingGates,
  cleanEvidenceFiles,
  normalEvidenceFiles,
  relativeFiles,
  requiredReleaseFiles,
  root,
  validateCandidate,
  validateCleanEvidence,
  validateMeasurements,
  validateNormalEvidence
} from "./release-0.4-lib.mjs";
import { release040 as release } from "./release-0.4-config.mjs";

const visualOnly = process.argv.includes("--visual-only");
assert(process.argv.slice(2).every((argument) => argument === "--visual-only"), "unknown_validation_argument");

function same(actual, expected, code) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), code);
}

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
  },
  "0.3.0": {
    "LICENSES.md": { sha256: "102bd89beea0f9c977be7960edd39f66583520ba9984bbc9f5d959b572be26f1", sizeBytes: 540 },
    "preview.webp": { sha256: "22463ea1360e42638a6482515347e67c8cf32a0fd985671f11fae3083d0ac78e", sizeBytes: 48764 },
    "scene.glb": { sha256: "56078fd9cf298424ef5f219abd19e5a5fa8e1c5e0cd96224eddfe8e5bd937b30", sizeBytes: 13333276 },
    "scene.json": { sha256: "6ad08fb2a5d2559adb060ffb295e773ece643533a906cba6dfe519e0781310d8", sizeBytes: 5036 }
  }
};

const [repository, packageJson, manifest, acceptanceIndex, acceptedLock, visualConfig, captureBinding, releaseProvenance] = await Promise.all([
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, "package.json")),
  readJson(join(root, "manifest.json")),
  readJson(join(root, release.acceptanceIndexPath)),
  readJson(join(root, release.acceptanceLockPath)),
  readJson(join(root, release.visualConfigPath)),
  readJson(join(root, release.runtimeEvidencePath, "capture-binding.json")),
  readJson(join(root, release.provenancePath, "release-provenance.json"))
]);

assert(repository.sceneId === release.sceneId && repository.oneSceneOnly === true && repository.releaseVersion === release.version && repository.releaseMaterialized === true, "repository_identity_mismatch");
assert(repository.status === release.status && repository.qualityOutcome === release.qualityOutcome && repository.humanAcceptance === release.humanAcceptance, "repository_quality_gate_mismatch");
assert(repository.rightsStatus === release.rightsStatus && repository.rightsApproved === false && repository.isCurrent === false && repository.publicationReady === false, "repository_human_gate_mismatch");
assert(repository.platformValidatorCommit === release.platformValidatorCommit, "repository_platform_pin_mismatch");
assert((await readFile(join(root, "platform-validator.lock"), "utf8")).trim() === release.platformValidatorCommit, "platform_lock_mismatch");
assert(packageJson.version === release.version && packageJson.devDependencies.meshoptimizer === "1.0.1", "package_release_or_decoder_mismatch");
assert(packageJson.scripts.validate === "node scripts/validate-release-0.4.mjs" && packageJson.scripts["validate:visual"] === "node scripts/validate-release-0.4.mjs --visual-only", "active_validation_command_mismatch");
assert(packageJson.scripts["verify:reproducibility"] === "node scripts/verify-release-0.4-reproducibility.mjs", "active_reproducibility_command_mismatch");

same(manifest.releases.map(({ version }) => version), ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0"], "release_history_not_append_only");
assert(manifest.status === release.status && manifest.humanAcceptance === release.humanAcceptance && manifest.publicationReady === false, "manifest_gate_mismatch");
assert(manifest.platformValidatorCommit === release.platformValidatorCommit && manifest.rightsStatus === release.rightsStatus && manifest.rightsApproved === false, "manifest_pin_or_rights_mismatch");
for (const [version, files] of Object.entries(historicalFiles)) {
  const historical = manifest.releases.find((candidate) => candidate.version === version);
  assert(historical && historical.status === "review" && historical.humanAcceptance === release.humanAcceptance && historical.isCurrent === false && historical.publicationReady === false, `historical_release_gate_mismatch:${version}`);
  for (const [name, record] of Object.entries(files)) {
    same(historical.files[name], record, `historical_manifest_record_changed:${version}:${name}`);
    same(await fileRecord(join(root, historical.releasePath, name)), record, `historical_release_bytes_changed:${version}:${name}`);
  }
}
const releaseRecord = manifest.releases.at(-1);
assert(releaseRecord.version === release.version && releaseRecord.baseVersion === release.baseVersion && releaseRecord.releaseKind === release.releaseKind, "release_manifest_identity_mismatch");
assert(releaseRecord.qualityOutcome === release.qualityOutcome && releaseRecord.rightsApproved === false && releaseRecord.isCurrent === false && releaseRecord.publicationReady === false, "release_manifest_gate_mismatch");
same(releaseRecord.stats, release.stats, "release_manifest_stats_mismatch");
same(releaseRecord.budgetAssessment, release.budget, "release_budget_assessment_mismatch");
assert(releaseRecord.reproducibility.result === "byte-identical-raw-glb" && releaseRecord.reproducibility.runs === 2, "release_reproducibility_scope_mismatch");

const releaseEntries = (await readdir(join(root, release.releasePath), { withFileTypes: true })).filter((entry) => entry.isFile()).map(({ name }) => name).sort();
same(releaseEntries, [...requiredReleaseFiles].sort(), "release_file_set_mismatch");
for (const name of requiredReleaseFiles) same(await fileRecord(join(root, release.releasePath, name)), releaseRecord.files[name], `release_file_record_mismatch:${name}`);
same(releaseRecord.files["scene.glb"], release.finalGlb, "release_glb_record_mismatch");
assert(releaseRecord.files["scene.json"].sha256 === release.sourceArtifacts.sceneManifest.sha256 && releaseRecord.files["preview.webp"].sha256 === release.preview.sha256, "release_manifest_or_preview_record_mismatch");
const scene = await readJson(join(root, release.releasePath, "scene.json"));
assert(scene.sceneId === release.sceneId && scene.version === release.version && scene.glbSha256 === release.finalGlb.sha256, "scene_manifest_identity_mismatch");
assert(scene.status === release.status && scene.isCurrent === false && scene.publicationReady === false && scene.humanAcceptance === release.humanAcceptance, "scene_manifest_gate_mismatch");
assert(scene.rights.approvalStatus === release.rightsStatus && scene.visual.reviewStage === "draft-quality-review", "scene_manifest_quality_or_rights_mismatch");
assert(scene.anchors.seatAnchors.length === 8 && scene.mediaSurfaces.length === 1 && scene.mediaSurfaces[0].surfaceId === "debug-main", "scene_runtime_binding_mismatch");
const preview = await sharp(join(root, release.releasePath, "preview.webp")).metadata();
assert(preview.format === "webp" && preview.width === 1280 && preview.height === 800, "release_preview_format_mismatch");

for (const artifact of Object.values(release.sourceArtifacts)) {
  const record = await fileRecord(join(root, release.sourcePath, artifact.target));
  assert(record.sha256 === artifact.sha256 && (!artifact.sizeBytes || record.sizeBytes === artifact.sizeBytes), `accepted_source_artifact_mismatch:${artifact.target}`);
}
assert((await fileRecord(join(root, release.sourcePath, release.captureHarness.target))).sha256 === release.captureHarness.sha256, "capture_harness_digest_mismatch");
assert((await fileRecord(join(root, release.sourcePath, release.captureRunnerConfig.target))).sha256 === release.captureRunnerConfig.sha256, "capture_runner_config_digest_mismatch");
await validateMeasurements();

const cleanPath = join(root, release.runtimeEvidencePath, release.cleanCapture.evidenceSubpath);
const normalPath = join(root, release.runtimeEvidencePath, release.normalCapture.evidenceSubpath);
await Promise.all([validateCleanEvidence(cleanPath), validateNormalEvidence(normalPath)]);
same(await relativeFiles(cleanPath), [...cleanEvidenceFiles].sort(), "clean_evidence_file_set_mismatch");
same(await relativeFiles(normalPath), [...normalEvidenceFiles].sort(), "normal_evidence_file_set_mismatch");
assert(captureBinding.recordType === "candidate-local-single-clean-and-normal-product-capture-record" && captureBinding.platformRuntimeCommit === release.platformValidatorCommit, "capture_binding_identity_mismatch");
assert(captureBinding.cleanCapture.repeatabilityClaimed === false && captureBinding.cleanCapture.qualityAcceptanceClaimed === false && captureBinding.threeRunEvidence === false, "capture_repeatability_or_quality_claim");
assert(captureBinding.normalProductCapture.renderedMediaFrame === "pending-not-evidenced" && captureBinding.normalProductCapture.mediaObjectLifecycleOnly === true, "capture_media_frame_claim");
assert(captureBinding.captureHarness.sha256 === release.captureHarness.sha256 && captureBinding.captureHarness.runnerConfigSha256 === release.captureRunnerConfig.sha256 && captureBinding.captureHarness.exactWorkers === 1, "capture_harness_binding_mismatch");
for (const record of [...captureBinding.cleanCapture.files, ...captureBinding.normalProductCapture.files]) same(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `capture_file_record_mismatch:${record.path}`);

assert(visualConfig.qualityOutcome === release.qualityOutcome && visualConfig.thresholds.finalThresholdsDefined === false, "visual_config_quality_claim");
assert(visualConfig.sourceToRuntimeFidelity.status === "failed-visible-material-regression", "visual_fidelity_failure_missing");
assert(visualConfig.normalProductEvidence.renderedMediaFrame === "pending-not-evidenced", "visual_media_frame_claim");
same(visualConfig.qualityAssessment.unresolvedDefects, release.unresolvedDefects, "visual_defect_list_mismatch");
assertPendingGates(visualConfig, release.visualConfigPath);
assertPendingGates(captureBinding, `${release.runtimeEvidencePath}/capture-binding.json`);

if (visualOnly) {
  process.stdout.write(`0.4.0 source, single clean capture, and normal-product evidence are byte-bound; quality remains ${release.qualityOutcome}.\n`);
  process.exit(0);
}

const candidate = await validateCandidate(join(root, release.releasePath, "scene.glb"));
same(candidate.stats, releaseRecord.stats, "validated_candidate_stats_mismatch");
assert(candidate.budget.status === "failed-unresolved-exception", "triangle_budget_failure_missing");

assert(acceptedLock.status === "review-source-lock" && acceptedLock.releaseVersion === release.version && acceptedLock.qualityOutcome === release.qualityOutcome, "accepted_lock_identity_mismatch");
assertPendingGates(acceptedLock, release.acceptanceLockPath);
for (const record of acceptedLock.acceptedSource) same(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `accepted_source_record_mismatch:${record.path}`);
same(acceptedLock.release.files, releaseRecord.files, "accepted_lock_release_files_mismatch");
same(acceptedLock.budgetAssessment, release.budget, "accepted_lock_budget_mismatch");
assert(acceptedLock.boundaries.repeatedRuntimeCaptureValidated === false && acceptedLock.boundaries.renderedMediaFrameValidated === false && acceptedLock.boundaries.visualAccepted === false && acceptedLock.boundaries.rightsApproved === false, "accepted_lock_boundary_claim");
const toolingPaths = await repositoryToolingPaths(root);
same(acceptedLock.tooling.map(({ path }) => path), toolingPaths, "accepted_tooling_path_mismatch");
for (const record of acceptedLock.tooling) same(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `accepted_tooling_record_mismatch:${record.path}`);

const indexed = acceptanceIndex.releases.find(({ version }) => version === release.version);
assert(indexed?.lockPath === release.acceptanceLockPath && indexed.visualParityConfigPath === release.visualConfigPath, "acceptance_index_release_mismatch");
assert(indexed.lockSha256 === (await fileRecord(join(root, indexed.lockPath))).sha256 && indexed.visualParityConfigSha256 === (await fileRecord(join(root, indexed.visualParityConfigPath))).sha256, "acceptance_index_digest_mismatch");
same(releaseProvenance.source.acceptanceIndex, { path: release.acceptanceIndexPath, ...acceptanceIndexEntryRecord(acceptanceIndex, release.version) }, "provenance_acceptance_index_mismatch");
assert(releaseProvenance.qualityOutcome === release.qualityOutcome && releaseProvenance.runtimeCapture.threeRunEvidence === false && releaseProvenance.runtimeCapture.renderedMediaFrame === "pending-not-evidenced", "release_provenance_quality_claim");
assert(releaseProvenance.visualAcceptance.status === release.humanAcceptance && releaseProvenance.visualAcceptance.evidencePath === null, "release_provenance_visual_claim");
assert(releaseProvenance.rights.status === release.rightsStatus && releaseProvenance.rights.rightsApproved === false, "release_provenance_rights_claim");
for (const [name, record] of Object.entries(releaseProvenance.evidenceFiles)) same(await fileRecord(join(root, release.provenancePath, name)), record, `provenance_evidence_record_mismatch:${name}`);

const provenanceNames = (await readdir(join(root, release.provenancePath), { withFileTypes: true })).filter((entry) => entry.isFile()).map(({ name }) => name).sort();
same(provenanceNames, ["generation-ledger.json", "release-asset-ledger.json", "release-provenance.json", "scene-reality-report.json", "visual-review.json"], "provenance_file_set_mismatch");
const [assetLedger, generationLedger, realityReport, visualReview] = await Promise.all([
  readJson(join(root, release.provenancePath, "release-asset-ledger.json")),
  readJson(join(root, release.provenancePath, "generation-ledger.json")),
  readJson(join(root, release.provenancePath, "scene-reality-report.json")),
  readJson(join(root, release.provenancePath, "visual-review.json"))
]);
for (const record of assetLedger.records) same(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes }, `asset_ledger_record_mismatch:${record.path}`);
same(generationLedger.tooling, acceptedLock.tooling, "generation_tooling_lock_mismatch");
assert(realityReport.status === "passed-technical-reality-checks" && realityReport.budgetAssessment.status === "failed-unresolved-exception", "reality_report_budget_claim");
assert(visualReview.qualityOutcome === release.qualityOutcome && visualReview.visualAccepted === false && visualReview.normalProduct.renderedMediaFrame === "pending-not-evidenced", "visual_review_claim");

const workflow = await readFile(join(root, ".github/workflows/validate.yml"), "utf8");
assert(workflow.includes(release.blender.archiveSha256) && workflow.includes(release.blender.binarySha256), "workflow_blender_pin_mismatch");
assert(workflow.includes(release.captureHarness.sha256) && workflow.includes(release.captureRunnerConfig.sha256), "workflow_capture_tool_pin_mismatch");
assert(workflow.includes("source/releases/*") && workflow.includes("provenance/releases/*") && workflow.includes("provenance/runtime-capture-*"), "workflow_immutability_protection_missing");
assert(workflow.includes("pnpm validate:visual") && workflow.includes("pnpm verify:reproducibility"), "workflow_required_gate_missing");
assert(!workflow.includes("workflow_dispatch"), "workflow_immutable_baseline_bypass");

process.stdout.write(`Repository valid: ${release.sceneId}@${release.version} is a four-file, non-current ${release.qualityOutcome} review release.\n`);
process.stdout.write(`Khronos ${candidate.khronos.errors} errors/${candidate.khronos.warnings} warnings; triangle budget remains ${release.budget.status}.\n`);
process.stdout.write("Human acceptance, exact-byte rights approval, rendered media-frame evidence, and promotion remain pending.\n");
