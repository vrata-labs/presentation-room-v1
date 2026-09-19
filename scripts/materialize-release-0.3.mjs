import { access, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { acceptanceIndexEntryRecord, assert, assertGitAcceptanceIndexPrefix, assertUntrackedOutput, fileRecord, pathTrackedInGit, readJson, repositoryToolingPaths, writeJson } from "./lib.mjs";
import {
  pathRecord,
  measureRuntimeCapture,
  pendingRights,
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

async function verifyReplaceable(repositoryPath) {
  const path = join(root, repositoryPath);
  await assertUntrackedOutput(root, path);
  if (!await exists(path)) return;
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

function staged(repositoryPath) {
  return join(stagingRoot, repositoryPath);
}

function runtimeVector(vector) {
  return { x: vector.x, y: vector.y, z: -vector.z };
}

function manifestSeat(binding) {
  const { objectId: _objectId, ...seat } = binding;
  return seat;
}

function manifestSurface(binding) {
  const { objectId: _objectId, partId: _partId, ...surface } = binding;
  return surface;
}

const versionedTargets = [
  release.releasePath,
  release.provenancePath,
  release.acceptanceLockPath,
  release.visualConfigPath,
  release.capturePlanPath,
  release.runtimeEvidencePath
];
for (const repositoryPath of versionedTargets) await verifyReplaceable(repositoryPath);
assert(!await exists(backupRoot), `materialization_backup_requires_recovery:${relative(root, backupRoot)}`);

const [manifest, repository] = await Promise.all([
  readJson(join(root, "manifest.json")),
  readJson(join(root, "scene-repository.json"))
]);
const existingAcceptanceIndex = await exists(join(root, release.acceptanceIndexPath))
  ? await readJson(join(root, release.acceptanceIndexPath))
  : { schemaVersion: 1, sceneId: release.sceneId, releases: [] };
assert(existingAcceptanceIndex.schemaVersion === 1
  && existingAcceptanceIndex.sceneId === release.sceneId
  && Array.isArray(existingAcceptanceIndex.releases), "materialization_acceptance_index_invalid");
assert(new Set(existingAcceptanceIndex.releases.map(({ version }) => version)).size === existingAcceptanceIndex.releases.length, "materialization_acceptance_index_duplicates");
assert(repository.schemaVersion === 1 && repository.sceneId === release.sceneId && repository.oneSceneOnly === true, "materialization_repository_identity_mismatch");
const baseReleases = manifest.releases.filter(({ version }) => version !== release.version);
assert(JSON.stringify(baseReleases.map(({ version }) => version)) === JSON.stringify(["0.1.0", "0.1.1", "0.2.0"]), "materialization_history_mismatch");
if (manifest.releases.some(({ version }) => version === release.version)) {
  assert(replaceUntracked && !pathTrackedInGit(root, release.releasePath), "tracked_release_manifest_overwrite_forbidden");
}
const baseRelease = baseReleases.at(-1);
assert(baseRelease.version === release.baseVersion, "materialization_base_version_mismatch");

const glbPath = join(root, release.buildOutputPath);
const [glbRecord, sourceBlend, authorScript, exportScript, lightmap, realityRecord, scenariosRecord, captureHarnessPatch, candidate, reviews, baseScene] = await Promise.all([
  fileRecord(glbPath),
  pathRecord(release.sourceBlendPath),
  pathRecord(release.authorScriptPath),
  pathRecord(release.exportScriptPath),
  pathRecord(release.lightmapPath),
  pathRecord(release.realityPath),
  pathRecord(release.scenariosPath),
  pathRecord(release.captureHarnessPatchPath),
  validateCandidate(glbPath),
  reviewEvidence(),
  readJson(join(root, baseRelease.releasePath, "scene.json"))
]);
assert(glbRecord.sha256 === release.accepted.releaseGlbSha256 && glbRecord.sizeBytes === release.accepted.releaseGlbSizeBytes, "materialization_glb_record_mismatch");
assert(sourceBlend.sha256 === release.accepted.sourceBlendSha256, "materialization_source_digest_mismatch");
assert(authorScript.sha256 === release.accepted.authorScriptSha256, "materialization_author_script_digest_mismatch");
assert(exportScript.sha256 === release.accepted.exportScriptSha256, "materialization_export_script_digest_mismatch");
assert(lightmap.sha256 === release.accepted.lightmapSha256, "materialization_lightmap_digest_mismatch");
assert(realityRecord.sha256 === release.accepted.realitySha256, "materialization_reality_digest_mismatch");
assert(captureHarnessPatch.sha256 === release.runtimeCapture.harnessPatchSha256, "materialization_capture_harness_patch_digest_mismatch");

const committedCapturePath = join(root, release.runtimeEvidencePath);
const buildCapturePath = join(root, release.runtimeCaptureBuildPath);
const captureSourcePath = await exists(join(buildCapturePath, "runs")) ? buildCapturePath : committedCapturePath;
assert(await exists(captureSourcePath), "runtime_capture_missing");

const expectedSeats = candidate.reality.runtimeBindings.seatAnchors.map(manifestSeat);
const expectedSurfaces = candidate.reality.runtimeBindings.mediaSurfaces.map(manifestSurface);
assert(JSON.stringify(baseScene.spawnPoints) === JSON.stringify(candidate.reality.runtimeBindings.spawnPoints), "historical_spawn_binding_drift");
assert(JSON.stringify(baseScene.anchors.seatAnchors) === JSON.stringify(expectedSeats), "historical_seat_binding_drift");
assert(JSON.stringify(baseScene.mediaSurfaces) === JSON.stringify(expectedSurfaces), "historical_media_binding_drift");

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(staged(release.releasePath), { recursive: true });
const licenseNotice = `# Project-Authored 0.3.0 Review Candidate Notice\n\nThe exact presentation-room-v1 0.3.0 bytes are entirely project-authored. No downloaded assets, private SenseTower materials, image-to-3D outputs, copied external references, branding, artificial windows, or panorama spheres are included.\n\nHuman rights approval for these exact bytes is pending. This notice does not grant staging, public runtime, redistribution, production activation, or human visual acceptance. The candidate remains review-only, non-current, and not publication ready.\n`;
await Promise.all([
  writeFile(staged(`${release.releasePath}/LICENSES.md`), licenseNotice),
  copyFile(join(root, reviews.find(({ id }) => id === "entry").path), staged(`${release.releasePath}/preview.webp`)),
  copyFile(glbPath, staged(`${release.releasePath}/scene.glb`))
]);

const rights = pendingRights();
const scene = {
  ...baseScene,
  version: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  publicationReady: false,
  glbSha256: glbRecord.sha256,
  source: release.sourceBlendPath,
  stats: candidate.stats,
  rights,
  isCurrent: false,
  renderProfile: release.renderProfile
};
await writeJson(staged(`${release.releasePath}/scene.json`), scene);
const bundleFiles = Object.fromEntries(await Promise.all(requiredReleaseFiles.map(async (name) => [
  name,
  await fileRecord(staged(`${release.releasePath}/${name}`))
])));

const capturePlan = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  releaseGlb: { path: `${release.releasePath}/scene.glb`, ...bundleFiles["scene.glb"] },
  capture: {
    status: "pending-platform-dependent-local-capture",
    platformCommit: release.platformValidatorCommit,
    requiredState: "loaded",
    requiredFailureReason: null,
    requireNoMissingAssets: true,
    requiredRenderProfile: release.renderProfile,
    expectedRuntime: {
      meshCount: candidate.stats.meshes,
      materialCount: candidate.stats.materials,
      triangleEstimate: candidate.stats.triangles
    },
    renderSettings: { environmentIntensity: 0.35, exposure: 1.2 },
    bindingFile: null,
    diagnosticsFile: null,
    evidencePath: null
  },
  reviewViews: candidate.reality.reviewViews.map((view) => ({
    id: view.id,
    position: runtimeVector(view.authoringPosition),
    target: runtimeVector(view.authoringTarget),
    fovDegrees: view.fovDegrees
  })),
  views: reviews.map((view) => ({
    id: view.id,
    referencePath: view.path,
    referenceSha256: view.sha256,
    referenceSizeBytes: view.sizeBytes,
    meanLuminance: view.meanLuminance,
    darkPixelRatioBelow10Percent: view.darkPixelRatioBelow10Percent,
    captureFile: null,
    phashMax: null,
    nccMin: null
  })),
  thresholds: {
    state: "undefined-no-runtime-baseline",
    finalThresholdsDefined: false,
    perView: null,
    aggregate: null,
    rationale: "No runtime capture is bound to this release. Thresholds must not be derived from source renders alone."
  }
};
await mkdir(dirname(staged(release.capturePlanPath)), { recursive: true });
await writeJson(staged(release.capturePlanPath), capturePlan);
const capturePlanRecord = await fileRecord(staged(release.capturePlanPath));
assert(capturePlanRecord.sha256 === release.runtimeCapture.capturePlanSha256, "runtime_capture_plan_digest_mismatch");

await mkdir(staged(release.runtimeEvidencePath), { recursive: true });
const capturedRuns = [];
for (const runId of release.runtimeCapture.runs) {
  const sourceRunPath = join(captureSourcePath, "runs", runId);
  const evidenceRunPath = `${release.runtimeEvidencePath}/runs/${runId}`;
  assert(await exists(sourceRunPath), `runtime_capture_run_missing:${runId}`);
  await mkdir(staged(evidenceRunPath), { recursive: true });
  for (const id of release.reviewViews) {
    const sourcePath = join(sourceRunPath, `${id}.png`);
    assert(JSON.stringify(await fileRecord(sourcePath)) === JSON.stringify(release.runtimeCapture.acceptedViews[id]), `runtime_capture_input_digest_mismatch:${runId}:${id}`);
    await copyFile(sourcePath, staged(`${evidenceRunPath}/${id}.png`));
  }
  const [capturedSceneDebug, captureSettings] = await Promise.all([
    readJson(join(sourceRunPath, "scene-debug.json")),
    readJson(join(sourceRunPath, "capture-settings.json"))
  ]);
  const normalizedSceneDebug = {
    ...capturedSceneDebug,
    bundleUrl: `local-capture/${runId}/scene.json`,
    assetUrl: `local-capture/${runId}/scene.glb`
  };
  const diagnostics = validateRuntimeDiagnostics(normalizedSceneDebug, captureSettings);
  await Promise.all([
    writeJson(staged(`${evidenceRunPath}/scene-debug.json`), normalizedSceneDebug),
    writeJson(staged(`${evidenceRunPath}/capture-settings.json`), captureSettings)
  ]);
  const measurement = await measureRuntimeCapture(staged(evidenceRunPath), evidenceRunPath);
  const files = Object.fromEntries(await Promise.all(runtimeCaptureBaseFiles.map(async (name) => [
    name,
    { path: `${evidenceRunPath}/${name}`, ...await fileRecord(staged(`${evidenceRunPath}/${name}`)) }
  ])));
  capturedRuns.push({ id: runId, diagnostics, measurement, files });
}
const stabilityMeasurement = validateRuntimeStability(capturedRuns);
const stabilityEvidence = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  platformRuntimeCommit: release.platformValidatorCommit,
  runtimeBuildModified: false,
  capturedOn: release.runtimeCapture.capturedOn,
  runs: capturedRuns.map(({ id, diagnostics, files }) => ({
    id,
    viewIds: release.reviewViews,
    result: "passed",
    diagnostics,
    files
  })),
  ...stabilityMeasurement
};
await writeJson(staged(`${release.runtimeEvidencePath}/stability.json`), stabilityEvidence);
const stabilityRecord = await fileRecord(staged(`${release.runtimeEvidencePath}/stability.json`));
const canonicalRun = capturedRuns.find(({ id }) => id === release.runtimeCapture.canonicalRunId);
assert(canonicalRun, "runtime_canonical_run_missing");
const parityMeasurement = canonicalRun.measurement;
const visualParity = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  capturePlan: { path: release.capturePlanPath, ...capturePlanRecord },
  platformRuntimeCommit: release.platformValidatorCommit,
  runtimeBuildModified: false,
  capturedOn: release.runtimeCapture.capturedOn,
  canonicalRunId: release.runtimeCapture.canonicalRunId,
  runs: capturedRuns.map(({ id }) => ({ id, viewIds: release.reviewViews, result: "passed" })),
  normalization: release.runtimeCapture.normalization,
  diagnostics: Object.fromEntries(capturedRuns.map(({ id, diagnostics }) => [id, diagnostics])),
  stability: {
    path: `${release.runtimeEvidencePath}/stability.json`,
    ...stabilityRecord,
    result: stabilityMeasurement.result
  },
  ...parityMeasurement,
  technicalResult: parityMeasurement.result,
  humanAcceptanceRecorded: false
};
await writeJson(staged(`${release.runtimeEvidencePath}/visual-parity.json`), visualParity);
const captureEvidenceNames = runtimeEvidenceFiles.filter((name) => name !== "capture-binding.json");
const captureFiles = Object.fromEntries(await Promise.all(captureEvidenceNames.map(async (name) => [
  name,
  { path: `${release.runtimeEvidencePath}/${name}`, ...await fileRecord(staged(`${release.runtimeEvidencePath}/${name}`)) }
])));
const captureBinding = {
  schemaVersion: 1,
  recordType: "candidate-local-repeated-capture-record",
  sceneId: release.sceneId,
  releaseVersion: release.version,
  purpose: "Records three exact full-view candidate-local runtime capture runs, repeatability, inputs, and diagnostics; it is not independent execution evidence, human visual acceptance, or rights approval.",
  capturedOn: release.runtimeCapture.capturedOn,
  humanAcceptance: release.humanAcceptance,
  humanAcceptanceRecorded: false,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  platformRuntimeCommit: release.platformValidatorCommit,
  runtimeBuildModified: false,
  provenanceScope: {
    candidateCiReplaysCapture: false,
    candidateCiValidatesCommittedArtifacts: true,
    independentVerification: "required-on-exact-merge-sha-staging"
  },
  captureHarness: {
    sourcePath: release.runtimeCapture.harnessSourcePath,
    sourceSha256: release.runtimeCapture.harnessSourceSha256,
    patchPath: captureHarnessPatch.path,
    patchSha256: captureHarnessPatch.sha256,
    patchedSha256: release.runtimeCapture.patchedHarnessSha256,
    scope: "capture-only-timeout-view-isolation-hud-and-self-mesh-suppression",
    appliedAfterRuntimeBuild: true
  },
  execution: {
    runs: capturedRuns.map(({ id }) => ({ id, viewIds: release.reviewViews, result: "passed" })),
    canonicalRunId: release.runtimeCapture.canonicalRunId,
    settings: release.runtimeCapture.captureSettings,
    normalization: release.runtimeCapture.normalization
  },
  inputs: {
    sceneGlb: { path: `${release.releasePath}/scene.glb`, ...bundleFiles["scene.glb"] },
    sceneManifest: { path: `${release.releasePath}/scene.json`, ...bundleFiles["scene.json"] },
    capturePlan: { path: release.capturePlanPath, ...capturePlanRecord }
  },
  diagnostics: Object.fromEntries(capturedRuns.map(({ id, diagnostics }) => [id, diagnostics])),
  stability: {
    path: `${release.runtimeEvidencePath}/stability.json`,
    ...stabilityRecord,
    result: stabilityMeasurement.result
  },
  captureFiles
};
await writeJson(staged(`${release.runtimeEvidencePath}/capture-binding.json`), captureBinding);
const captureBindingRecord = await fileRecord(staged(`${release.runtimeEvidencePath}/capture-binding.json`));
const runtimeEvidenceRecords = await Promise.all(runtimeEvidenceFiles.map(async (name) => ({
  path: `${release.runtimeEvidencePath}/${name}`,
  ...await fileRecord(staged(`${release.runtimeEvidencePath}/${name}`))
})));

