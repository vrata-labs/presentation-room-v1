import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

export function assert(condition, code) {
  if (!condition) throw new Error(code);
}

export function pathTrackedInGit(root, repositoryPath) {
  assert(typeof repositoryPath === "string" && repositoryPath.length > 0
    && !repositoryPath.startsWith("/") && !repositoryPath.includes("..") && !repositoryPath.includes("\\"), "invalid_git_repository_path");
  const head = spawnSync("git", ["ls-tree", "--name-only", "HEAD", "--", repositoryPath], { cwd: root, encoding: "utf8" });
  if (head.error || head.status !== 0) throw new Error(`git_head_path_query_failed:${head.error?.message ?? head.status}`);
  const index = spawnSync("git", ["ls-files", "--error-unmatch", "--", repositoryPath], { cwd: root, encoding: "utf8" });
  if (index.error || ![0, 1].includes(index.status)) throw new Error(`git_index_path_query_failed:${index.error?.message ?? index.status}`);
  return head.stdout.trim().length > 0 || index.status === 0;
}

export async function assertUntrackedOutput(root, path) {
  const repositoryPath = relative(root, resolve(root, path));
  assert(repositoryPath && !isAbsolute(repositoryPath) && !repositoryPath.split(sep).includes("..")
    && repositoryPath.split(sep)[0] !== ".git", "invalid_output_path");
  let current = root;
  for (const part of repositoryPath.split(sep)) {
    current = join(current, part);
    const entry = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert(!entry?.isSymbolicLink(), "output_symlink_forbidden");
  }
  assert(!pathTrackedInGit(root, repositoryPath.split(sep).join("/")), `tracked_output_forbidden:${repositoryPath}`);
}

export async function assertScratchOutput(root, path) {
  const repositoryPath = relative(root, resolve(root, path));
  assert(repositoryPath.startsWith(`build${sep}`), "report_output_must_be_under_build");
  await assertUntrackedOutput(root, path);
}

export function acceptanceIndexEntryRecord(index, version) {
  const records = index.releases.filter((record) => record.version === version);
  assert(records.length === 1, `acceptance_index_entry_missing_or_duplicate:${version}`);
  return { version, entrySha256: sha256(JSON.stringify(records[0])) };
}

export function assertGitAcceptanceIndexPrefix(root, repositoryPath, current) {
  for (const revision of ["HEAD", "index"]) {
    const listing = spawnSync("git", revision === "HEAD"
      ? ["ls-tree", "--name-only", "HEAD", "--", repositoryPath]
      : ["ls-files", "--", repositoryPath], { cwd: root, encoding: "utf8" });
    if (listing.error || listing.status !== 0) throw new Error(`acceptance_index_git_query_failed:${revision}`);
    if (!listing.stdout.trim()) continue;
    const base = spawnSync("git", ["show", `${revision === "HEAD" ? "HEAD" : ""}:${repositoryPath}`], { cwd: root, encoding: "utf8" });
    if (base.error || base.status !== 0) throw new Error(`acceptance_index_git_read_failed:${revision}`);
    assertAcceptanceIndexPrefix(JSON.parse(base.stdout), current);
  }
}

async function pythonToolingPaths(directory, prefix) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "__pycache__") continue;
    const repositoryPath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await pythonToolingPaths(join(directory, entry.name), repositoryPath));
    else if (entry.isFile() && entry.name.endsWith(".py")) paths.push(repositoryPath);
  }
  return paths;
}

export async function repositoryToolingPaths(root) {
  const [scripts, tests, sourcePython] = await Promise.all([
    readdir(join(root, "scripts"), { withFileTypes: true }),
    readdir(join(root, "tests"), { withFileTypes: true }),
    pythonToolingPaths(join(root, "source"), "source")
  ]);
  return [
    ".github/workflows/validate.yml",
    "package.json",
    "platform-validator.lock",
    "pnpm-lock.yaml",
    ...scripts.filter((entry) => entry.isFile() && entry.name.endsWith(".mjs")).map((entry) => `scripts/${entry.name}`),
    ...tests.filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs")).map((entry) => `tests/${entry.name}`),
    ...sourcePython
  ].sort();
}

export function assertAcceptanceIndexPrefix(base, current) {
  assert(base?.schemaVersion === current?.schemaVersion && base?.sceneId === current?.sceneId
    && Array.isArray(base?.releases) && Array.isArray(current?.releases), "acceptance_index_identity_changed");
  assert(current.releases.length >= base.releases.length, "acceptance_index_history_deleted");
  for (let index = 0; index < base.releases.length; index += 1) {
    assert(JSON.stringify(current.releases[index]) === JSON.stringify(base.releases[index]), `acceptance_index_history_changed:${index}`);
  }
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

export function createMetadataSceneManifest(baseScene, release) {
  return {
    ...baseScene,
    version: release.version,
    isCurrent: release.isCurrent,
    publicationReady: release.publicationReady,
    renderProfile: release.renderProfile,
    spawnPoints: baseScene.spawnPoints.map((spawn) => spawn.id === release.runtimeSpawn.id
      ? {
          ...spawn,
          position: release.runtimeSpawn.position,
          yaw: release.runtimeSpawn.yaw
        }
      : spawn)
  };
}

export async function materializeMetadataRelease(basePath, outputPath, release) {
  const baseScene = await readJson(join(basePath, "scene.json"));
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(outputPath, { recursive: true });
  for (const name of release.unchangedFiles) {
    await copyFile(join(basePath, name), join(outputPath, name));
  }
  await writeJson(join(outputPath, "scene.json"), createMetadataSceneManifest(baseScene, release));
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
