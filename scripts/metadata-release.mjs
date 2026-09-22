import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertScratchOutput } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const version = "0.4.2";
const sourcePath = `source/releases/${version}`;
const evidencePath = `provenance/releases/${version}`;
const encode = value => Buffer.from(JSON.stringify(value, null, 2)+"\n");
const record = bytes => ({ sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length });
const readJson = async path => JSON.parse(await readFile(join(root, path), "utf8"));
function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: root, encoding, maxBuffer: 64*1024*1024 });
  assert.equal(result.status, 0, result.stderr?.toString()); return result.stdout;
}

export async function metadataArtifacts() {
  const base = await readJson(`${sourcePath}/base.json`);
  assert.equal(base.version, version);
  assert.equal(base.baseVersion, "0.4.1");
  assert.equal(base.rightsDate, "2026-09-22");
  assert.equal(base.rightsAnswer, "Да, разрешаю основной выпуск");
  assert.equal(base.visualAcceptancePath, "docs/reviews/2026-09-21-0.4.1-visual-acceptance.md");
  assert(/^[a-f0-9]{40}$/.test(base.baseCommit));
  if (spawnSync("git", ["cat-file", "-e", `${base.baseCommit}^{commit}`], { cwd: root, stdio: "ignore" }).status !== 0) git(["fetch", "--no-tags", "--depth=1", "origin", base.baseCommit]);
  const historical = JSON.parse(git(["show", `${base.baseCommit}:manifest.json`]));
  const release = historical.releases.find(value => value.version === base.baseVersion);
  assert.equal(release.sceneId, base.sceneId);
  const baseFiles = Object.fromEntries(["scene.json", "scene.glb", "preview.webp", "LICENSES.md"].map(name => {
    const bytes = git(["show", `${base.baseCommit}:${release.releasePath}/${name}`], "buffer");
    assert.deepEqual(record(bytes), release.files[name]); return [name, bytes];
  }));
  const scene = JSON.parse(baseFiles["scene.json"]);
  scene.version = version;
  scene.rights.approvalStatus = "approved-for-product-release";
  scene.rights.licenseRef = `LicenseRef-Vrata-Product-Release-${base.rightsDate}`;
  scene.rights.clearedFor = ["staging", "production", "web-runtime", "screenshots", "optimization", "redistribution"];
  const attribution = baseFiles["LICENSES.md"].toString().split("Geometry, original labels")[1]?.split("This is a new, scoped")[0];
  assert(attribution, "base_attribution_missing");
  const licenses = `# ${scene.label} ${version} — product-release rights\n\nLicense reference: LicenseRef-Vrata-Product-Release-${base.rightsDate}.\n\nThe project owner explicitly answered «${base.rightsAnswer}» when asked to authorize these accepted scenes and their documented CC0 inputs as standard product scenes, including production and public GLB redistribution. This permits staging, production, web delivery, screenshots, optimization and redistribution of this bundle.\n\nGeometry and preview are byte-identical to the visually accepted ${base.baseVersion}; only version and rights metadata change.\n\nGeometry, original labels${attribution}\nThis permission does not rewrite historical review records. Device acceptance and catalog activation are recorded separately.\n`;
  const files = { "scene.json": encode(scene), "scene.glb": baseFiles["scene.glb"], "preview.webp": baseFiles["preview.webp"], "LICENSES.md": Buffer.from(licenses) };
  return { base, historical, release, files };
}

export async function validateMetadataFiles(directory, files, records) {
  assert.deepEqual((await readdir(directory)).sort(), Object.keys(files).sort());
  for (const [name, expected] of Object.entries(files)) {
    const actual = await readFile(join(directory, name));
    assert(actual.equals(expected), `metadata_release_bytes_changed:${name}`);
    assert.deepEqual(records[name], record(actual));
  }
}

export async function validateMetadataRelease() {
  const { base, historical, release, files } = await metadataArtifacts();
  const manifest = await readJson("manifest.json");
  const index = await readJson("source/release-acceptance-index.json");
  assert.deepEqual((await readdir(join(root, "assets/scenes"))).sort(), [base.sceneId], "single_scene_boundary_violated");
  assert.deepEqual((await readdir(join(root, "assets/scenes", base.sceneId))).sort(), manifest.releases.map(value => value.version).sort(), "release_inventory_drift");
  assert.deepEqual((await readdir(join(root, sourcePath))).sort(), ["base.json", "release-lock.json"]);
  assert.deepEqual((await readdir(join(root, evidencePath))).sort(), ["rights-approval.md"]);
  const oldIndex = JSON.parse(git(["show", `${base.baseCommit}:source/release-acceptance-index.json`]));
  assert.deepEqual(manifest.releases.slice(0, -1), historical.releases, "historical_release_records_changed");
  assert.deepEqual(index.releases.slice(0, -1), oldIndex.releases, "historical_acceptance_records_changed");
  const current = manifest.releases.at(-1);
  assert.equal(current.version, version);
  assert.equal(current.baseVersion, base.baseVersion);
  assert.equal(current.releaseKind, "rights-metadata-only");
  assert.equal(current.humanAcceptance, "accepted");
  assert.equal(current.rightsApprovalStatus, "approved-for-product-release");
  assert.equal(current.isCurrent, false);
  assert.equal(current.publicationReady, false);
  assert.deepEqual(current.stats, release.stats);
  assert.equal(current.releasePath, `assets/scenes/${base.sceneId}/${version}`);
  await validateMetadataFiles(join(root, current.releasePath), files, current.files);
  const lockBytes = await readFile(join(root, sourcePath, "release-lock.json"));
  const lock = JSON.parse(lockBytes);
  assert.deepEqual(lock.files, current.files);
  assert.deepEqual(lock.base, base);
  assert.equal(lock.rightsEvidence.sha256, record(await readFile(join(root, lock.rightsEvidence.path))).sha256);
  for (const value of [manifest, await readJson("scene-repository.json")]) {
    assert.equal(value.humanAcceptance, "accepted");
    assert.equal(value.qualityOutcome, "VISUALLY_ACCEPTED");
    assert.equal(value.rightsApprovalStatus, "approved-for-product-release");
  }
  assert.equal(index.releases.at(-1).sourceLockSha256, record(lockBytes).sha256);
  assert.equal(lock.visualAcceptance.sha256, record(git(["show", `${base.baseCommit}:${base.visualAcceptancePath}`], "buffer")).sha256);
  assert.equal(lock.baseSourceManifest.sha256, record(git(["show", `${base.baseCommit}:${release.releasePath}/scene.json`], "buffer")).sha256);
  for (const line of git(["ls-tree", "-r", base.baseCommit, "--", "source", "provenance", "assets/scenes"]).trim().split("\n")) {
    if (!line) continue;
    const [descriptor, path] = line.split("\t");
    if (path === "source/release-acceptance-index.json") continue;
    assert.equal(git(["hash-object", "--", path]).trim(), descriptor.split(" ")[2], `historical_bytes_changed:${path}`);
  }
  console.log(`${base.sceneId}@${version}: metadata-only rights release verified; accepted GLB/preview bytes unchanged.`);
}

