import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertScratchOutput, assertUntrackedOutput, fileRecord, pathTrackedInGit } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "source/releases/0.4.1");
const repository = JSON.parse(await readFile(join(root, "scene-repository.json"), "utf8"));
const ledger = JSON.parse(await readFile(join(root, "provenance/releases/0.4.1/release-ledger.json"), "utf8"));
const output = join(root, "build/materialized-0.4.1");
await assertScratchOutput(root, output);
await mkdir(output, { recursive: true });
assert(process.env.BLENDER_BIN, "pinned_blender_required");
assert.equal((await fileRecord(process.env.BLENDER_BIN)).sha256, "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: "inherit" });
  assert.equal(result.status, 0, result.error?.message ?? "materialization_failed");
}
run(process.env.BLENDER_BIN, ["--background", join(source, "baked-source.blend"), "--python-exit-code", "1", "--python", join(source, "export-scene.py"), "--", "--out", join(output, "scene.raw.glb"), "--atlas", join(source, "lightmap.png")]);
run(process.execPath, [join(source, "finalize-glb.mjs"), join(output, "scene.raw.glb"), join(output, "scene.glb")]);
for (const [name, input] of Object.entries({ "scene.glb": join(output, "scene.glb"), "scene.json": join(source, "scene-manifest.json"), "LICENSES.md": join(source, "release-LICENSES.md"), "preview.webp": join(source, "preview.webp") })) {
  assert.deepEqual(await fileRecord(input), ledger.files[name], `reproduction_drift:${name}`);
  const local = `assets/scenes/${repository.sceneId}/0.4.1/${name}`;
  const target = join(root, local);
  const exists = await fileRecord(target).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  if (exists) { assert.deepEqual(exists, ledger.files[name], `immutable_release_drift:${name}`); continue; }
  assert(!pathTrackedInGit(root, local), `tracked_release_missing:${name}`);
  await assertUntrackedOutput(root, target);
  await mkdir(join(root, `assets/scenes/${repository.sceneId}/0.4.1`), { recursive: true });
  await writeFile(target, await readFile(input));
}
console.log(`Materialized and verified ${repository.sceneId}@0.4.1`);
