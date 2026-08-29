import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

export function assert(condition, code) {
  if (!condition) throw new Error(code);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function fileRecord(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes), sizeBytes: bytes.length };
}

export function toRuntimePosition(position) {
  return { x: position.x, y: position.y, z: -position.z };
}

function primitiveTriangles(primitive) {
  const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
  if (primitive.getMode() === 4) return Math.floor(count / 3);
  if (primitive.getMode() === 5 || primitive.getMode() === 6) return Math.max(0, count - 2);
  return 0;
}

export async function glbInspection(path) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const root = document.getRoot();
  const meshes = root.listMeshes();
  const nodes = root.listNodes();
  return {
    scenes: root.listScenes().length,
    triangles: meshes.reduce((total, mesh) => total + mesh.listPrimitives().reduce((sum, primitive) => sum + primitiveTriangles(primitive), 0), 0),
    objects: nodes.length,
    meshes: meshes.length,
    primitives: meshes.reduce((total, mesh) => total + mesh.listPrimitives().length, 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    nodeNames: nodes.map((node) => node.getName()).filter(Boolean).sort()
  };
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`command_failed:${command}:${result.status}`);
}

export function resolveBlenderExecutable(environment = process.env) {
  return environment.BLENDER_BIN?.trim() || "blender";
}

export function verifyBlender(blender) {
  const result = spawnSync(blender, ["--version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    throw new Error(`Blender executable '${blender}' was not found. Set BLENDER_BIN to a Blender executable or install 'blender' on PATH.`);
  }
  if (result.error) throw new Error(`Unable to run Blender executable '${blender}': ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Blender executable '${blender}' failed while reading its version (exit ${result.status}).`);
  if (!result.stdout.includes("Blender 4.5.12 LTS") || !result.stdout.includes("build hash: 84afd5f785f7")) {
    throw new Error(`Blender executable '${blender}' must be Blender 4.5.12 LTS build 84afd5f785f7.`);
  }
}

export async function totalBytes(paths) {
  const records = await Promise.all(paths.map((path) => stat(path)));
  return records.reduce((total, record) => total + record.size, 0);
}
