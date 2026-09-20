import { access, copyFile, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  acceptanceIndexEntryRecord,
  assert,
  assertGitAcceptanceIndexPrefix,
  assertUntrackedOutput,
  fileRecord,
  pathTrackedInGit,
  readJson,
  repositoryToolingPaths,
  writeJson
} from "./lib.mjs";
import {
  cleanEvidenceFiles,
  normalEvidenceFiles,
  recordsUnder,
  relativeFiles,
  requiredReleaseFiles,
  root,
  validateCandidate,
  validateCleanEvidence,
  validateMeasurements,
  validateNormalEvidence
} from "./release-0.4-lib.mjs";
import { release040 as release } from "./release-0.4-config.mjs";

const replaceUntracked = process.argv.includes("--replace-untracked");
assert(process.argv.slice(2).every((argument) => argument === "--replace-untracked"), "unknown_materialization_argument");
const stagingRoot = join(root, `build/materialize-${release.version}`);
const backupRoot = join(root, `build/materialize-backup-${release.version}`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function staged(repositoryPath) {
  return join(stagingRoot, repositoryPath);
}

async function stagedPathRecord(repositoryPath) {
  return { path: repositoryPath, ...await fileRecord(staged(repositoryPath)) };
}

async function verifyReplaceable(repositoryPath) {
  const target = join(root, repositoryPath);
  await assertUntrackedOutput(root, target);
  if (!await exists(target)) return;
  assert(replaceUntracked, `versioned_materialization_exists:${repositoryPath}`);
}

async function install(replacements) {
  await mkdir(backupRoot, { recursive: true });
  const backedUp = [];
  const installed = [];
  try {
    for (const replacement of replacements) {
      if (!await exists(replacement.target)) continue;
      await mkdir(dirname(replacement.backup), { recursive: true });
      await rename(replacement.target, replacement.backup);
      backedUp.push(replacement);
    }
    for (const replacement of replacements) {
      await mkdir(dirname(replacement.target), { recursive: true });
      await rename(replacement.staged, replacement.target);
      installed.push(replacement);
    }
  } catch (error) {
    try {
      for (const replacement of installed.reverse()) await rm(replacement.target, { recursive: true, force: true });
      for (const replacement of backedUp.reverse()) await rename(replacement.backup, replacement.target);
    } catch (rollbackError) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
      throw new AggregateError([error, rollbackError], `materialization_install_and_rollback_failed:${backupRoot}`);
    }
    await rm(backupRoot, { recursive: true, force: true });
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  await rm(backupRoot, { recursive: true, force: true });
  await rm(stagingRoot, { recursive: true, force: true });
}

for (const path of [release.sourcePath, release.releasePath, release.provenancePath, release.runtimeEvidencePath]) await verifyReplaceable(path);
assert(!await exists(backupRoot), `materialization_backup_requires_recovery:${relative(root, backupRoot)}`);

const [manifest, repository, acceptanceIndex] = await Promise.all([
  readJson(join(root, "manifest.json")),
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, release.acceptanceIndexPath))
]);
assert(JSON.stringify(manifest.releases.filter(({ version }) => version !== release.version).map(({ version }) => version))
  === JSON.stringify(["0.1.0", "0.1.1", "0.2.0", "0.3.0"]), "materialization_history_mismatch");
assert(manifest.releases.find(({ version }) => version === release.baseVersion), "materialization_base_release_missing");
if (manifest.releases.some(({ version }) => version === release.version)) {
  assert(replaceUntracked && !pathTrackedInGit(root, release.releasePath), "tracked_release_manifest_overwrite_forbidden");
}
assert(repository.sceneId === release.sceneId && repository.oneSceneOnly === true, "materialization_repository_identity_mismatch");
assert(acceptanceIndex.sceneId === release.sceneId && Array.isArray(acceptanceIndex.releases), "materialization_acceptance_index_invalid");

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(staged(release.sourcePath), { recursive: true });
for (const entry of release.authoredSourceEntries) {
  await cp(join(root, release.sourcePath, entry), staged(`${release.sourcePath}/${entry}`), { recursive: true });
}