const visualConfig = {
  ...capturePlan,
  capture: {
    ...capturePlan.capture,
    status: "passed-repeatable-technical-local-capture",
    bindingFile: `${release.runtimeEvidencePath}/capture-binding.json`,
    bindingSha256: captureBindingRecord.sha256,
    diagnosticsFile: undefined,
    diagnosticsFiles: capturedRuns.map(({ id }) => `${release.runtimeEvidencePath}/runs/${id}/scene-debug.json`),
    stabilityFile: `${release.runtimeEvidencePath}/stability.json`,
    stabilitySha256: stabilityRecord.sha256,
    canonicalRunId: release.runtimeCapture.canonicalRunId,
    evidencePath: release.runtimeEvidencePath,
    runtimeBuildModified: false,
    normalization: release.runtimeCapture.normalization
  },
  views: parityMeasurement.views.map((view) => ({
    id: view.id,
    referencePath: view.reference.path,
    referenceSha256: view.reference.sha256,
    referenceSizeBytes: view.reference.sizeBytes,
    meanLuminance: reviews.find(({ id }) => id === view.id).meanLuminance,
    darkPixelRatioBelow10Percent: reviews.find(({ id }) => id === view.id).darkPixelRatioBelow10Percent,
    captureFile: view.capture.path,
    captureSha256: view.capture.sha256,
    captureSizeBytes: view.capture.sizeBytes,
    captureMeanLuminance: view.metrics.meanLuminance,
    captureDarkPixelRatioBelow10Percent: view.metrics.darkPixelRatioBelow10Percent,
    phash: view.phash,
    ncc: view.ncc,
    phashMax: view.threshold.phashMax,
    nccMin: view.threshold.nccMin,
    status: view.status
  })),
  thresholds: {
    state: parityMeasurement.thresholdState,
    finalThresholdsDefined: true,
    perView: release.runtimeCapture.visualParity.perView,
    aggregate: release.runtimeCapture.visualParity.aggregate,
    metricTolerance: release.runtimeCapture.visualParity.metricTolerance,
    derivation: stabilityMeasurement.thresholdDerivation,
    rationale: "Candidate-local post-capture regression bounds are derived from the worst observed result across three byte-identical full-view runs plus the recorded margin formula; they are not independent acceptance thresholds or human visual acceptance."
  }
};
await writeJson(staged(release.visualConfigPath), visualConfig);
const visualConfigRecord = await fileRecord(staged(release.visualConfigPath));
const toolingPaths = await repositoryToolingPaths(root);
const tooling = await Promise.all(toolingPaths.map(pathRecord));

