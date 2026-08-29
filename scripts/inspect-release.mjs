import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import sharp from "sharp";

import { fileRecord, glbInspection, readJson, run, totalBytes, writeJson } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = await readJson(join(root, "manifest.json"));
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
const releases = [];

for (const release of manifest.releases) {
  const releasePath = join(root, release.releasePath);
  const glbPath = join(releasePath, "scene.glb");
  const files = {};
  for (const name of requiredReleaseFiles) {
    files[name] = await fileRecord(join(releasePath, name));
  }
  const preview = await sharp(join(releasePath, "preview.webp")).metadata();
  const inspection = await glbInspection(glbPath);
  releases.push({
    version: release.version,
    status: release.status,
    humanAcceptance: release.humanAcceptance,
    isCurrent: release.isCurrent,
    publicationReady: release.publicationReady,
    renderMode: release.renderMode,
    ...(release.renderProfile ? { renderProfile: release.renderProfile } : {}),
    bundleSizeBytes: await totalBytes(requiredReleaseFiles.map((name) => join(releasePath, name))),
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
  });
}

const report = { sceneId: manifest.sceneId, releases };
await mkdir(join(root, "build"), { recursive: true });
await writeJson(join(root, "build/inspection.json"), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
for (const release of manifest.releases) {
  run("pnpm", ["exec", "gltf-transform", "inspect", join(root, release.releasePath, "scene.glb")], { cwd: root });
}