for (const artifact of Object.values(release.sourceArtifacts)) {
  const input = join(root, release.buildInputPath, artifact.input);
  const record = await fileRecord(input);
  assert(record.sha256 === artifact.sha256 && (!artifact.sizeBytes || record.sizeBytes === artifact.sizeBytes), `accepted_input_mismatch:${artifact.input}`);
  await copyFile(input, staged(`${release.sourcePath}/${artifact.target}`));
}
for (const captureArtifact of [release.captureHarness, release.captureRunnerConfig]) {
  const input = resolve(root, captureArtifact.inputPath);
  const record = await fileRecord(input);
  assert(record.sha256 === captureArtifact.sha256, `capture_tool_input_mismatch:${captureArtifact.target}:${record.sha256}`);
  await copyFile(input, staged(`${release.sourcePath}/${captureArtifact.target}`));
}
await cp(join(root, release.buildInputPath, release.sourceReviewInput), staged(`${release.sourcePath}/review`), { recursive: true });

const candidate = await validateCandidate(
  join(root, release.buildInputPath, release.finalGlbInput),
  join(root, release.buildInputPath, release.sourceArtifacts.objectRegistry.input)
);
await validateMeasurements(staged(release.sourcePath));

await mkdir(staged(release.releasePath), { recursive: true });
const textureLedger = await readJson(join(root, release.sourcePath, "textures/source-ledger.json"));
const licenseLines = textureLedger.records.map((record) => `- ${record.name} ${record.channel}: ${record.license}, ${record.sourceUrl}, sha256 ${record.sha256}`);
const licenseNotice = `# Presentation Room 0.4.0 Review Candidate Inputs\n\nProject-authored geometry is combined with the following Poly Haven CC0-1.0 texture inputs:\n\n${licenseLines.join("\n")}\n\nThe public CC0 terms and exact downloaded bytes are recorded in the versioned source ledger. Human rights approval for the complete 0.4.0 release bytes remains pending. This notice does not grant publication, promotion, production activation, or human visual acceptance.\n`;
await Promise.all([
  writeFile(staged(`${release.releasePath}/LICENSES.md`), licenseNotice),
  copyFile(join(root, release.buildInputPath, release.preview.input), staged(`${release.releasePath}/preview.webp`)),
  copyFile(join(root, release.buildInputPath, release.finalGlbInput), staged(`${release.releasePath}/scene.glb`)),
  copyFile(join(root, release.buildInputPath, release.sourceArtifacts.sceneManifest.input), staged(`${release.releasePath}/scene.json`))
]);
const releaseFiles = Object.fromEntries(await Promise.all(requiredReleaseFiles.map(async (name) => [name, await fileRecord(staged(`${release.releasePath}/${name}`))])));
assert(JSON.stringify(releaseFiles["scene.glb"]) === JSON.stringify(release.finalGlb), "materialized_glb_mismatch");
assert(releaseFiles["scene.json"].sha256 === release.sourceArtifacts.sceneManifest.sha256, "materialized_scene_manifest_mismatch");
assert(releaseFiles["preview.webp"].sha256 === release.preview.sha256, "materialized_preview_mismatch");

const cleanPath = `${release.runtimeEvidencePath}/${release.cleanCapture.evidenceSubpath}`;
const normalPath = `${release.runtimeEvidencePath}/${release.normalCapture.evidenceSubpath}`;
await Promise.all([mkdir(staged(cleanPath), { recursive: true }), mkdir(staged(normalPath), { recursive: true })]);
for (const name of cleanEvidenceFiles.filter((name) => name !== "scene-debug.json")) {
  await copyFile(join(root, release.buildInputPath, release.cleanCapture.input, name), staged(`${cleanPath}/${name}`));
}
const buildDebug = await readJson(join(root, release.buildInputPath, release.cleanCapture.input, "scene-debug.json"));
await writeJson(staged(`${cleanPath}/scene-debug.json`), {
  ...buildDebug,
  bundleUrl: "candidate-local-capture/scene.json",
  assetUrl: "candidate-local-capture/scene.glb"
});
for (const name of normalEvidenceFiles) {
  await copyFile(join(root, release.buildInputPath, release.normalCapture.input, name), staged(`${normalPath}/${name}`));
}