const reproducibility = {
  scope: "same-host-same-saved-blend-same-accepted-atlas-same-blender-binary-two-run",
  runs: 2,
  result: "byte-identical-glb",
  sha256: glbRecord.sha256,
  lightmapSha256: lightmap.sha256
};
const acceptedLock = {
  schemaVersion: 1,
  status: "review-source-lock",
  sceneId: release.sceneId,
  lockedOn: "2026-09-05",
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  acceptedSource: {
    blendPath: sourceBlend.path,
    blendSha256: sourceBlend.sha256,
    blendSizeBytes: sourceBlend.sizeBytes,
    authorScriptPath: authorScript.path,
    authorScriptSha256: authorScript.sha256,
    authorScriptSizeBytes: authorScript.sizeBytes,
    exportScriptPath: exportScript.path,
    exportScriptSha256: exportScript.sha256,
    exportScriptSizeBytes: exportScript.sizeBytes,
    lightmapPath: lightmap.path,
    lightmapSha256: lightmap.sha256,
    lightmapSizeBytes: lightmap.sizeBytes,
    sceneRealityContractPath: realityRecord.path,
    sceneRealityContractSha256: realityRecord.sha256,
    sceneRealityContractSizeBytes: realityRecord.sizeBytes,
    userScenariosContractPath: scenariosRecord.path,
    userScenariosContractSha256: scenariosRecord.sha256,
    userScenariosContractSizeBytes: scenariosRecord.sizeBytes,
    captureHarnessPatchPath: captureHarnessPatch.path,
    captureHarnessPatchSha256: captureHarnessPatch.sha256,
    captureHarnessPatchSizeBytes: captureHarnessPatch.sizeBytes,
    runtimeCapturePlanPath: release.capturePlanPath,
    runtimeCapturePlanSha256: capturePlanRecord.sha256,
    runtimeCapturePlanSizeBytes: capturePlanRecord.sizeBytes,
    visualParityConfigPath: release.visualConfigPath,
    visualParityConfigSha256: visualConfigRecord.sha256,
    visualParityConfigSizeBytes: visualConfigRecord.sizeBytes,
    runtimeCaptureBindingPath: `${release.runtimeEvidencePath}/capture-binding.json`,
    runtimeCaptureBindingSha256: captureBindingRecord.sha256,
    runtimeCaptureBindingSizeBytes: captureBindingRecord.sizeBytes
  },
  toolchain: {
    blenderVersion: release.blender.version,
    blenderBuildHash: release.blender.buildHash,
    blenderBinarySha256: release.blender.binarySha256,
    gltfExporter: "Khronos glTF Blender I/O v4.5.51",
    reviewImageConverter: release.reviewImages.converter,
    reviewImageQuality: release.reviewImages.quality,
    runtimeCapture: {
      platformCommit: release.platformValidatorCommit,
      captureHarnessSourceSha256: release.runtimeCapture.harnessSourceSha256,
      captureHarnessPatchSha256: captureHarnessPatch.sha256,
      patchedCaptureHarnessSha256: release.runtimeCapture.patchedHarnessSha256,
      imageMetricTool: parityMeasurement.metricToolVersion
    },
    bakedLightmap: {
      resolution: release.bake.resolution,
      samples: release.bake.samples,
      scale: release.bake.scale,
      device: release.bake.device,
      transport: release.bake.transport
    }
  },
  tooling,
  reviewViews: reviews,
  geometry: candidate.geometry,
  release: {
    version: release.version,
    path: release.releasePath,
    sceneManifestSha256: bundleFiles["scene.json"].sha256,
    glbSha256: bundleFiles["scene.glb"].sha256,
    previewSha256: bundleFiles["preview.webp"].sha256,
    files: bundleFiles,
    stats: candidate.stats
  },
  runtimeCoordinates: {
    transform: "x=x,y=y,z=-z",
    evidencePath: `${release.provenancePath}/runtime-coordinates.json`
  },
  reproducibility,
  visualQuality: {
    evidencePath: `${release.provenancePath}/visual-review.json`,
    reviewViews: reviews.length,
    sourceReviewResult: "passed",
    runtimeCaptureResult: "passed-repeatable-technical-local-capture",
    runtimeCaptureEvidencePath: release.runtimeEvidencePath,
    runtimeStabilityResult: stabilityMeasurement.result,
    technicalParityResult: parityMeasurement.result,
    humanAcceptance: release.humanAcceptance
  },
  boundaries: {
    technicalSourceLocked: true,
    runtimeCaptureArtifactsValidated: true,
    visualAccepted: false,
    rightsApproved: false,
    releaseGlbVerified: true,
    stagingVerified: false,
    publicationReady: false
  }
};
await writeJson(staged(release.acceptanceLockPath), acceptedLock);
const lockRecord = await fileRecord(staged(release.acceptanceLockPath));
const acceptanceRecord = {
  version: release.version,
  lockPath: release.acceptanceLockPath,
  lockSha256: lockRecord.sha256,
  visualParityConfigPath: release.visualConfigPath,
  visualParityConfigSha256: visualConfigRecord.sha256
};
const acceptancePosition = existingAcceptanceIndex.releases.findIndex(({ version }) => version === release.version);
const acceptanceIndex = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releases: acceptancePosition === -1
    ? [...existingAcceptanceIndex.releases, acceptanceRecord]
    : existingAcceptanceIndex.releases.map((record, index) => index === acceptancePosition ? acceptanceRecord : record)
};
assertGitAcceptanceIndexPrefix(root, release.acceptanceIndexPath, acceptanceIndex);
await writeJson(staged(release.acceptanceIndexPath), acceptanceIndex);
const acceptanceIndexRecord = acceptanceIndexEntryRecord(acceptanceIndex, release.version);

