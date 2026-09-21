import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertScratchOutput } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const commit = "92a6b567aeefbaee9e49007125ff84ff9ea7cd44";
const directory = join(root, "build", "historical-0.4.0-contract");
await assertScratchOutput(root, directory);
const commands = process.argv.slice(2);
assert(commands.length && commands.every(value => ["test", "validate", "validate:visual", "verify:reproducibility", "inspect"].includes(value)), "unsupported_historical_check");
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, env: process.env, ...(capture ? { encoding: "utf8" } : { stdio: "inherit" }) });
  assert.equal(result.status, 0, result.error?.message ?? `${command}_failed`);
  return result.stdout;
}
if (spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root, stdio: "ignore" }).status !== 0) run("git", ["fetch", "--no-tags", "--depth=1", "origin", commit]);
if (!await access(join(directory, ".git")).then(() => true, () => false)) run("git", ["worktree", "add", "--detach", directory, commit]);
assert.equal(run("git", ["rev-parse", "HEAD"], directory, true).trim(), commit);
run("git", ["diff", "HEAD", "--exit-code"], directory);
if (!await access(join(directory, "node_modules")).then(() => true, () => false)) run("pnpm", ["install", "--frozen-lockfile"], directory);
for (const command of commands) run("pnpm", [command], directory);
