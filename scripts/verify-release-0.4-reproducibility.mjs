import { join } from "node:path";

import { assert, fileRecord, readJson, run } from "./lib.mjs";
import { root } from "./release-0.4-lib.mjs";
import { release040 as release } from "./release-0.4-config.mjs";

run(process.execPath, [join(root, "scripts/build-release-0.4.mjs"), "--twice"], { cwd: root, env: process.env });
const [first, second, manifest, lock] = await Promise.all([
  fileRecord(join(root, `build/releases/${release.version}/reproducibility/run-1.glb`)),
  fileRecord(join(root, `build/releases/${release.version}/reproducibility/run-2.glb`)),
  readJson(join(root, "manifest.json")),
  readJson(join(root, release.acceptanceLockPath))
]);
assert(JSON.stringify(first) === JSON.stringify(second) && JSON.stringify(first) === JSON.stringify(release.finalGlb), "reproducibility_output_mismatch");
const materialized = manifest.releases.find(({ version }) => version === release.version);
assert(materialized.files["scene.glb"].sha256 === first.sha256 && lock.release.glbSha256 === first.sha256, "reproducibility_materialization_binding_mismatch");
process.stdout.write(`Verified two byte-identical ${release.version} exports and deterministic finalization: ${first.sha256}.\n`);