const sourceRecords = [
  await pathRecord(release.historicalBlendPath),
  sourceBlend,
  authorScript,
  exportScript,
  lightmap,
  realityRecord,
  scenariosRecord,
  captureHarnessPatch,
  { path: release.capturePlanPath, ...capturePlanRecord },
  { path: release.visualConfigPath, ...visualConfigRecord },
  { path: release.acceptanceLockPath, ...lockRecord },
  ...reviews.map(({ id: _id, format: _format, width: _width, height: _height, meanLuminance: _mean, darkPixelRatioBelow10Percent: _dark, ...record }) => record)
];
const releaseRecords = Object.entries(bundleFiles).map(([name, record]) => ({ path: `${release.releasePath}/${name}`, ...record }));
const generatedTextures = candidate.reality.materials.filter(({ texture }) => texture !== null).map(({ name, texture, baseColorSrgb }) => ({
  id: `texture.project.${texture}`,
  kind: "project-authored-generated-texture",
  materialId: name,
  baseColorSrgb,
  generatorPath: release.authorScriptPath,
  acceptedContainerPath: release.sourceBlendPath,
  acceptedContainerSha256: sourceBlend.sha256,
  externalSource: null
}));
const assetLedger = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  ownershipBasis: "entirely-project-authored",
  externalAssetsUsed: false,
  records: [
    ...sourceRecords.map((record) => ({ ...record, kind: "project-authored-or-generated-release-input", externalSource: null })),
    ...runtimeEvidenceRecords.map((record) => ({ ...record, kind: "generated-local-runtime-capture-evidence", externalSource: null })),
    ...releaseRecords.map((record) => ({ ...record, kind: "generated-release-output", externalSource: null }))
  ],
  embeddedGeneratedTextures: generatedTextures
};
const generationLedger = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  method: "Project-authored Blender material and lighting pass over immutable project-authored geometry, followed by a fresh CUDA irradiance bake.",
  externalAssetsUsed: false,
  toolchain: {
    blender: release.blender,
    cwebp: release.reviewImages.converter,
    imageMetricTool: parityMeasurement.metricToolVersion,
    node: "Node.js >=22",
    packageManager: "pnpm@10.34.1"
  },
  tooling,
  steps: [
    {
      id: "author-versioned-source",
      input: await pathRecord(release.historicalBlendPath),
      script: authorScript,
      outputs: [sourceBlend, realityRecord, ...reviews.map(({ id: _id, format: _format, width: _width, height: _height, meanLuminance: _mean, darkPixelRatioBelow10Percent: _dark, ...record }) => record)]
    },
    {
      id: "bake-fresh-lightmap",
      input: sourceBlend,
      script: exportScript,
      settings: release.bake,
      evidence: {
        cudaDevices: ["NVIDIA GeForce GTX 1060 6GB"],
        linearMaxBeforeScale: release.bake.linearMaxBeforeScale,
        linearMeanBeforeScale: release.bake.linearMeanBeforeScale,
        oldLightmapReused: false
      },
      output: lightmap
    },
    {
      id: "export-byte-identical-glb",
      input: { sourceBlend, lightmap },
      script: exportScript,
      reproducibility,
      output: { path: `${release.releasePath}/scene.glb`, ...bundleFiles["scene.glb"] }
    },
    {
      id: "materialize-four-file-bundle",
      files: releaseRecords,
      exactFileCount: requiredReleaseFiles.length
    },
    {
      id: "record-candidate-local-runtime-capture",
      platformCommit: release.platformValidatorCommit,
      runtimeBuildModified: false,
      provenanceScope: captureBinding.provenanceScope,
      capturePlan: { path: release.capturePlanPath, ...capturePlanRecord },
      captureHarnessPatch,
      runs: capturedRuns.map(({ id }) => ({ id, viewIds: release.reviewViews, result: "passed" })),
      stability: { path: `${release.runtimeEvidencePath}/stability.json`, ...stabilityRecord, result: stabilityMeasurement.result },
      normalization: release.runtimeCapture.normalization,
      outputs: runtimeEvidenceRecords
    }
  ]
};
const runtimeCoordinates = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: "passed",
  transform: "x=x,y=y,z=-z",
  authoringSpace: "semantic right-handed Y-up meters",
  runtimeSpace: "glTF right-handed Y-up meters",
  source: realityRecord,
  checks: {
    spawnPoints: candidate.reality.runtimeBindings.spawnPoints.length,
    seatAnchors: expectedSeats.length,
    mediaSurfaces: expectedSurfaces.length,
    sceneManifestSpawnBindingsMatch: true,
    sceneManifestSeatBindingsMatch: true,
    sceneManifestMediaBindingsMatch: true
  },
  runtimeBindings: candidate.reality.runtimeBindings
};
const realityReport = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: "passed",
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  contract: realityRecord,
  userScenarios: scenariosRecord,
  releaseGlb: { path: `${release.releasePath}/scene.glb`, ...bundleFiles["scene.glb"] },
  expectedCounts: candidate.reality.expectedCounts,
  measuredStats: candidate.stats,
  interactionMeshStatuses: candidate.statusCounts,
  scenarioCoverage: candidate.scenarioStats,
  geometry: candidate.geometry,
  gltfInventory: candidate.gltfInventory,
  meshTags: {
    coverage: "all-visible-mesh-parts",
    validatedParts: candidate.reality.expectedCounts.meshParts,
    required: ["vrataObjectId", "vrataPartId", "vrataInteractionStatus", "vrataBakePolicy", "vrataAssetOrigin", "vrataAuthoringRelease"]
  },
  khronos: candidate.khronos,
  designConstraints: candidate.reality.designConstraints,
  result: "passed"
};
const visualReview = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  sourceReview: {
    status: "passed-technical-source-review",
    imageConverter: release.reviewImages.converter,
    metricImplementation: "sharp 0.34.3 raw sRGB luminance",
    dimensions: { width: release.reviewImages.width, height: release.reviewImages.height },
    views: reviews
  },
  runtimeParity: {
    status: "passed-repeatable-technical-local-capture",
    bindingPath: `${release.runtimeEvidencePath}/capture-binding.json`,
    bindingSha256: captureBindingRecord.sha256,
    diagnosticsPaths: capturedRuns.map(({ id }) => `${release.runtimeEvidencePath}/runs/${id}/scene-debug.json`),
    stabilityPath: `${release.runtimeEvidencePath}/stability.json`,
    stabilitySha256: stabilityRecord.sha256,
    stabilityResult: stabilityMeasurement.result,
    platformCommit: release.platformValidatorCommit,
    runtimeBuildModified: false,
    thresholdsDefined: true,
    thresholdState: parityMeasurement.thresholdState,
    phash: {
      total: parityMeasurement.aggregate.phashTotal,
      maximum: parityMeasurement.aggregateThreshold.phashTotalMax
    },
    ncc: {
      mean: parityMeasurement.aggregate.nccMean,
      minimum: parityMeasurement.aggregateThreshold.nccMeanMin
    },
    normalization: release.runtimeCapture.normalization,
    result: parityMeasurement.result,
    thresholdDerivation: stabilityMeasurement.thresholdDerivation,
    rationale: "Three byte-identical full-view runs define technical regression bounds from their worst observed metrics plus explicit margins; human acceptance remains pending."
  },
  visualAccepted: false,
  publicationReady: false
};
await mkdir(staged(release.provenancePath), { recursive: true });
await Promise.all([
  writeJson(staged(`${release.provenancePath}/release-asset-ledger.json`), assetLedger),
  writeJson(staged(`${release.provenancePath}/generation-ledger.json`), generationLedger),
  writeJson(staged(`${release.provenancePath}/runtime-coordinates.json`), runtimeCoordinates),
  writeJson(staged(`${release.provenancePath}/scene-reality-report.json`), realityReport),
  writeJson(staged(`${release.provenancePath}/visual-review.json`), visualReview)
]);
const supportingEvidence = Object.fromEntries(await Promise.all([
  "release-asset-ledger.json",
  "generation-ledger.json",
  "runtime-coordinates.json",
  "scene-reality-report.json",
  "visual-review.json"
].map(async (name) => [name, await fileRecord(staged(`${release.provenancePath}/${name}`))])));
const releaseProvenance = {
  schemaVersion: 1,
  sceneId: release.sceneId,
  releaseVersion: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  platformValidatorCommit: release.platformValidatorCommit,
  source: {
    blend: sourceBlend,
    authorScript,
    exportScript,
    lightmap,
    realityContract: realityRecord,
    userScenarios: scenariosRecord,
    captureHarnessPatch,
    capturePlan: { path: release.capturePlanPath, ...capturePlanRecord },
    visualConfig: { path: release.visualConfigPath, ...visualConfigRecord },
    acceptedSourceLock: { path: release.acceptanceLockPath, ...lockRecord },
    acceptanceIndex: { path: release.acceptanceIndexPath, ...acceptanceIndexRecord }
  },
  release: { path: release.releasePath, files: bundleFiles, stats: candidate.stats },
  geometry: candidate.geometry,
  reproducibility,
  runtimeCapture: {
    status: "passed-repeatable-technical-local-capture",
    evidencePath: release.runtimeEvidencePath,
    binding: { path: `${release.runtimeEvidencePath}/capture-binding.json`, ...captureBindingRecord },
    platformCommit: release.platformValidatorCommit,
    runtimeBuildModified: false,
    stability: { path: `${release.runtimeEvidencePath}/stability.json`, ...stabilityRecord, result: stabilityMeasurement.result },
    result: parityMeasurement.result
  },
  visualAcceptance: { status: release.humanAcceptance, evidencePath: null },
  rights: pendingRights(),
  evidenceFiles: supportingEvidence
};
await writeJson(staged(`${release.provenancePath}/release-provenance.json`), releaseProvenance);

