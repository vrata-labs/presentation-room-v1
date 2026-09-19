import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { assert, fileRecord, readJson } from "./lib.mjs";
import { root } from "./release-0.3-lib.mjs";
import { release030 as release } from "./release-0.3-config.mjs";

function run(script, args = []) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`reproducibility_command_failed:${script}:${result.error?.message ?? result.status}`);
}

run("scripts/verify-review-reproducibility.mjs");
run("scripts/build-release.mjs", ["--twice"]);

const [manifest, lock, built] = await Promise.all([
  readJson(join(root, "manifest.json")),
  readJson(join(root, release.acceptanceLockPath)),
  fileRecord(join(root, `build/releases/${release.version}/reproducibility/run-1/scene.glb`))
]);
const materialized = manifest.releases.find(({ version }) => version === release.version);
assert(materialized?.reproducibility?.result === "byte-identical-glb" && materialized.reproducibility.runs === 2, "materialized_reproducibility_evidence_missing");
assert(built.sha256 === release.accepted.releaseGlbSha256 && built.sizeBytes === release.accepted.releaseGlbSizeBytes, "rebuilt_release_record_mismatch");
assert(built.sha256 === materialized.files["scene.glb"].sha256 && built.sha256 === lock.release.glbSha256, "reproducibility_evidence_digest_mismatch");
process.stdout.write(`Historical releases and ${release.version} reproduced successfully; ${release.version} sha256=${built.sha256}.\n`);
