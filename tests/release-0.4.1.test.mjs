import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
test("0.4.1 validator accepts the release and rejects corrupt or re-bound failed evidence", async t => {
  await mkdir(join(root, "build"), { recursive: true });
  const fixture = await mkdtemp(join(root, "build/release-validation-"));
  const gitDir = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: root, encoding: "utf8" });
  assert.equal(gitDir.status, 0);
  try {
    for (const path of ["assets", "source", "provenance", "manifest.json", "scene-repository.json", "package.json", "platform-validator.lock"]) {
      await cp(join(root, path), join(fixture, path), { recursive: true });
    }
    await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
    const run = () => spawnSync(process.execPath, ["source/releases/0.4.1/validate-review.mjs"], {
      cwd: fixture, encoding: "utf8", timeout: 120000,
      env: { ...process.env, GIT_DIR: gitDir.stdout.trim(), GIT_WORK_TREE: fixture }
    });
    const baseline = run();
    assert.equal(baseline.status, 0, baseline.stderr);
    const originals = new Map();
    const json = async path => JSON.parse(await readFile(join(fixture, path), "utf8"));
    async function save(path, bytes) {
      if (!originals.has(path)) originals.set(path, await readFile(join(fixture, path)));
      await writeFile(join(fixture, path), bytes);
    }
    async function change(path, mutate) {
      const value = await json(path); mutate(value); await save(path, JSON.stringify(value, null, 2)+"\n");
    }
    async function digest(path) {
      const bytes = await readFile(join(fixture, path));
      return { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
    }
    async function rebind(path) {
      const updated = await digest(path);
      const ledgerPath = "provenance/releases/0.4.1/release-ledger.json";
      await change(ledgerPath, value => Object.assign(value.evidenceFiles.find(item => item.path === path), updated));
      const ledger = await digest(ledgerPath);
      await change("source/release-acceptance-index.json", value => { value.releases.at(-1).releaseLedgerSha256 = ledger.sha256; });
      await change("manifest.json", value => { value.releases.at(-1).releaseLedgerSha256 = ledger.sha256; });
    }
    const sceneId = (await json("scene-repository.json")).sceneId;
    const geometry = "provenance/releases/0.4.1/geometry-measurements.json";
    const normal = "provenance/runtime-capture-0.4.1/normal-product/normal-product-evidence.json";
    const runs = "provenance/releases/0.4.1/local-run-results.json";
    const cases = [
      ["promotion without human acceptance", async () => change("manifest.json", value => { value.releases.at(-1).isCurrent = true; }), /current_release_not_authorized/],
      ["rewritten historical bytes", async () => { const path = `assets/scenes/${sceneId}/0.4.0/scene.json`; await save(path, (await readFile(join(fixture, path), "utf8"))+"\n"); }, /historical_source_or_artifact_bytes_changed/],
      ["corrupt capture image", async () => save("provenance/runtime-capture-0.4.1/clean/entry.png", Buffer.from("corrupt")), /record_drift/],
      ["failed geometry with updated hashes", async () => { await change(geometry, value => { value.screenVisibility.rays[0].clear = false; }); await rebind(geometry); }, /screen_visibility_failed/],
      ["unacknowledged release with updated hashes", async () => { await change(normal, value => { value.seats[0].authoritativeClaimAndRelease = false; }); await rebind(normal); }, /authoritative_seat_release_failed/],
      ["wrong runner binding with updated hashes", async () => { await change(runs, value => { value.runs[0].captureBinding.glbSha256 = "0".repeat(64); }); await rebind(runs); }, /runner_capture_binding/]
    ];
    for (const [name, mutate, error] of cases) await t.test(name, async () => {
      try {
        await mutate();
        const result = run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, error);
      } finally {
        for (const [path, bytes] of originals) await writeFile(join(fixture, path), bytes);
        originals.clear();
      }
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
