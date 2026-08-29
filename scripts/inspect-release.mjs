import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import sharp from "sharp";

import { fileRecord, glbInspection, readJson, run, totalBytes, writeJson } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = await readJson(join(root, "manifest.json"));
const release = manifest.releases[0];
const releasePath = join(root, release.releasePath);
const glbPath = join(releasePath, "scene.glb");
const files = {};
for (const name of ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]) {
  files[name] = await fileRecord(join(releasePath, name));
}
const preview = await sharp(join(releasePath, "preview.webp")).metadata();
const inspection = await glbInspection(glbPath);
const report = {
  sceneId: manifest.sceneId,
  version: release.version,
  status: release.status,
  humanAcceptance: release.humanAcceptance,
  publicationReady: release.publicationReady,
  bundleSizeBytes: await totalBytes(Object.keys(files).map((name) => join(releasePath, name))),
  files,
  preview: { format: preview.format, width: preview.width, height: preview.height },
  glb: {
    scenes: inspection.scenes,
    triangles: inspection.triangles,
    objects: inspection.objects,
    meshes: inspection.meshes,
    primitives: inspection.primitives,
    materials: inspection.materials,
    textures: inspection.textures,
    animations: inspection.animations
  }
};
await mkdir(join(root, "build"), { recursive: true });
await writeJson(join(root, "build/inspection.json"), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
run("pnpm", ["exec", "gltf-transform", "inspect", glbPath], { cwd: root });
