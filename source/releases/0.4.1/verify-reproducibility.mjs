import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertScratchOutput } from "../../../scripts/lib.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = fileURLToPath(new URL("./", import.meta.url));
const input = resolve(root, process.argv[2] ?? "source/releases/0.4.1");
const repository = JSON.parse(await readFile(join(root, "scene-repository.json"), "utf8"));
const expected = resolve(root, process.argv[3] ?? `assets/scenes/${repository.sceneId}/0.4.1/scene.glb`);
const reportPath = resolve(root, process.argv[4] ?? "build/reproducibility-0.4.1/report.json");
const output = join(root, "build/reproducibility-0.4.1");
await assertScratchOutput(root, output);
await assertScratchOutput(root, reportPath);
await mkdir(output, { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
async function record(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { sha256: hash.digest("hex"), sizeBytes: (await stat(path)).size };
}
const blender = process.env.BLENDER_BIN;
assert(blender, "pinned_blender_required");
const binary = await record(blender);
assert.equal(binary.sha256, "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: "inherit" });
  assert.equal(result.status, 0, result.error?.message ?? "reproducibility_step_failed");
}
const expectedRecord = await record(expected);
const runs = [];
for (const index of [1, 2]) {
  const raw = join(output, `run-${index}.raw.glb`);
  const glb = join(output, `run-${index}.glb`);
  run(blender, ["--background", join(input, "baked-source.blend"), "--python-exit-code", "1", "--python", join(source, "export-scene.py"),
    "--", "--out", raw, "--atlas", join(input, "lightmap.png")]);
  run(process.execPath, [join(source, "finalize-glb.mjs"), raw, glb]);
  const result = { rawGlb: await record(raw), finalGlb: await record(glb) };
  assert.deepEqual(result.finalGlb, expectedRecord, "accepted_release_reproduction_drift");
  runs.push(result);
}
assert.deepEqual(runs[0], runs[1], "two_run_export_drift");
await writeFile(reportPath, JSON.stringify({
  sceneId: repository.sceneId, releaseVersion: "0.4.1", result: "passed", runs,
  source: await record(join(input, "baked-source.blend")), atlas: await record(join(input, "lightmap.png")),
  exporter: await record(join(source, "export-scene.py")), finalizer: await record(join(source, "finalize-glb.mjs")),
  blender: binary, expected: expectedRecord,
  scope: "Two byte-identical exports from the saved baked source; not a fresh-author or fresh-bake repeatability claim."
}, null, 2)+"\n");
console.log(`0.4.1 reproduced twice: ${expectedRecord.sha256}`);
