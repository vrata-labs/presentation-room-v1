import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("actual CI immutability gate distinguishes absent paths from failed Git queries", async () => {
  const workflow = await readFile(join(root, ".github/workflows/validate.yml"), "utf8");
  const step = workflow.split(/      - name: Reject changes to[^\n]*\n/)[1]?.split(/\n      - name:/)[0];
  assert.ok(step, "immutability step missing");
  const script = step.split("        run: |\n")[1]?.replace(/^          /gm, "");
  assert.ok(script, "immutability script missing");
  await mkdir(join(root, "build"), { recursive: true });
  const temporary = await mkdtemp(join(root, "build/immutability-test-"));
  try {
    for (const changedPath of [
      "assets/scenes/scene/0.2.0/scene.glb",
      "provenance/generation-ledger.json",
      "provenance/asset-ledger.json",
      "provenance/rights-status.json",
      "source/review-candidate.blend",
      "source/scene-contract.json"
    ]) for (const [scenario, expectedStatus, expectedError] of [
      ["missing", 0, null],
      ["existing", 1, /immutable/],
      ["query-failure", 1, /immutable_baseline_query_failed/],
      ["diff-failure", 1, /immutable_diff_failed/]
    ]) {
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", `
        git() {
          case "$1" in
            fetch) return 0 ;;
            diff)
              [[ "$SCENARIO" != "diff-failure" ]] || return 128
              printf '%s\\n' "$CHANGED_PATH"
              ;;
            ls-tree)
              [[ "$SCENARIO" != "query-failure" ]] || return 128
              if [[ "$SCENARIO" == "existing" ]]; then
                printf '%s\\n' 'assets/scenes/scene/0.2.0'
              fi
              ;;
            cat-file) return 128 ;;
            *) return 99 ;;
          esac
        }
        node() { printf '%s\\n' 'acceptance_index_gate_reached'; }
        ${script}
      `], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, BASE_SHA: "a".repeat(40), RUNNER_TEMP: temporary, SCENARIO: scenario, CHANGED_PATH: changedPath }
      });
      assert.ifError(result.error);
      assert.equal(result.status, expectedStatus, `${scenario}: ${result.stderr}`);
      if (expectedError) {
        assert.match(result.stderr, expectedError, scenario);
        assert.doesNotMatch(result.stdout, /acceptance_index_gate_reached/, scenario);
      } else {
        assert.match(result.stdout, /acceptance_index_gate_reached/, scenario);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
