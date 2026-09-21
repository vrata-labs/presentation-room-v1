import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import validator from "gltf-validator";
import { assertScratchOutput } from "../../../scripts/lib.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const input = resolve(root, process.argv[2]);
const output = resolve(root, process.argv[3]);
const intermediate = `${output}.tangents.glb`;
assert.notEqual(input, output);
await assertScratchOutput(root, output);
await assertScratchOutput(root, intermediate);
assert.equal(spawnSync("pnpm", ["exec", "gltf-transform", "tangents", input, intermediate], { cwd: root, stdio: "inherit" }).status, 0);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const document = await io.read(intermediate);
for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
  if (!primitive.getMaterial()?.getNormalTexture()) primitive.setAttribute("TANGENT", null);
}
for (const accessor of [...document.getRoot().listAccessors()]) {
  if (accessor.listParents().every(parent => parent.propertyType === "Root")) accessor.dispose();
}
const geometry = (doc) => doc.getRoot().listMeshes().map(mesh => mesh.listPrimitives().map(primitive =>
  Object.fromEntries(primitive.listSemantics().map(name => {
    const array = primitive.getAttribute(name).getArray();
    return [name, Buffer.from(array.buffer, array.byteOffset, array.byteLength)];
  }))
));
const before = geometry(document);
// No lossy per-mesh grid: retain shared construction boundaries and atlas UVs.
document.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, document);
assert.deepEqual(geometry(await io.read(output)), before, "lossless_geometry_roundtrip_failed");
const bytes = await readFile(output);
const report = await validator.validateBytes(bytes, { maxIssues: 100000 });
assert.equal(report.issues.numErrors, 0, "gltf_errors");
assert.equal(report.issues.numWarnings, 0, "gltf_warnings");
await unlink(intermediate);
console.log(JSON.stringify({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), losslessGeometry: true, errors: 0, warnings: 0 }));
