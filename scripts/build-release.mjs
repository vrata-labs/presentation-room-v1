import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { assert, assertUntrackedOutput, fileRecord } from "./lib.mjs";
import { release030 as release } from "./release-0.3-config.mjs";

const root = resolve(import.meta.dirname, "..");
const replaceUntracked = process.argv.includes("--replace-untracked");
const modes = ["--author", "--bake", "--twice"].filter((flag) => process.argv.includes(flag));
assert(modes.length <= 1, "release_build_mode_conflict");
const mode = modes[0] ?? "--build";

function repositoryPath(path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function prepareGeneratedPath(path) {
  await assertUntrackedOutput(root, path);
  if (!await exists(path)) return;
  assert(replaceUntracked, `generated_path_exists:${relative(root, path)}`);
  await rm(path, { recursive: true, force: true });
}

function blenderExecutable() {
  const configured = process.env.BLENDER_BIN?.trim();
  assert(configured, "blender_bin_required");
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

function run(command, args, code) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${code}:${result.error?.message ?? result.signal ?? result.status}`);
}

async function verifyBlender(blender) {
  const binary = await fileRecord(blender);
  assert(binary.sha256 === release.blender.binarySha256, `blender_binary_digest_mismatch:${binary.sha256}`);
  const version = spawnSync(blender, ["--version"], { cwd: root, encoding: "utf8" });
  assert(version.status === 0, "blender_version_failed");
  assert(version.stdout.includes(`Blender ${release.blender.version}`), "blender_version_mismatch");
  assert(version.stdout.includes(`build hash: ${release.blender.buildHash}`), "blender_build_hash_mismatch");
}

async function acceptedSourceRecord() {
  const source = repositoryPath(release.sourceBlendPath);
  assert(await exists(source), "accepted_source_missing:run --author first");
  const record = await fileRecord(source);
  assert(record.sha256 === release.accepted.sourceBlendSha256, `accepted_source_digest_mismatch:${record.sha256}`);
  return record;
}

async function verifyReleaseInputs(includeGeneratedReality = true) {
  const authorScript = await fileRecord(repositoryPath(release.authorScriptPath));
  const exportScript = await fileRecord(repositoryPath(release.exportScriptPath));
  assert(authorScript.sha256 === release.accepted.authorScriptSha256, `author_script_digest_mismatch:${authorScript.sha256}`);
  assert(exportScript.sha256 === release.accepted.exportScriptSha256, `export_script_digest_mismatch:${exportScript.sha256}`);
  if (includeGeneratedReality) {
    const reality = await fileRecord(repositoryPath(release.realityPath));
    assert(reality.sha256 === release.accepted.realitySha256, `reality_digest_mismatch:${reality.sha256}`);
  }
}

function exportArguments(sourceRecord, output, lightmap, bake) {
  const args = [
    "--background",
    repositoryPath(release.sourceBlendPath),
    "--python",
    repositoryPath(release.exportScriptPath),
    "--",
    "--output",
    output,
    "--lightmap",
    lightmap,
    "--reality",
    repositoryPath(release.realityPath),
    "--source-sha256",
    sourceRecord.sha256,
    "--size",
    String(release.bake.resolution),
    "--samples",
    String(release.bake.samples),
    "--scale",
    String(release.bake.scale),
    "--lightmap-intensity",
    String(release.bake.lightMapIntensity)
  ];
  if (bake) args.push("--bake");
  return args;
}

async function author(blender) {
  const blend = repositoryPath(release.sourceBlendPath);
  const reality = repositoryPath(release.realityPath);
  const review = repositoryPath(release.sourceReviewPath);
  const png = resolve(root, `build/source-review-${release.version}`);
  await prepareGeneratedPath(blend);
  await prepareGeneratedPath(reality);
  await prepareGeneratedPath(review);
  await rm(png, { recursive: true, force: true });
  await mkdir(png, { recursive: true });
  run(blender, [
    "--background",
    repositoryPath(release.historicalBlendPath),
    "--python",
    repositoryPath(release.authorScriptPath),
    "--",
    "--output-blend",
    blend,
    "--review-dir",
    png,
    "--reality",
    reality
  ], "blender_authoring_failed");
  await mkdir(review, { recursive: true });
  for (const view of release.reviewViews) {
    run("cwebp", ["-quiet", "-q", String(release.reviewImages.quality), join(png, `${view}.png`), "-o", join(review, `${view}.webp`)], `review_webp_conversion_failed:${view}`);
  }
  const blendRecord = await fileRecord(blend);
  const realityRecord = await fileRecord(reality);
  assert(blendRecord.sha256 === release.accepted.sourceBlendSha256, `authored_source_digest_mismatch:${blendRecord.sha256}`);
  assert(realityRecord.sha256 === release.accepted.realitySha256, `authored_reality_digest_mismatch:${realityRecord.sha256}`);
  process.stdout.write(`Authored ${release.sceneId}@${release.version}: ${blendRecord.sha256}\n`);
}

async function exportOnce(blender, output, lightmap, bake) {
  await assertUntrackedOutput(root, output);
  const sourceRecord = await acceptedSourceRecord();
  await mkdir(dirname(output), { recursive: true });
  await rm(output, { force: true });
  run(blender, exportArguments(sourceRecord, output, lightmap, bake), bake ? "blender_bake_failed" : "blender_export_failed");
  return fileRecord(output);
}

async function bake(blender) {
  const lightmap = repositoryPath(release.lightmapPath);
  await prepareGeneratedPath(lightmap);
  const output = resolve(root, `build/releases/${release.version}/bake/scene.glb`);
  const record = await exportOnce(blender, output, lightmap, true);
  const lightmapRecord = await fileRecord(lightmap);
  assert(lightmapRecord.sha256 === release.accepted.lightmapSha256, `accepted_lightmap_digest_mismatch:${lightmapRecord.sha256}`);
  assert(record.sha256 === release.accepted.releaseGlbSha256, `baked_glb_digest_mismatch:${record.sha256}`);
  process.stdout.write(`Baked ${release.sceneId}@${release.version}: ${record.sha256}\n`);
}

async function build(blender) {
  const lightmap = repositoryPath(release.lightmapPath);
  assert(await exists(lightmap), "accepted_lightmap_missing:run --bake first");
  const output = resolve(root, `build/releases/${release.version}/scene.glb`);
  const record = await exportOnce(blender, output, lightmap, false);
  assert(record.sha256 === release.accepted.releaseGlbSha256 && record.sizeBytes === release.accepted.releaseGlbSizeBytes, `release_glb_record_mismatch:${record.sha256}:${record.sizeBytes}`);
  const lightmapRecord = await fileRecord(lightmap);
  assert(lightmapRecord.sha256 === release.accepted.lightmapSha256, `accepted_lightmap_digest_mismatch:${lightmapRecord.sha256}`);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const materialized = manifest.releases.find(({ version }) => version === release.version);
  if (materialized) assert(materialized.files?.["scene.glb"]?.sha256 === record.sha256, `materialized_glb_digest_mismatch:${record.sha256}`);
  process.stdout.write(`Built ${release.sceneId}@${release.version}: ${record.sha256}\n`);
  return record;
}

async function twice(blender) {
  const lightmap = repositoryPath(release.lightmapPath);
  assert(await exists(lightmap), "accepted_lightmap_missing:run --bake first");
  const directory = resolve(root, `build/releases/${release.version}/reproducibility`);
  await rm(directory, { recursive: true, force: true });
  const first = await exportOnce(blender, join(directory, "run-1/scene.glb"), lightmap, false);
  const second = await exportOnce(blender, join(directory, "run-2/scene.glb"), lightmap, false);
  assert(first.sha256 === second.sha256 && first.sizeBytes === second.sizeBytes, `two_run_glb_mismatch:${first.sha256}:${second.sha256}`);
  assert(first.sha256 === release.accepted.releaseGlbSha256 && first.sizeBytes === release.accepted.releaseGlbSizeBytes, `accepted_glb_reproducibility_mismatch:${first.sha256}:${first.sizeBytes}`);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const materialized = manifest.releases.find(({ version }) => version === release.version);
  if (materialized) assert(materialized.files?.["scene.glb"]?.sha256 === first.sha256, `materialized_glb_digest_mismatch:${first.sha256}`);
  process.stdout.write(`Two-run GLB reproducibility passed: ${first.sha256} (${first.sizeBytes} bytes)\n`);
}

const blender = blenderExecutable();
await verifyBlender(blender);
await verifyReleaseInputs(mode !== "--author");
if (mode === "--author") await author(blender);
else if (mode === "--bake") await bake(blender);
else if (mode === "--twice") await twice(blender);
else await build(blender);