const cleanRecords = await Promise.all(cleanEvidenceFiles.map((name) => stagedPathRecord(`${cleanPath}/${name}`)));
const normalRecords = await Promise.all(normalEvidenceFiles.map((name) => stagedPathRecord(`${normalPath}/${name}`)));
const captureBinding = {
  schemaVersion: 1,
  recordType: "candidate-local-single-clean-and-normal-product-capture-record",
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  humanAcceptanceRecorded: false,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  platformRuntimeCommit: release.platformValidatorCommit,
  captureHarness: {
    path: `${release.sourcePath}/${release.captureHarness.target}`,
    sha256: release.captureHarness.sha256,
    runnerConfigPath: `${release.sourcePath}/${release.captureRunnerConfig.target}`,
    runnerConfigSha256: release.captureRunnerConfig.sha256,
    exactWorkers: 1
  },
  inputs: {
    sceneGlb: { path: `${release.releasePath}/scene.glb`, ...releaseFiles["scene.glb"] },
    sceneManifest: { path: `${release.releasePath}/scene.json`, ...releaseFiles["scene.json"] },
    captureConfig: await stagedPathRecord(`${release.sourcePath}/${release.sourceArtifacts.captureConfig.target}`)
  },
  cleanCapture: {
    status: "passed-single-technical-runtime-load-and-camera-capture",
    capturedOn: release.cleanCapture.capturedOn,
    repeatabilityClaimed: false,
    qualityAcceptanceClaimed: false,
    normalization: { machineLocalUrlsRemoved: true, hudHidden: true, seatAnchorsRemoved: true, mediaSurfacesHidden: true },
    files: cleanRecords
  },
  normalProductCapture: {
    status: "functional-checks-passed",
    capturedOn: release.normalCapture.capturedOn,
    syntheticReviewPoseUsed: false,
    renderedMediaFrame: "pending-not-evidenced",
    mediaObjectLifecycleOnly: true,
    files: normalRecords
  },
  threeRunEvidence: false,
  independentVerification: "pending-exact-merge-sha-staging"
};
await writeJson(staged(`${release.runtimeEvidencePath}/capture-binding.json`), captureBinding);
const captureBindingRecord = await stagedPathRecord(`${release.runtimeEvidencePath}/capture-binding.json`);

const visualConfig = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  sourceReviewPath: `${release.sourcePath}/review`,
  reviewViews: release.reviewViews,
  cleanRuntimeEvidence: { path: cleanPath, binding: captureBindingRecord, technicalStatus: "passed-single-capture" },
  normalProductEvidence: { path: normalPath, functionalStatus: "passed", renderedMediaFrame: "pending-not-evidenced" },
  thresholds: {
    state: "undefined-no-repeatable-regression-baseline",
    finalThresholdsDefined: false,
    perView: null,
    aggregate: null
  },
  sourceToRuntimeFidelity: {
    status: "failed-visible-material-regression",
    affectedViews: ["chair-detail", "chair-underneath", "presenter", "diagonal-overview"],
    defects: release.unresolvedDefects.slice(0, 3)
  },
  qualityAssessment: {
    inheritedBenchmarkCommit: release.benchmarkCommit,
    sharedContractCommit: release.sharedQualityContractCommit,
    outcome: release.qualityOutcome,
    unresolvedDefects: release.unresolvedDefects
  }
};
await writeJson(staged(release.visualConfigPath), visualConfig);
const visualConfigRecord = await stagedPathRecord(release.visualConfigPath);

