import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { acceptanceIndexEntryRecord, assertAcceptanceIndexPrefix, fileRecord, pathTrackedInGit, readJson, repositoryToolingPaths } from "../scripts/lib.mjs";
import { assertPendingGates, measureRuntimeCapture, requiredReleaseFiles, reviewEvidence, root, runtimeCaptureBaseFiles, runtimeEvidenceFiles, validateCandidate, validateRuntimeDiagnostics, validateRuntimeStability } from "../scripts/release-0.3-lib.mjs";
import { release030 as release } from "../scripts/release-0.3-config.mjs";

async function relativeFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await relativeFiles(join(directory, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

test("integrity helpers reject rewritten history, approval claims, and ambiguous git state", async () => {
  const baseIndex = { schemaVersion: 1, sceneId: release.sceneId, releases: [{ version: "0.2.0", lockSha256: "base" }] };
  assert.doesNotThrow(() => assertAcceptanceIndexPrefix(baseIndex, {
    ...baseIndex,
    releases: [...baseIndex.releases, { version: release.version, lockSha256: "candidate" }]
  }));
  assert.throws(() => assertAcceptanceIndexPrefix(baseIndex, { ...baseIndex, releases: [] }), /acceptance_index_history_deleted/);
  assert.throws(() => assertAcceptanceIndexPrefix(baseIndex, {
    ...baseIndex,
    releases: [{ version: "0.2.0", lockSha256: "changed" }]
  }), /acceptance_index_history_changed/);
  for (const claim of [
    { status: "active" },
    { visualApproval: "approved" },
    { rightsApproval: "approved-for-public-staging-review" },
    { humanRightsApproval: "approved-for-public-staging-review" },
    { rightsApproval: { status: "approved-for-public-staging-review" } },
    { rightsApproval: null },
    { rightsApproval: [] },
    { visualAcceptance: "approved" },
    { visualAcceptance: { status: "approved" } },
    { humanRightsAccepted: true },
    { humanGates: { visual: "approved" } },
    { humanGates: { rights: "approved-for-public-staging-review" } },
    { immutableRelease: true },
    { publicationReady: true }
  ]) assert.throws(() => assertPendingGates(claim, "probe"));
  assert.doesNotThrow(() => assertPendingGates({ rightsApproval: "approved-for-public-staging-review", rightsApproved: true }, "historical", { allowApprovedRights: true }));
  assert.doesNotThrow(() => assertPendingGates({ rightsApproval: { status: "approved-for-public-staging-review" } }, "historical", { allowApprovedRights: true }));
  const historicalOptions = { allowHistoricalManifestRecords: true };
  assert.doesNotThrow(() => assertPendingGates({ releases: [
    { version: "0.2.0", rightsStatus: "approved-for-public-staging-review", rightsApproved: true },
    { version: release.version, rightsStatus: release.rightsStatus, rightsApproved: false }
  ] }, "manifest.json", historicalOptions));
  for (const claim of [
    { version: "0.2.0", rightsApproved: true },
    { extra: { version: "0.2.0", rightsApproved: true } },
    { releases: [{ version: "0.4.0", rightsApproved: true }] },
    { releases: [{ version: release.version, details: { version: "0.2.0", rightsApproved: true } }] },
    { releases: [{ version: release.version, releases: [{ version: "0.2.0", rightsApproved: true }] }] }
  ]) assert.throws(() => assertPendingGates(claim, "manifest.json", historicalOptions), /rights_approval_claim/);
  assert.equal(pathTrackedInGit(root, "package.json"), true);
  assert.equal(pathTrackedInGit(root, "missing-integrity-probe"), false);
  const tooling = await repositoryToolingPaths(root);
  for (const path of [
    ".github/workflows/validate.yml",
    "package.json",
    "pnpm-lock.yaml",
    "scripts/build-baked-review.mjs",
    "scripts/build-release.mjs",
    "scripts/inspect-release.mjs",
    "scripts/materialize-release-0.3.mjs",
    "scripts/validate-acceptance-index-prefix.mjs",
    "source/releases/0.3.0/export-release.py",
    "tests/release-0.3.test.mjs"
  ]) assert.ok(tooling.includes(path), path);
});

test("0.3.0 is append-only, review-only, non-current, and rights-pending", async () => {
  const [config, manifest, packageJson] = await Promise.all([
    readJson(join(root, "scene-repository.json")),
    readJson(join(root, "manifest.json")),
    readJson(join(root, "package.json"))
  ]);
  assert.equal(packageJson.version, "0.4.0");
  assert.equal(config.releaseVersion, "0.4.0");
  assert.equal(config.releaseMaterialized, true);
  const expectedRepositoryRights = {
    rightsStatus: release.rightsStatus,
    rightsApproved: false,
    rightsApprovalDate: null,
    licenseRef: null
  };
  assert.deepEqual({ rightsStatus: config.rightsStatus, rightsApproved: config.rightsApproved, rightsApprovalDate: config.rightsApprovalDate, licenseRef: config.licenseRef }, expectedRepositoryRights);
  assert.deepEqual({ rightsStatus: manifest.rightsStatus, rightsApproved: manifest.rightsApproved, rightsApprovalDate: manifest.rightsApprovalDate, licenseRef: manifest.licenseRef }, expectedRepositoryRights);
  assert.deepEqual(manifest.releases.map(({ version }) => version), ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0"]);
  const candidate = manifest.releases.find(({ version }) => version === release.version);
  assert.deepEqual({
    status: candidate.status,
    humanAcceptance: candidate.humanAcceptance,
    rightsStatus: candidate.rightsStatus,
    rightsApproved: candidate.rightsApproved,
    isCurrent: candidate.isCurrent,
    publicationReady: candidate.publicationReady
  }, {
    status: "review",
    humanAcceptance: "pending-human-acceptance",
    rightsStatus: "pending-human-rights-approval",
    rightsApproved: false,
    isCurrent: false,
    publicationReady: false
  });
  assert.ok(manifest.releases.slice(0, 3).every(({ rightsApproved }) => rightsApproved === true));
});

test("0.3.0 bundle contains exactly four bound files", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  const candidate = manifest.releases.find(({ version }) => version === release.version);
  assert.deepEqual((await readdir(join(root, candidate.releasePath))).sort(), [...requiredReleaseFiles].sort());
  for (const name of requiredReleaseFiles) assert.deepEqual(await fileRecord(join(root, candidate.releasePath, name)), candidate.files[name]);
  const scene = await readJson(join(root, candidate.releasePath, "scene.json"));
  assert.equal(scene.glbSha256, release.accepted.releaseGlbSha256);
  assert.equal(scene.source, release.sourceBlendPath);
  assert.equal(scene.rights.rightsApproved, false);
  assert.deepEqual(scene.rights.clearedFor, []);
  assert.equal(candidate.files["preview.webp"].sha256, (await fileRecord(join(root, release.sourceReviewPath, "entry.webp"))).sha256);
});

test("0.3.0 source and runtime review bind three repeatable seven-view runs without human acceptance", async () => {
  const [reviews, lock, plan, visual, binding, stability] = await Promise.all([
    reviewEvidence(),
    readJson(join(root, release.acceptanceLockPath)),
    readJson(join(root, release.capturePlanPath)),
    readJson(join(root, release.visualConfigPath)),
    readJson(join(root, release.runtimeEvidencePath, "capture-binding.json")),
    readJson(join(root, release.runtimeEvidencePath, "stability.json"))
  ]);
  const runs = await Promise.all(release.runtimeCapture.runs.map(async (id) => {
    const runPath = `${release.runtimeEvidencePath}/runs/${id}`;
    const [diagnostics, settings, measurement] = await Promise.all([
      readJson(join(root, runPath, "scene-debug.json")),
      readJson(join(root, runPath, "capture-settings.json")),
      measureRuntimeCapture(join(root, runPath), runPath)
    ]);
    const files = Object.fromEntries(await Promise.all(runtimeCaptureBaseFiles.map(async (name) => [
      name,
      { path: `${runPath}/${name}`, ...await fileRecord(join(root, runPath, name)) }
    ])));
    return { id, diagnostics: validateRuntimeDiagnostics(diagnostics, settings), measurement, files };
  }));
  const measuredStability = validateRuntimeStability(runs);
  const measured = runs.find(({ id }) => id === release.runtimeCapture.canonicalRunId).measurement;
  assert.equal(reviews.length, 7);
  assert.ok(reviews.every(({ width, height, meanLuminance, darkPixelRatioBelow10Percent }) => width === 960 && height === 540 && meanLuminance > 0.2 && darkPixelRatioBelow10Percent < 0.5));
  assert.deepEqual(lock.reviewViews, reviews);
  assert.equal(plan.thresholds.finalThresholdsDefined, false);
  assert.equal(visual.thresholds.finalThresholdsDefined, true);
  assert.deepEqual(visual.thresholds.perView, release.runtimeCapture.visualParity.perView);
  assert.deepEqual(visual.thresholds.derivation, measuredStability.thresholdDerivation);
  assert.equal(measured.result, "passed");
  assert.equal(stability.result, "byte-identical-images-across-three-full-view-runs");
  assert.equal(stability.completedRuns, 3);
  assert.ok(stability.perView.every(({ byteIdentical, uniqueImageCount }) => byteIdentical && uniqueImageCount === 1));
  assert.equal(binding.runtimeBuildModified, false);
  assert.equal(binding.recordType, "candidate-local-repeated-capture-record");
  assert.deepEqual(binding.provenanceScope, {
    candidateCiReplaysCapture: false,
    candidateCiValidatesCommittedArtifacts: true,
    independentVerification: "required-on-exact-merge-sha-staging"
  });
  assert.equal(binding.humanAcceptanceRecorded, false);
  assert.equal(binding.rightsApproved, false);
  assert.equal(binding.captureHarness.patchSha256, release.runtimeCapture.harnessPatchSha256);
  assert.deepEqual(binding.diagnostics, Object.fromEntries(runs.map(({ id, diagnostics }) => [id, diagnostics])));
  assert.deepEqual((await relativeFiles(join(root, release.runtimeEvidencePath))).sort(), [...runtimeEvidenceFiles].sort());
  assert.ok(visual.views.every(({ captureFile, status }) => captureFile?.startsWith(`${release.runtimeEvidencePath}/runs/${release.runtimeCapture.canonicalRunId}/`) && status === "passed"));
});

test("0.3.0 GLB preserves geometry and carries complete reality semantics", async () => {
  const candidate = await validateCandidate(join(root, release.releasePath, "scene.glb"));
  assert.deepEqual(candidate.stats, {
    triangles: 32060,
    objects: 210,
    meshes: 193,
    primitives: 193,
    materials: 10,
    textures: 8,
    animations: 0
  });
  assert.equal(candidate.geometry.sha256, release.accepted.geometryFingerprintSha256);
  assert.equal(candidate.geometry.unchanged, true);
  assert.deepEqual(candidate.statusCounts, { passive: 90, deferred: 14, interactive: 89 });
  assert.deepEqual({ errors: candidate.khronos.errors, warnings: candidate.khronos.warnings }, { errors: 0, warnings: 0 });
  assert.equal(candidate.gltfInventory.textureObjects, 17);
  assert.equal(candidate.gltfInventory.imagePayloads, 8);
});

test("0.3.0 acceptance and provenance records bind exact bytes without activation claims", async () => {
  const [index, lock, provenance, realityReport, generationLedger] = await Promise.all([
    readJson(join(root, release.acceptanceIndexPath)),
    readJson(join(root, release.acceptanceLockPath)),
    readJson(join(root, release.provenancePath, "release-provenance.json")),
    readJson(join(root, release.provenancePath, "scene-reality-report.json")),
    readJson(join(root, release.provenancePath, "generation-ledger.json"))
  ]);
  const indexed = index.releases.find(({ version }) => version === release.version);
  assert.ok(indexed);
  assert.equal(indexed.lockSha256, (await fileRecord(join(root, indexed.lockPath))).sha256);
  assert.equal(indexed.visualParityConfigSha256, (await fileRecord(join(root, indexed.visualParityConfigPath))).sha256);
  assert.equal(lock.release.glbSha256, release.accepted.releaseGlbSha256);
  assert.equal(lock.boundaries.technicalSourceLocked, true);
  assert.equal(lock.boundaries.runtimeCaptureArtifactsValidated, true);
  assert.equal(lock.boundaries.visualAccepted, false);
  assert.equal(lock.boundaries.rightsApproved, false);
  assert.equal(lock.boundaries.stagingVerified, false);
  assert.ok(lock.tooling.length > 0);
  assert.deepEqual(generationLedger.tooling, lock.tooling);
  assert.equal(provenance.runtimeCapture.evidencePath, release.runtimeEvidencePath);
  assert.equal(provenance.runtimeCapture.status, "passed-repeatable-technical-local-capture");
  assert.equal(provenance.runtimeCapture.stability.result, release.runtimeCapture.stability.requiredResult);
  assert.equal(provenance.runtimeCapture.runtimeBuildModified, false);
  assert.equal(provenance.visualAcceptance.evidencePath, null);
  const appended = { ...index, releases: [...index.releases, { version: "0.5.0", lockSha256: "next" }] };
  assert.doesNotThrow(() => assertAcceptanceIndexPrefix(index, appended));
  assert.deepEqual(provenance.source.acceptanceIndex, {
    path: release.acceptanceIndexPath,
    ...acceptanceIndexEntryRecord(appended, release.version)
  });
  const rewritten = structuredClone(index);
  rewritten.releases[0].lockSha256 = "rewritten";
  assert.notDeepEqual(acceptanceIndexEntryRecord(rewritten, release.version), acceptanceIndexEntryRecord(index, release.version));
  assert.equal(realityReport.result, "passed");
  assert.equal(realityReport.meshTags.validatedParts, 193);
  assert.equal((await readFile(join(root, release.releasePath, "LICENSES.md"), "utf8")).includes("Human rights approval for these exact bytes is pending."), true);
});

test("0.3.0 source portability and materialization recovery are fail closed", async () => {
  const [exporter, materializer, builder] = await Promise.all([
    readFile(join(root, release.exportScriptPath), "utf8"),
    readFile(join(root, "scripts/materialize-release-0.3.mjs"), "utf8"),
    readFile(join(root, "scripts/build-release.mjs"), "utf8")
  ]);
  assert.match(exporter, /len\(bpy\.data\.libraries\) == 0/);
  assert.match(exporter, /bpy\.utils\.blend_paths\(absolute=False, packed=False, local=True\)/);
  assert.match(exporter, /image\.packed_file is not None/);
  assert.match(materializer, /materialization_install_and_rollback_failed/);
  assert.match(materializer, /AggregateError/);
  assert.doesNotMatch(materializer, /finally\s*\{/);
  assert.match(materializer, /assertUntrackedOutput\(root, path\)/);
  assert.match(builder, /assertUntrackedOutput\(root, path\)/);
});
