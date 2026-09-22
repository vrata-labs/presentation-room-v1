import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { metadataArtifacts, validateMetadataFiles, validateMetadataRelease } from "../scripts/metadata-release.mjs";

test("metadata release preserves accepted payloads and rejects scene or byte edits", async () => {
  await validateMetadataRelease();
  const { release, files } = await metadataArtifacts();
  for (const name of ["scene.glb", "preview.webp"]) assert.equal(createHash("sha256").update(files[name]).digest("hex"), release.files[name].sha256);
  const records = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length }]));
  const build = resolve(import.meta.dirname, "../build");
  await mkdir(build, { recursive: true });
  const fixture = await mkdtemp(join(build, "metadata-release-"));
  try {
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(fixture, name), bytes);
    await validateMetadataFiles(fixture, files, records);
    const changedScene = JSON.parse(files["scene.json"]); changedScene.spawnPoints[0].position.x += 1;
    await writeFile(join(fixture, "scene.json"), JSON.stringify(changedScene));
    await assert.rejects(() => validateMetadataFiles(fixture, files, records), /metadata_release_bytes_changed:scene.json/);
    await writeFile(join(fixture, "scene.json"), files["scene.json"]);
    const changedGlb = Buffer.from(files["scene.glb"]); changedGlb[changedGlb.length-1] ^= 1;
    await writeFile(join(fixture, "scene.glb"), changedGlb);
    await assert.rejects(() => validateMetadataFiles(fixture, files, records), /metadata_release_bytes_changed:scene.glb/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