const stagedSourceFiles = await relativeFiles(staged(release.sourcePath));
const sourceRecords = await Promise.all(stagedSourceFiles.map((name) => stagedPathRecord(`${release.sourcePath}/${name}`)));
const tooling = await Promise.all((await repositoryToolingPaths(root)).map(async (path) => ({ path, ...await fileRecord(join(root, path)) })));
const reproducibility = {
  scope: "same-host-same-saved-baked-source-same-filtered-atlas-same-pinned-blender-raw-export-recheck",
  runs: 2,
  result: "byte-identical-raw-glb",
  rawGlbSha256: release.sourceArtifacts.rawGlb.sha256,
  finalization: { method: "pinned glTF Transform tangents plus Meshopt", releaseGlbSha256: release.finalGlb.sha256 }
};
const acceptedLock = {
  schemaVersion: 1,
  status: "review-source-lock",
  sceneId: release.sceneId,
  releaseVersion: release.version,
  lockedOn: "2026-09-20",
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  acceptedSource: sourceRecords,
  toolchain: {
    blender: release.blender,
    meshoptimizer: "1.0.1",
    gltfTransform: "4.4.2",
    gltfValidator: "2.0.0-dev.3.10",
    imageMagick: release.bake.imageMagickVersion,
    platformRuntimeCommit: release.platformValidatorCommit,
    captureHarnessSha256: release.captureHarness.sha256,
    captureRunnerConfigSha256: release.captureRunnerConfig.sha256
  },
  tooling,
  release: {
    path: release.releasePath,
    glbSha256: releaseFiles["scene.glb"].sha256,
    sceneManifestSha256: releaseFiles["scene.json"].sha256,
    files: releaseFiles,
    stats: candidate.stats
  },
  budgetAssessment: release.budget,
  reproducibility,
  boundaries: {
    technicalSourceLocked: true,
    runtimeCaptureArtifactsValidated: true,
    repeatedRuntimeCaptureValidated: false,
    renderedMediaFrameValidated: false,
    visualAccepted: false,
    rightsApproved: false,
    stagingVerified: false,
    publicationReady: false
  }
};
await writeJson(staged(release.acceptanceLockPath), acceptedLock);
const acceptanceLockRecord = await stagedPathRecord(release.acceptanceLockPath);
const acceptanceRecord = {
  version: release.version,
  lockPath: release.acceptanceLockPath,
  lockSha256: acceptanceLockRecord.sha256,
  visualParityConfigPath: release.visualConfigPath,
  visualParityConfigSha256: visualConfigRecord.sha256
};
const existingPosition = acceptanceIndex.releases.findIndex(({ version }) => version === release.version);
const nextAcceptanceIndex = {
  ...acceptanceIndex,
  releases: existingPosition === -1
    ? [...acceptanceIndex.releases, acceptanceRecord]
    : acceptanceIndex.releases.map((record, index) => index === existingPosition ? acceptanceRecord : record)
};
assertGitAcceptanceIndexPrefix(root, release.acceptanceIndexPath, nextAcceptanceIndex);
await writeJson(staged(release.acceptanceIndexPath), nextAcceptanceIndex);
const acceptanceEntry = acceptanceIndexEntryRecord(nextAcceptanceIndex, release.version);

await mkdir(staged(release.provenancePath), { recursive: true });
const releaseRecords = Object.entries(releaseFiles).map(([name, record]) => ({ path: `${release.releasePath}/${name}`, ...record }));
const runtimeRecords = [...cleanRecords, ...normalRecords, captureBindingRecord];
const assetLedger = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  externalAssetsUsed: true,
  externalAssetLicense: "CC0-1.0",
  sourceLedger: `${release.sourcePath}/textures/source-ledger.json`,
  records: [...sourceRecords, acceptanceLockRecord, ...runtimeRecords, ...releaseRecords]
};
const generationLedger = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  toolchain: acceptedLock.toolchain,
  tooling,
  steps: [
    { id: "author-project-geometry", output: sourceRecords.find(({ path }) => path.endsWith("/accepted-scene.blend")) },
    { id: "bake-irradiance", settings: release.bake, output: sourceRecords.find(({ path }) => path.endsWith(`/${release.sourceArtifacts.lightmap.target}`)) },
    { id: "export-byte-identical-raw-glb", reproducibility, output: sourceRecords.find(({ path }) => path.endsWith("/accepted-export.raw.glb")) },
    { id: "finalize-meshopt-glb", output: releaseRecords.find(({ path }) => path.endsWith("/scene.glb")) },
    { id: "materialize-four-file-review-bundle", exactFileCount: requiredReleaseFiles.length, outputs: releaseRecords },
    { id: "record-single-clean-and-normal-product-captures", binding: captureBindingRecord, repeatabilityClaimed: false }
  ]
};
const realityReport = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: "passed-technical-reality-checks",
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  releaseGlb: releaseRecords.find(({ path }) => path.endsWith("/scene.glb")),
  objectRegistry: sourceRecords.find(({ path }) => path.endsWith("/object-registry.json")),
  geometryMeasurements: sourceRecords.find(({ path }) => path.endsWith("/geometry-measurements.json")),
  supportMeasurements: sourceRecords.find(({ path }) => path.endsWith("/declared-supports.json")),
  measuredStats: candidate.stats,
  khronos: candidate.khronos,
  screenVisibility: "passed-40-of-40-rays-clear",
  approachRoutes: "passed-9-of-9",
  sitStandSweeps: "passed-8-of-8",
  supportGraph: "passed-384-declared-constituent-parts-no-failures",
  budgetAssessment: release.budget,
  result: "technical-checks-passed-with-unresolved-triangle-budget-exception"
};
const visualReview = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  sourceViews: { path: `${release.sourcePath}/review`, count: release.reviewViews.length },
  cleanRuntime: { path: cleanPath, technicalStatus: "passed-single-capture", repeatabilityClaimed: false },
  normalProduct: { path: normalPath, functionalStatus: "passed", renderedMediaFrame: "pending-not-evidenced" },
  sourceToRuntimeFidelity: visualConfig.sourceToRuntimeFidelity,
  unresolvedDefects: release.unresolvedDefects,
  visualAccepted: false
};
await Promise.all([
  writeJson(staged(`${release.provenancePath}/release-asset-ledger.json`), assetLedger),
  writeJson(staged(`${release.provenancePath}/generation-ledger.json`), generationLedger),
  writeJson(staged(`${release.provenancePath}/scene-reality-report.json`), realityReport),
  writeJson(staged(`${release.provenancePath}/visual-review.json`), visualReview)
]);
const supportingEvidence = Object.fromEntries(await Promise.all([
  "release-asset-ledger.json", "generation-ledger.json", "scene-reality-report.json", "visual-review.json"
].map(async (name) => [name, await fileRecord(staged(`${release.provenancePath}/${name}`))])));
const releaseProvenance = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  platformValidatorCommit: release.platformValidatorCommit,
  source: { lock: acceptanceLockRecord, visualConfig: visualConfigRecord, acceptanceIndex: { path: release.acceptanceIndexPath, ...acceptanceEntry } },
  release: { path: release.releasePath, files: releaseFiles, stats: candidate.stats },
  reproducibility,
  budgetAssessment: release.budget,
  runtimeCapture: { binding: captureBindingRecord, cleanPath, normalProductPath: normalPath, threeRunEvidence: false, renderedMediaFrame: "pending-not-evidenced" },
  visualAcceptance: { status: release.humanAcceptance, evidencePath: null },
  rights: { status: release.rightsStatus, rightsApproved: false, evidencePath: null },
  evidenceFiles: supportingEvidence
};
await writeJson(staged(`${release.provenancePath}/release-provenance.json`), releaseProvenance);