async function snapshot() {
  const { base, release, files } = await metadataArtifacts();
  const path = `assets/scenes/${base.sceneId}/${version}`;
  for (const args of [["ls-files", "--", sourcePath, evidencePath, path], ["ls-tree", "-r", "--name-only", "HEAD", "--", sourcePath, evidencePath, path]]) assert.equal(git(args).trim(), "", "metadata_snapshot_already_tracked");
  async function save(path, bytes) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes); }
  const records = {};
  for (const [name, bytes] of Object.entries(files)) { await save(`${path}/${name}`, bytes); records[name] = record(bytes); }
  const approval = `# Product-release rights, ${base.rightsDate}\n\nScene: ${base.sceneId}. Release ${version} preserves the exact accepted ${base.baseVersion} GLB (${records["scene.glb"].sha256}).\n\nQuestion: ${base.rightsQuestion}\n\nUser answer: «${base.rightsAnswer}».\n\nThis extends the previous staging-review permission to standard product use, production and public GLB redistribution for these same documented inputs. Human visual acceptance is recorded at ${base.baseCommit}:${base.visualAcceptancePath}. Device acceptance and catalog activation remain separate.\n`;
  await save(`${evidencePath}/rights-approval.md`, Buffer.from(approval));
  const lock = { schemaVersion: 1, releaseKind: "rights-metadata-only", base, files: records, visualAcceptance: { path: base.visualAcceptancePath, commit: base.baseCommit, ...record(git(["show", `${base.baseCommit}:${base.visualAcceptancePath}`], "buffer")) }, baseSourceManifest: { path: `${release.releasePath}/scene.json`, ...record(git(["show", `${base.baseCommit}:${release.releasePath}/scene.json`], "buffer")) }, rightsEvidence: { path: `${evidencePath}/rights-approval.md`, ...record(Buffer.from(approval)) } };
  await save(`${sourcePath}/release-lock.json`, encode(lock));
  const manifest = await readJson("manifest.json");
  manifest.releases = manifest.releases.filter(item => item.version !== version);
  manifest.releases.push({ sceneId: base.sceneId, version, baseVersion: base.baseVersion, releaseKind: "rights-metadata-only", releasePath: path, status: "review", humanAcceptance: "accepted", qualityOutcome: "VISUALLY_ACCEPTED", rightsApproved: true, rightsApprovalStatus: "approved-for-product-release", isCurrent: false, publicationReady: false, files: records, stats: release.stats });
  for (const value of [manifest, await readJson("scene-repository.json")]) {
    Object.assign(value, { acceptanceStatus: "accepted", visualAcceptanceStatus: "accepted", humanAcceptance: "accepted", qualityOutcome: "VISUALLY_ACCEPTED", rightsApprovalStatus: "approved-for-product-release", rightsStatus: "approved-for-product-release", rightsApproved: true, rightsApprovalDate: base.rightsDate, licenseRef: `LicenseRef-Vrata-Product-Release-${base.rightsDate}` });
    if (value.oneSceneOnly) { value.releaseVersion = version; await save("scene-repository.json", encode(value)); }
  }
  await save("manifest.json", encode(manifest));
  const index = await readJson("source/release-acceptance-index.json");
  index.releases = index.releases.filter(item => item.version !== version);
  index.releases.push({ version, releaseKind: "rights-metadata-only", sourceLockPath: `${sourcePath}/release-lock.json`, sourceLockSha256: record(encode(lock)).sha256, isCurrent: false, publicationReady: false });
  await save("source/release-acceptance-index.json", encode(index));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "snapshot") { await snapshot(); await validateMetadataRelease(); }
  else if (process.argv[2] === "validate") await validateMetadataRelease();
  else if (process.argv[2] === "build") {
    const { files } = await metadataArtifacts();
    const directory = join(root, "build/releases/0.4.2");
    await assertScratchOutput(root, directory); await mkdir(directory, { recursive: true });
    for (const [name, bytes] of Object.entries(files)) { const path = join(directory, name); await assertScratchOutput(root, path); await writeFile(path, bytes); }
  } else throw new Error("metadata_release_command_required");
}
