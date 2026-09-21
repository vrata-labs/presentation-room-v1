import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile, lstat } from "node:fs/promises";
import { resolve, join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const candidate = resolve(root, process.argv[2]);
const runtimeRoot = resolve(process.argv[3]);
const platformCommit = "a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d";
const version = "0.4.1";
const json = path => readFile(path, "utf8").then(JSON.parse);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const record = async path => { const bytes = await readFile(path); return { sha256: digest(bytes), sizeBytes: bytes.length }; };
const repository = await json(join(root, "scene-repository.json"));
const sceneId = repository.sceneId;
assert(["personal-workspace-v1", "presentation-room-v1"].includes(sceneId));
assert(relative(root, candidate).startsWith("build/"));
const personal = sceneId === "personal-workspace-v1";
const sourcePath = `source/releases/${version}`;
const releasePath = `assets/scenes/${sceneId}/${version}`;
const provenancePath = `provenance/releases/${version}`;
const capturePath = `provenance/runtime-capture-${version}`;
const lockName = personal ? "review-source-lock.json" : "accepted-source-lock.json";

async function guardedWrite(path, bytes) {
  const local = relative(root, path);
  assert(local && !local.startsWith("../") && !local.startsWith("/"));
  let cursor = root;
  for (const part of local.split("/")) {
    cursor = join(cursor, part);
    const value = await lstat(cursor).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    assert(!value?.isSymbolicLink(), `symlink_output:${local}`);
  }
  const tracked = spawnSync("git", ["ls-files", "--", local], { cwd: root, encoding: "utf8" });
  assert.equal(tracked.status, 0);
  if (tracked.stdout.trim()) {
    assert.equal(digest(await readFile(path)), digest(bytes), `immutable_snapshot_drift:${local}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
const put = (path, value) => guardedWrite(join(root, path), Buffer.from(JSON.stringify(value, null, 2)+"\n"));
const copy = async (input, output) => guardedWrite(join(root, output), await readFile(input));
async function files(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(entry.name !== "__pycache__", "python_cache_in_snapshot");
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await files(path));
    else { assert(entry.isFile(), "unsupported_snapshot_entry"); paths.push(path); }
  }
  return paths.sort();
}
async function pathRecord(path) { return { path: relative(root, path), ...await record(path) }; }

const scene = await json(join(candidate, "scene.json"));
const config = await json(join(candidate, "capture-config.json"));
const quality = await json(join(candidate, "quality-review.json"));
const reproduction = await json(join(candidate, "reproducibility.json"));
const clean = await json(join(candidate, "runtime-clean-release/capture-settings.json"));
const normal = await json(join(candidate, "runtime-normal-release/normal-product-evidence.json"));
const glb = await record(join(candidate, "scene.glb"));
assert.equal(scene.sceneId, sceneId);
assert.equal(scene.version, version);
assert.equal(scene.glbSha256, glb.sha256);
assert.equal(scene.rights.approvalStatus, "approved-for-public-staging-review");
assert.equal(quality.qualityOutcome, "READY_FOR_USER_REVIEW");
assert.deepEqual(quality.unresolvedQualityBlockers, []);
assert.equal(quality.humanAcceptance, "pending-human-acceptance");
assert.equal(reproduction.result, "passed");
assert.deepEqual(reproduction.expected, glb);
assert.deepEqual(reproduction.source, await record(join(candidate, "baked-source.blend")));
assert.equal(normal.verdict, "functional-checks-passed");
assert.equal(normal.manifestSha256, (await record(join(candidate, "scene.json"))).sha256);
for (const capture of [clean, normal]) {
  assert.equal(capture.glbSha256, glb.sha256);
  assert.equal(capture.captureBinding.runtimePlatformCommit, platformCommit);
  assert.equal(capture.captureBinding.baseSha256, (await record(join(runtimeRoot, "tests/e2e/scene-quality-0.4.1-base.ts"))).sha256);
  assert.equal(capture.captureBinding.runnerSha256, (await record(join(runtimeRoot, "tests/e2e/scene-quality-0.4.1-local.spec.ts"))).sha256);
}
assert.deepEqual(clean.views.map(view => view.id).sort(), config.reviewViews.map(view => view.id).sort());
for (const view of config.reviewViews) {
  await record(join(candidate, "source-review", `${view.id}.png`));
  await record(join(candidate, "runtime-clean-release", `${view.id}.png`));
}
const contentName = personal ? "rendered-workspace-content.json" : "rendered-media-frames.json";
const content = await json(join(candidate, "runtime-normal-release", contentName));
assert.deepEqual(content.captureBinding, normal.captureBinding);

function testsIn(suites) {
  return suites.flatMap(suite => [...(suite.specs ?? []).flatMap(spec => spec.tests ?? []), ...testsIn(suite.suites ?? [])]);
}
const runProofs = [];
for (const mode of ["clean", "normal"]) {
  const reportName = `${personal ? "personal" : "presentation"}-041-${mode}-release`;
  const reportBytes = await readFile(join(runtimeRoot, "test-results", `${reportName}.json`));
  const report = JSON.parse(reportBytes);
  assert.equal(report.stats.expected, 1);
  assert.equal(report.stats.unexpected, 0);
  assert.equal(report.stats.flaky, 0);
  assert.equal(report.stats.skipped, 0);
  assert.deepEqual(report.errors, []);
  const tests = testsIn(report.suites);
  assert.equal(tests.length, 1);
  assert(tests[0].results.every(result => result.status === "passed"));
  const binding = JSON.parse(tests[0].annotations.find(item => item.type === "scene-capture-binding").description);
  assert.deepEqual(binding, mode === "clean" ? clean.captureBinding : normal.captureBinding);
  runProofs.push({ mode, reportSha256: digest(reportBytes), stats: report.stats, captureBinding: binding });
}

await copy(fileURLToPath(import.meta.url), `${sourcePath}/snapshot-review.mjs`);
const validatorSource = join(dirname(fileURLToPath(import.meta.url)), "validate-scene-0.4.1.mjs");
await copy(await lstat(validatorSource).then(() => validatorSource, () => join(root, sourcePath, "validate-review.mjs")), `${sourcePath}/validate-review.mjs`);
const measurementSource = join(dirname(fileURLToPath(import.meta.url)), "measure-export-geometry.py");
await copy(await lstat(measurementSource).then(() => measurementSource, () => join(root, sourcePath, "measure-export-geometry.py")), `${sourcePath}/measure-export-geometry.py`);
for (const name of ["draft-scene.blend", "baked-source.blend", "lightmap.png", "scene.raw.glb", "object-registry.json", "capture-config.json"]) {
  await copy(join(candidate, name), `${sourcePath}/${name}`);
}
for (const name of ["geometry-measurements.json", "export-geometry.json", "support-measurements.json", "reproducibility.json", "rights-review-authorization.json", "quality-review.json"]) {
  await copy(join(candidate, name), `${provenancePath}/${name}`);
}
if (personal) await copy(join(candidate, "arrangement-measurements.json"), `${provenancePath}/arrangement-measurements.json`);
for (const entry of await readdir(candidate, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (/\.(stats|uv|enclosure)\.json$/.test(entry.name) || entry.name === "book-spines.json"
      || (entry.name.endsWith(".png") && !["lightmap.png", "lightmap-raw.png", ...config.reviewViews.map(view => `${view.id}.png`)].includes(entry.name))) {
    await copy(join(candidate, entry.name), `${sourcePath}/${entry.name}`);
  }
}
for (const [from, to] of [["source-review", `${sourcePath}/review`], ["runtime-clean-release", `${capturePath}/clean`], ["runtime-normal-release", `${capturePath}/normal-product`]]) {
  for (const path of await files(join(candidate, from))) await copy(path, `${to}/${relative(join(candidate, from), path)}`);
}
for (const name of ["scene-quality-0.4.1-base.ts", "scene-quality-0.4.1-local.spec.ts"]) {
  await copy(join(runtimeRoot, "tests/e2e", name), `${sourcePath}/${name}`);
}
await put(`${sourcePath}/visual-parity-config.json`, {
  schemaVersion: 1, sceneId, releaseVersion: version, platformRuntimeCommit: platformCommit,
  reviewViews: config.reviewViews, qualityOutcome: quality.qualityOutcome,
  humanAcceptance: "pending-human-acceptance", thresholds: { finalThresholdsDefined: false },
  regressionScope: "Exact-byte input/camera/coverage checks and manual paired-image assessment; no calibrated image-score quality claim.",
  captureRunner: { executable: "pnpm", argv: ["test:e2e", "tests/e2e/scene-quality-0.4.1-local.spec.ts", "--grep-invert", "@staging", "--workers=1"], workers: 1,
    environment: ["SCENE_QUALITY_DIR", "SCENE_QUALITY_OUTPUT", "SCENE_QUALITY_NORMAL", "BASE_URL", "E2E_API_PORT", "E2E_ROOM_STATE_PORT", "E2E_REMOTE_BROWSER_PORT"] }
});
await put(`${provenancePath}/local-run-results.json`, { schemaVersion: 1, sceneId, releaseVersion: version, runs: runProofs });

await mkdir(join(root, releasePath), { recursive: true });
for (const name of ["scene.json", "scene.glb", "LICENSES.md"]) await copy(join(candidate, name), `${releasePath}/${name}`);
const preview = join(candidate, "review-preview.webp");
assert.equal(spawnSync("convert", [join(candidate, "runtime-clean-release/entry.png"), "-strip", "-quality", "90", preview], { stdio: "inherit" }).status, 0);
await copy(preview, `${releasePath}/preview.webp`);
await copy(preview, `${sourcePath}/preview.webp`);
await copy(join(candidate, "scene.json"), `${sourcePath}/scene-manifest.json`);
await copy(join(candidate, "LICENSES.md"), `${sourcePath}/release-LICENSES.md`);
const releaseFiles = {};
for (const name of ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]) releaseFiles[name] = await record(join(root, releasePath, name));
const bytes = await readFile(join(candidate, "scene.glb"));
const gltf = JSON.parse(bytes.subarray(20, 20+bytes.readUInt32LE(12)).toString());
const primitives = gltf.meshes.flatMap(mesh => mesh.primitives);
const stats = { triangles: primitives.reduce((sum, p) => sum+(p.indices === undefined ? gltf.accessors[p.attributes.POSITION].count : gltf.accessors[p.indices].count)/3, 0), objects: gltf.nodes.length,
  meshes: gltf.meshes.length, primitives: primitives.length, materials: gltf.materials.length, textures: gltf.images.length, animations: (gltf.animations ?? []).length, scenes: gltf.scenes.length };
assert(stats.triangles <= 90000 && stats.primitives <= 250 && stats.meshes <= 250 && bytes.length <= 15728640, "release_budget_failed");
const sourceFiles = [];
for (const path of await files(join(root, sourcePath))) {
  if (basename(path) === lockName) continue;
  const item = await pathRecord(path);
  assert(item.sizeBytes < 100_000_000, `git_file_size_limit:${item.path}`);
  sourceFiles.push(item);
}
const baseLockPath = `source/releases/0.4.0/${lockName}`;
await put(`${sourcePath}/${lockName}`, {
  schemaVersion: 1, status: "review-source-lock", sceneId, releaseVersion: version,
  qualityOutcome: quality.qualityOutcome, humanAcceptance: "pending-human-acceptance",
  rightsStatus: "approved-for-public-staging-review", rightsApproved: true, isCurrent: false, publicationReady: false,
  platformValidatorCommit: platformCommit, sharedQualityContractCommit: platformCommit,
  baseSourceLock: await pathRecord(join(root, baseLockPath)), sourceFiles,
  toolchain: { blenderVersion: "4.5.12 LTS", blenderBuildHash: "84afd5f785f7", blenderBinarySha256: reproduction.blender.sha256, gltfTransform: "4.4.2", meshoptimizer: "1.0.1" },
  reproducibilityScope: reproduction.scope
});
const evidenceFiles = [];
for (const path of [...await files(join(root, provenancePath)), ...await files(join(root, capturePath))]) {
  if (basename(path) !== "release-ledger.json") evidenceFiles.push(await pathRecord(path));
}
await put(`${provenancePath}/release-ledger.json`, {
  schemaVersion: 1, sceneId, releaseVersion: version, releasePath, files: releaseFiles, stats,
  sourceLock: await pathRecord(join(root, sourcePath, lockName)), evidenceFiles,
  qualityOutcome: quality.qualityOutcome, humanAcceptance: "pending-human-acceptance",
  rightsStatus: "approved-for-public-staging-review", rightsApproved: true, isCurrent: false, publicationReady: false
});
const index = await json(join(root, "source/release-acceptance-index.json"));
const entry = { version, status: "review-source-lock", lockPath: `${sourcePath}/${lockName}`, lockSha256: (await record(join(root, sourcePath, lockName))).sha256,
  releaseLedgerPath: `${provenancePath}/release-ledger.json`, releaseLedgerSha256: (await record(join(root, provenancePath, "release-ledger.json"))).sha256,
  visualParityConfigPath: `${sourcePath}/visual-parity-config.json`, visualParityConfigSha256: (await record(join(root, sourcePath, "visual-parity-config.json"))).sha256,
  qualityOutcome: quality.qualityOutcome, humanVisualAccepted: false, rightsApproved: true, publicationReady: false, isCurrent: false };
const existing = index.releases.findIndex(item => item.version === version);
if (existing < 0) index.releases.push(entry); else index.releases[existing] = entry;
const baselineIndex = spawnSync("git", ["show", "HEAD:source/release-acceptance-index.json"], { cwd: root, encoding: "utf8" });
assert.equal(baselineIndex.status, 0, "acceptance_index_baseline_unavailable");
for (const [position, prior] of JSON.parse(baselineIndex.stdout).releases.entries()) assert.deepEqual(index.releases[position], prior, "acceptance_index_history_changed");
await writeFile(join(root, "source/release-acceptance-index.json"), JSON.stringify(index, null, 2)+"\n");
const manifest = await json(join(root, "manifest.json"));
const manifestEntry = {
  sceneId, version, baseVersion: "0.4.0", releaseKind: "quality-rework-review", releasePath,
  status: "review", humanAcceptance: "pending-human-acceptance", acceptanceStatus: "pending-human-acceptance", visualAcceptanceStatus: "pending-human-acceptance",
  qualityOutcome: quality.qualityOutcome, rightsStatus: "approved-for-public-staging-review", rightsApprovalStatus: "approved-for-public-staging-review",
  rightsApproved: true, isCurrent: false, publicationReady: false, platformValidatorCommit: platformCommit,
  files: releaseFiles, stats,
  sourceLockPath: entry.lockPath, sourceLockSha256: entry.lockSha256,
  releaseLedgerPath: entry.releaseLedgerPath, releaseLedgerSha256: entry.releaseLedgerSha256,
  reproducibility: { result: "byte-identical-raw-and-final-glb", runs: 2, scope: reproduction.scope }
};
const manifestPosition = manifest.releases.findIndex(item => item.version === version);
if (manifestPosition < 0) manifest.releases.push(manifestEntry); else manifest.releases[manifestPosition] = manifestEntry;
const baselineManifest = spawnSync("git", ["show", "HEAD:manifest.json"], { cwd: root, encoding: "utf8" });
assert.equal(baselineManifest.status, 0);
for (const [position, prior] of JSON.parse(baselineManifest.stdout).releases.entries()) assert.deepEqual(manifest.releases[position], prior, "release_history_changed");
for (const item of [manifest, repository]) {
  item.platformValidatorCommit = platformCommit;
  item.qualityOutcome = quality.qualityOutcome;
  item.rightsApproved = true;
  item.isCurrent = false;
  item.publicationReady = false;
  if ("rightsStatus" in item) item.rightsStatus = "approved-for-public-staging-review";
  if ("rightsApprovalStatus" in item) item.rightsApprovalStatus = "approved-for-public-staging-review";
  if ("licenseRef" in item) item.licenseRef = "LicenseRef-Project-Authored-Public-Staging-Review";
}
repository.releaseVersion = version;
await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2)+"\n");
await writeFile(join(root, "scene-repository.json"), JSON.stringify(repository, null, 2)+"\n");
console.log(JSON.stringify({ releasePath, sourcePath, provenancePath, stats, files: releaseFiles }, null, 2));
