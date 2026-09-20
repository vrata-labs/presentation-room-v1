import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { fileRecord, readJson } from "../scripts/lib.mjs";
import { cleanEvidenceFiles, normalEvidenceFiles, requiredReleaseFiles, root, validateCandidate, validateMeasurements, validateNormalEvidence } from "../scripts/release-0.4-lib.mjs";
import { release040 as release } from "../scripts/release-0.4-config.mjs";

test("0.4.0 is appended without promotion, rights approval, or visual acceptance", async () => {
  const [repository, manifest, packageJson] = await Promise.all([
    readJson(join(root, "scene-repository.json")),
    readJson(join(root, "manifest.json")),
    readJson(join(root, "package.json"))
  ]);
  assert.equal(packageJson.version, release.version);
  assert.equal(repository.releaseVersion, release.version);
  assert.equal(repository.qualityOutcome, "REWORK_REQUIRED");
  assert.deepEqual(manifest.releases.map(({ version }) => version), ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0"]);
  const candidate = manifest.releases.at(-1);
  assert.deepEqual({
    status: candidate.status,
    qualityOutcome: candidate.qualityOutcome,
    humanAcceptance: candidate.humanAcceptance,
    rightsApproved: candidate.rightsApproved,
    isCurrent: candidate.isCurrent,
    publicationReady: candidate.publicationReady
  }, {
    status: "review",
    qualityOutcome: "REWORK_REQUIRED",
    humanAcceptance: "pending-human-acceptance",
    rightsApproved: false,
    isCurrent: false,
    publicationReady: false
  });
  assert.equal(candidate.budgetAssessment.status, "failed-unresolved-exception");
});

test("0.4.0 bundle contains exactly four files and the exact validated Meshopt GLB", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  const candidate = manifest.releases.find(({ version }) => version === release.version);
  assert.deepEqual((await readdir(join(root, candidate.releasePath))).sort(), [...requiredReleaseFiles].sort());
  for (const name of requiredReleaseFiles) assert.deepEqual(await fileRecord(join(root, candidate.releasePath, name)), candidate.files[name]);
  const validation = await validateCandidate(join(root, candidate.releasePath, "scene.glb"));
  assert.deepEqual(validation.stats, release.stats);
  assert.deepEqual(validation.record, release.finalGlb);
  assert.deepEqual({ errors: validation.khronos.errors, warnings: validation.khronos.warnings }, { errors: 0, warnings: 0 });
});

test("0.4.0 measurements bind 225 shipping meshes and 385 supported constituent parts", async () => {
  const { registry, geometry, supports } = await validateMeasurements();
  assert.equal(registry.objects.flatMap(({ parts }) => parts).length, 225);
  assert.equal(geometry.screenVisibility.rays.length, 40);
  assert.equal(geometry.userClearances.routes.length, 9);
  assert.equal(geometry.userClearances.sitStandSweeps.length, 8);
  assert.equal(supports.physicalConstituentParts, 385);
  assert.ok(Object.values(supports.failures).every((failures) => failures.length === 0));
});

test("clean and product evidence stay separate and do not claim repeatability or a rendered media frame", async () => {
  const binding = await readJson(join(root, release.runtimeEvidencePath, "capture-binding.json"));
  const normal = await validateNormalEvidence();
  assert.equal(binding.cleanCapture.repeatabilityClaimed, false);
  assert.equal(binding.cleanCapture.qualityAcceptanceClaimed, false);
  assert.equal(binding.threeRunEvidence, false);
  assert.equal(binding.normalProductCapture.renderedMediaFrame, "pending-not-evidenced");
  assert.equal(binding.normalProductCapture.mediaObjectLifecycleOnly, true);
  assert.equal(normal.mediaAfterCreate.surfaces[0].activeObjectType, "screen-share");
  assert.equal(normal.mediaAfterCreate.surfaces[0].textureId, null);
  assert.deepEqual(binding.cleanCapture.files.map(({ path }) => path.split("/").at(-1)).sort(), [...cleanEvidenceFiles].sort());
  assert.deepEqual(binding.normalProductCapture.files.map(({ path }) => path.split("/").at(-1)).sort(), [...normalEvidenceFiles].sort());
});

test("0.4.0 source lock records the exact harness and known visual defects", async () => {
  const [lock, visual, harness, runner] = await Promise.all([
    readJson(join(root, release.acceptanceLockPath)),
    readJson(join(root, release.visualConfigPath)),
    fileRecord(join(root, release.sourcePath, release.captureHarness.target)),
    fileRecord(join(root, release.sourcePath, release.captureRunnerConfig.target))
  ]);
  assert.equal(harness.sha256, release.captureHarness.sha256);
  assert.equal(runner.sha256, release.captureRunnerConfig.sha256);
  assert.equal(lock.boundaries.repeatedRuntimeCaptureValidated, false);
  assert.equal(lock.boundaries.renderedMediaFrameValidated, false);
  assert.equal(visual.sourceToRuntimeFidelity.status, "failed-visible-material-regression");
  assert.deepEqual(visual.sourceToRuntimeFidelity.affectedViews, ["chair-detail", "chair-underneath", "presenter", "diagonal-overview"]);
  assert.match(visual.sourceToRuntimeFidelity.defects.at(-1), /wall and ceiling join seams/);
  assert.deepEqual(visual.qualityAssessment.unresolvedDefects, release.unresolvedDefects);
  const materializer = await readFile(join(root, "scripts/materialize-release-0.4.mjs"), "utf8");
  assert.match(materializer, /materialization_install_and_rollback_failed/);
  assert.match(materializer, /assertUntrackedOutput\(root, target\)/);
});
