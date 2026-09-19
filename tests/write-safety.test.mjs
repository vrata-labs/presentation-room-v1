import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertGitAcceptanceIndexPrefix, assertScratchOutput, assertUntrackedOutput } from "../scripts/lib.mjs";

const root = resolve(import.meta.dirname, "..");

test("write guards reject missing tracked files, symlinks and unavailable Git before writing", async () => {
  await mkdir(join(root, "build"), { recursive: true });
  const temporary = await mkdtemp(join(root, "build/write-safety-"));
  const fixture = join(temporary, "repository");
  function git(args) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  function python(path, expected, scratch = false) {
    const result = spawnSync("python3", ["-B", "-c", "import runpy, sys; runpy.run_path(sys.argv[1])['assert_output'](sys.argv[2], root=sys.argv[3], scratch=sys.argv[4]=='true')",
      join(root, "source/write_safety.py"), path, fixture, String(scratch)], { encoding: "utf8" });
    if (expected) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
    } else assert.equal(result.status, 0, result.stderr);
  }
  try {
    git(["clone", "--shared", "--no-checkout", root, fixture]);
    git(["-C", fixture, "read-tree", "HEAD"]);
    await assert.rejects(assertUntrackedOutput(fixture, "README.md"), /tracked_output_forbidden/);
    const pinned = join(fixture, "source/releases/0.3.0/pinned.png");
    await mkdir(join(fixture, "source/releases/0.3.0"), { recursive: true });
    await writeFile(pinned, "accepted");
    git(["-C", fixture, "add", "source/releases/0.3.0/pinned.png"]);
    await rm(pinned);
    await assert.rejects(assertUntrackedOutput(fixture, pinned), /tracked_output_forbidden/);
    python(pinned, /tracked_output_forbidden/);
    await mkdir(join(fixture, "build"), { recursive: true });
    const fresh = join(fixture, "build/new/report.json");
    await assertScratchOutput(fixture, fresh);
    python(fresh, null, true);
    await assert.rejects(assertScratchOutput(fixture, "provenance/generation-ledger.json"), /report_output_must_be_under_build/);
    python(join(fixture, "assets/scenes/scene/0.2.0/scene.glb"), /output_path_forbidden/, true);
    await symlink(join(fixture, "source"), join(fixture, "build/redirect"));
    await assert.rejects(assertScratchOutput(fixture, "build/redirect/output.json"), /output_symlink_forbidden/);
    python(join(fixture, "build/redirect/output.json"), /output_symlink_forbidden/, true);
    const indexPath = "source/release-acceptance-index.json";
    const base = JSON.parse(await readFile(join(root, indexPath), "utf8"));
    await writeFile(join(fixture, indexPath), JSON.stringify(base));
    git(["-C", fixture, "add", indexPath]);
    await rm(join(fixture, indexPath));
    assert.doesNotThrow(() => assertGitAcceptanceIndexPrefix(fixture, indexPath, {
      ...base, releases: [...base.releases, { version: "0.4.0", lockSha256: "next" }]
    }));
    assert.throws(() => assertGitAcceptanceIndexPrefix(fixture, indexPath, { ...base, releases: [] }), /acceptance_index_history_deleted/);
    git(["-C", fixture, "symbolic-ref", "HEAD", "refs/heads/missing"]);
    await assert.rejects(assertUntrackedOutput(fixture, "build/new.json"), /git_head_path_query_failed/);
    python(join(fixture, "build/new.json"), /git_head_output_query_failed/, true);
    assert.throws(() => assertGitAcceptanceIndexPrefix(fixture, indexPath, base), /acceptance_index_git_query_failed/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
