import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, unlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import validator from "gltf-validator";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const input = resolve(root, process.argv[2]);
const output = resolve(root, process.argv[3]);
const intermediate = `${output}.tangents.glb`;
const prepared = `${output}.prepared.glb`;
assert.notEqual(input, output);
for (const path of [output, intermediate, prepared]) {
  const local = relative(root, path);
  assert(local.startsWith(`build${sep}`), "output_must_be_build_artifact");
  let current = root;
  for (const part of local.split(sep)) {
    current = resolve(current, part);
    const stat = await lstat(current).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    assert(!stat?.isSymbolicLink(), "output_symlink");
  }
  const tracked = spawnSync("git", ["ls-files", "--", local], { cwd: root, encoding: "utf8" });
  assert.equal(tracked.status, 0);
  assert.equal(tracked.stdout.trim(), "", "tracked_output");
}
const run = spawnSync("pnpm", ["exec", "gltf-transform", "tangents", input, intermediate], { cwd: root, stdio: "inherit" });
assert.equal(run.status, 0, "tangent_generation_failed");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(intermediate);
const removed = new Set();
for (const mesh of document.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    if (!primitive.getMaterial()?.getNormalTexture() && primitive.getAttribute("TANGENT")) {
      removed.add(primitive.getAttribute("TANGENT"));
      primitive.setAttribute("TANGENT", null);
    }
  }
}
for (const accessor of removed) {
  if (accessor.listParents().every(parent => parent.propertyType === "Root")) accessor.dispose();
}
await io.write(prepared, document);
const compress = spawnSync("pnpm", ["exec", "gltf-transform", "meshopt", prepared, output], { cwd: root, stdio: "inherit" });
assert.equal(compress.status, 0, "meshopt_compression_failed");
const final = await readFile(output);
const report = await validator.validateBytes(final, { maxIssues: 100000 });
assert.equal(report.issues.numErrors, 0, "gltf_errors");
assert.equal(report.issues.numWarnings, 0, "gltf_warnings");
await Promise.all([unlink(intermediate), unlink(prepared)]);
console.log(JSON.stringify({ bytes: final.length, sha256: createHash("sha256").update(final).digest("hex"), errors: report.issues.numErrors, warnings: report.issues.numWarnings }));
