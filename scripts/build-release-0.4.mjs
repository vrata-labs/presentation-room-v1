import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { assert, assertScratchOutput, fileRecord, resolveBlenderExecutable, run, verifyBlender } from "./lib.mjs";
import { root } from "./release-0.4-lib.mjs";
import { release040 as release } from "./release-0.4-config.mjs";

const twice = process.argv.includes("--twice");
assert(process.argv.slice(2).every((argument) => argument === "--twice"), "unknown_build_argument");
const blender = resolveBlenderExecutable();
verifyBlender(blender);
assert((await fileRecord(blender)).sha256 === release.blender.binarySha256, "blender_binary_digest_mismatch");

const directory = join(root, `build/releases/${release.version}/reproducibility`);
await mkdir(directory, { recursive: true });
const runs = twice ? ["run-1", "run-2"] : ["run-1"];
const records = [];
for (const id of runs) {
  const raw = join(directory, `${id}.raw.glb`);
  const output = join(directory, `${id}.glb`);
  await assertScratchOutput(root, raw);
  await assertScratchOutput(root, output);
  run(blender, [
    "--background", join(root, release.sourcePath, release.sourceArtifacts.bakedSource.target),
    "--python", join(root, release.sourcePath, "export-scene.py"), "--",
    "--out", raw,
    "--atlas", join(root, release.sourcePath, release.sourceArtifacts.exportLightmap.target),
    "--intensity", String(release.bake.lightMapIntensity)
  ], { cwd: root });
  const rawRecord = await fileRecord(raw);
  assert(rawRecord.sha256 === release.sourceArtifacts.rawGlb.sha256 && rawRecord.sizeBytes === release.sourceArtifacts.rawGlb.sizeBytes, `raw_rebuild_mismatch:${id}`);
  run(process.execPath, [join(root, release.sourcePath, "finalize-glb.mjs"), raw, output], { cwd: root });
  const finalRecord = await fileRecord(output);
  assert(JSON.stringify(finalRecord) === JSON.stringify(release.finalGlb), `final_rebuild_mismatch:${id}`);
  records.push({ id, raw: rawRecord, final: finalRecord });
}
if (twice) assert(JSON.stringify(records[0]) === JSON.stringify({ ...records[1], id: "run-1" }), "two_run_reproducibility_mismatch");
process.stdout.write(`${release.sceneId}@${release.version} reproduced ${runs.length} time(s); sha256=${release.finalGlb.sha256}.\n`);
