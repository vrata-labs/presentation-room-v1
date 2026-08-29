import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assert, readJson, resolveBlenderExecutable, run, sha256, verifyBlender } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = resolveBlenderExecutable();
const manifest = await readJson(join(root, "manifest.json"));
const expected = manifest.releases[0].files["scene.glb"].sha256;
const output = join(root, "build/reproducibility");
const first = join(output, "first.glb");
const second = join(output, "second.glb");

verifyBlender(blender);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of [first, second]) {
  run(blender, [
    "--background",
    join(root, "source/review-candidate.blend"),
    "--python",
    join(root, "source/export_scene.py"),
    "--",
    "--output",
    path
  ]);
}

const [firstBytes, secondBytes] = await Promise.all([readFile(first), readFile(second)]);
const digest = sha256(firstBytes);
assert(firstBytes.equals(secondBytes), "same_host_two_run_glb_not_byte_identical");
assert(digest === expected, `reproducible_glb_differs_from_release:${digest}:${expected}`);
process.stdout.write(`Reproducibility passed: two byte-identical exports sha256=${digest}\n`);