const releaseManifestRecord = {
  sceneId: release.sceneId,
  version: release.version,
  baseVersion: release.baseVersion,
  releaseKind: release.releaseKind,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  rightsApprovalDate: null,
  licenseRef: null,
  isCurrent: false,
  publicationReady: false,
  renderMode: release.renderMode,
  renderProfile: release.renderProfile,
  platformValidatorCommit: release.platformValidatorCommit,
  releasePath: release.releasePath,
  provenancePath: `${release.provenancePath}/release-provenance.json`,
  files: releaseFiles,
  stats: candidate.stats,
  budgetAssessment: release.budget,
  reproducibility
};
const historicalReleases = manifest.releases.filter(({ version }) => version !== release.version);
const nextManifest = {
  ...manifest,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  rightsApprovalDate: null,
  licenseRef: null,
  publicationReady: false,
  platformValidatorCommit: release.platformValidatorCommit,
  releases: [...historicalReleases, releaseManifestRecord]
};
const nextRepository = {
  ...repository,
  releaseVersion: release.version,
  releaseMaterialized: true,
  status: release.status,
  qualityOutcome: release.qualityOutcome,
  humanAcceptance: release.humanAcceptance,
  isCurrent: false,
  publicationReady: false,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  rightsApprovalDate: null,
  licenseRef: null,
  platformValidatorCommit: release.platformValidatorCommit
};
await Promise.all([
  writeJson(staged("manifest.json"), nextManifest),
  writeJson(staged("scene-repository.json"), nextRepository)
]);

const replacements = [
  release.sourcePath,
  release.releasePath,
  release.provenancePath,
  release.runtimeEvidencePath,
  release.acceptanceIndexPath,
  "manifest.json",
  "scene-repository.json"
].map((repositoryPath) => ({
  staged: staged(repositoryPath),
  target: join(root, repositoryPath),
  backup: join(backupRoot, repositoryPath)
}));
await install(replacements);
process.stdout.write(`Materialized ${release.sceneId}@${release.version} as a four-file non-current ${release.qualityOutcome} review candidate.\n`);
process.stdout.write(`GLB ${release.finalGlb.sizeBytes} bytes sha256=${release.finalGlb.sha256}; triangle budget ${release.budget.status}.\n`);
process.stdout.write("Clean capture is a single technical run; media frame, human acceptance, rights approval, and promotion remain pending.\n");