const releaseManifestRecord = {
  sceneId: release.sceneId,
  version: release.version,
  baseVersion: release.baseVersion,
  releaseKind: release.releaseKind,
  status: release.status,
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
  files: bundleFiles,
  stats: candidate.stats,
  reproducibility
};
const nextManifest = {
  ...manifest,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  rightsApprovalDate: null,
  licenseRef: null,
  publicationReady: false,
  platformValidatorCommit: release.platformValidatorCommit,
  releases: [...baseReleases, releaseManifestRecord]
};
await writeJson(staged("manifest.json"), nextManifest);
const nextRepository = {
  ...repository,
  releaseVersion: release.version,
  releaseMaterialized: true,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  isCurrent: false,
  publicationReady: false,
  rightsStatus: release.rightsStatus,
  rightsApproved: false,
  rightsApprovalDate: null,
  licenseRef: null,
  platformValidatorCommit: release.platformValidatorCommit
};
await writeJson(staged("scene-repository.json"), nextRepository);

const replacements = [
  release.releasePath,
  release.provenancePath,
  release.runtimeEvidencePath,
  release.capturePlanPath,
  release.visualConfigPath,
  release.acceptanceLockPath,
  release.acceptanceIndexPath,
  "manifest.json",
  "scene-repository.json"
].map((repositoryPath) => ({
  staged: staged(repositoryPath),
  target: join(root, repositoryPath),
  backup: join(backupRoot, repositoryPath)
}));
await install(replacements);
process.stdout.write(`Materialized ${release.sceneId}@${release.version} as a four-file non-current review candidate.\n`);
process.stdout.write(`GLB ${glbRecord.sizeBytes} bytes sha256=${glbRecord.sha256}\n`);
process.stdout.write(`Lightmap ${lightmap.sizeBytes} bytes sha256=${lightmap.sha256}\n`);
process.stdout.write(`Runtime capture ${parityMeasurement.result}: PHASH total ${parityMeasurement.aggregate.phashTotal}, NCC mean ${parityMeasurement.aggregate.nccMean}\n`);
