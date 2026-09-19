import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { assert, assertAcceptanceIndexPrefix, readJson } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const repositoryPath = "source/release-acceptance-index.json";
const baseSha = process.env.BASE;

assert(/^[0-9a-f]{40}$/.test(baseSha ?? ""), "invalid_acceptance_index_base_sha");
const listing = spawnSync("git", ["ls-tree", "--name-only", baseSha, "--", repositoryPath], { cwd: root, encoding: "utf8" });
if (listing.error || listing.status !== 0) throw new Error(`acceptance_index_base_query_failed:${listing.error?.message ?? listing.status}`);
if (listing.stdout.trim().length === 0) {
  process.stdout.write("Acceptance index has no base revision; initial append-only history is valid.\n");
} else {
  const base = spawnSync("git", ["show", `${baseSha}:${repositoryPath}`], { cwd: root, encoding: "utf8" });
  if (base.error || base.status !== 0) throw new Error(`acceptance_index_base_read_failed:${base.error?.message ?? base.status}`);
  assertAcceptanceIndexPrefix(JSON.parse(base.stdout), await readJson(join(root, repositoryPath)));
  process.stdout.write("Acceptance index preserves the exact base revision prefix.\n");
}
