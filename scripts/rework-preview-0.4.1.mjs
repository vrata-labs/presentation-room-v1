import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN;
if (!blender || createHash("sha256").update(await readFile(blender)).digest("hex") !== "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880") throw new Error("pinned_blender_required");
const out = resolve(root, process.argv[2] ?? "build/rework-0.4.1");
if (!relative(root, out).startsWith("build/")) throw new Error("scratch_output_required");
await mkdir(out, { recursive: true });
const source = join(root, "source/releases/0.4.1");
const legacy = join(root, "source/releases/0.4.0");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`preview_step_failed:${result.error?.message ?? result.status}`);
}
function python(script, args, blend) {
  run(blender, ["--background", ...(blend ? [blend] : []), "--python-exit-code", "1", "--python", script, "--", ...args]);
}
python(join(source, "author-scene.py"), ["--out", out, "--views", "chair-detail,diagonal-overview"]);
python(join(legacy, "measure-support-contacts.py"), ["--registry", join(out, "object-registry.json"), "--out", join(out, "support-measurements.json")], join(out, "draft-scene.blend"));
python(join(legacy, "measure-geometry.py"), ["--registry", join(out, "object-registry.json"), "--out", join(out, "geometry-measurements.json")], join(out, "draft-scene.blend"));
python(join(source, "export-scene.py"), ["--out", join(out, "raw.glb"), "--atlas", join(out, "lightmap-raw.png"), "--bake", "--save-source", join(out, "baked-source.blend")], join(out, "draft-scene.blend"));
python(join(legacy, "denoise-atlas.py"), ["--input", join(out, "lightmap-raw.png"), "--out", join(out, "lightmap.png")]);
python(join(source, "export-scene.py"), ["--out", join(out, "scene.raw.glb"), "--atlas", join(out, "lightmap.png")], join(out, "baked-source.blend"));
run(process.execPath, [join(source, "finalize-glb.mjs"), join(out, "scene.raw.glb"), join(out, "scene.glb")]);
