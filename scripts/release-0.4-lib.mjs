import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import validator from "gltf-validator";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

import { assert, fileRecord, readJson } from "./lib.mjs";
import { release040 as release } from "./release-0.4-config.mjs";

export const root = resolve(import.meta.dirname, "..");
export const requiredReleaseFiles = Object.freeze(["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]);
export const cleanEvidenceFiles = Object.freeze([
  ...release.reviewViews.map((id) => `${id}.png`),
  "clean-spawn.png",
  "capture-settings.json",
  "scene-debug.json"
]);
export const normalEvidenceFiles = Object.freeze([
  "normal-spawn.png",
  ...Array.from({ length: 8 }, (_, index) => `normal-seat-${String(index + 1).padStart(2, "0")}.png`),
  "normal-media.png",
  "normal-product-evidence.json"
]);
export const requiredMeshTags = Object.freeze([
  "vrataObjectId",
  "vrataPartId",
  "vrataInteractionStatus",
  "vrataBakePolicy",
  "vrataCollisionPolicy",
  "vrataSupportPolicy",
  "vrataNavigableBoundsPolicy",
  "vrataAssetOrigin",
  "vrataAuthoringRelease"
]);

export function glbJson(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 20, "invalid_glb_header");
  assert(bytes.subarray(0, 4).toString("ascii") === "glTF", "invalid_glb_magic");
  assert(bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, "invalid_glb_version_or_length");
  const length = bytes.readUInt32LE(12);
  assert(bytes.subarray(16, 20).toString("ascii") === "JSON", "glb_json_chunk_missing");
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8").replace(/[\u0000\u0020\t\r\n]+$/u, ""));
}

function primitiveTriangles(primitive) {
  const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
  if (primitive.getMode() === 4) return Math.floor(count / 3);
  if (primitive.getMode() === 5 || primitive.getMode() === 6) return Math.max(0, count - 2);
  return 0;
}

export async function inspectGlb(path) {
  const document = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
    .read(path);
  const gltfRoot = document.getRoot();
  const meshes = gltfRoot.listMeshes();
  return {
    document,
    stats: {
      triangles: meshes.reduce((total, mesh) => total + mesh.listPrimitives().reduce((sum, primitive) => sum + primitiveTriangles(primitive), 0), 0),
      objects: gltfRoot.listNodes().length,
      meshes: meshes.length,
      primitives: meshes.reduce((total, mesh) => total + mesh.listPrimitives().length, 0),
      materials: gltfRoot.listMaterials().length,
      textures: gltfRoot.listTextures().length,
      animations: gltfRoot.listAnimations().length
    }
  };
}

function registryParts(registry) {
  return registry.objects.flatMap((object) => object.parts.map((name) => ({ name, objectId: object.objectId })));
}

export async function validateCandidate(glbPath, registryPath = join(root, release.sourcePath, "object-registry.json")) {
  const [bytes, record, registry, inspection] = await Promise.all([
    readFile(glbPath),
    fileRecord(glbPath),
    readJson(registryPath),
    inspectGlb(glbPath)
  ]);
  assert(record.sha256 === release.finalGlb.sha256 && record.sizeBytes === release.finalGlb.sizeBytes, "release_glb_digest_mismatch");
  assert(JSON.stringify(inspection.stats) === JSON.stringify(release.stats), "release_glb_stats_mismatch");
  assert(registry.sceneId === release.sceneId && registry.releaseVersion === release.version && registry.qualityOutcome === release.qualityOutcome, "object_registry_identity_mismatch");
  const parts = registryParts(registry);
  assert(parts.length === 225 && new Set(parts.map(({ name }) => name)).size === 225, "object_registry_part_set_invalid");
  const partMap = new Map(parts.map((part) => [part.name, part]));
  const json = glbJson(bytes);
  const meshNodes = (json.nodes ?? []).filter((node) => Number.isInteger(node.mesh));
  assert(meshNodes.length === 225, "glb_mesh_node_count_mismatch");
  assert(JSON.stringify(meshNodes.map(({ name }) => name).sort()) === JSON.stringify([...partMap.keys()].sort()), "glb_registry_inventory_mismatch");
  for (const node of meshNodes) {
    const expected = partMap.get(node.name);
    for (const tag of requiredMeshTags) assert(Object.hasOwn(node.extras ?? {}, tag), `glb_mesh_tag_missing:${node.name}:${tag}`);
    assert(node.extras.vrataObjectId === expected.objectId, `glb_object_id_mismatch:${node.name}`);
    assert(`${node.extras.vrataObjectId}.${node.extras.vrataPartId}` === node.name, `glb_part_id_mismatch:${node.name}`);
    assert(node.extras.vrataAssetOrigin === "project-authored" && node.extras.vrataAuthoringRelease === release.version, `glb_origin_mismatch:${node.name}`);
  }
  assert(JSON.stringify(json.extensionsRequired) === JSON.stringify(["EXT_meshopt_compression", "KHR_mesh_quantization"]), "glb_required_extensions_mismatch");
  assert((json.cameras ?? []).length === 0 && (json.animations ?? []).length === 0, "glb_camera_or_animation_exported");
  assert(!(json.extensionsUsed ?? []).includes("KHR_lights_punctual"), "glb_light_exported");
  assert((json.materials ?? []).every((material) => material.extras?.vrataLightMap === true
    && material.extras?.vrataRenderProfile === release.renderProfile
    && material.extras?.vrataLightMapIncludesEnvironment === true
    && material.emissiveTexture?.texCoord === 1), "glb_lightmap_contract_mismatch");
  const sceneExtras = json.scenes?.[json.scene ?? 0]?.extras ?? {};
  assert(sceneExtras.sceneId === release.sceneId && sceneExtras.releaseVersion === release.version && sceneExtras.qualityOutcome === release.qualityOutcome, "glb_scene_identity_mismatch");
  const report = await validator.validateBytes(new Uint8Array(bytes), { uri: `${release.sceneId}@${release.version}/scene.glb`, maxIssues: 100000 });
  assert(report.issues.numErrors === 0 && report.issues.numWarnings === 0, `khronos_validation_failed:${report.issues.numErrors}:${report.issues.numWarnings}`);
  return {
    stats: inspection.stats,
    khronos: { errors: report.issues.numErrors, warnings: report.issues.numWarnings, infos: report.issues.numInfos, hints: report.issues.numHints },
    budget: release.budget,
    record
  };
}

export async function validateMeasurements(basePath = release.sourcePath) {
  const directory = resolve(root, basePath);
  const [registry, geometry, supports] = await Promise.all([
    readJson(join(directory, "object-registry.json")),
    readJson(join(directory, "geometry-measurements.json")),
    readJson(join(directory, "declared-supports.json"))
  ]);
  assert(registry.qualityOutcome === release.qualityOutcome, "measurement_quality_outcome_mismatch");
  assert(geometry.sourceBlendSha256 === release.sourceArtifacts.authoredBlend.sha256 && geometry.registrySha256 === release.sourceArtifacts.objectRegistry.sha256, "geometry_measurement_binding_mismatch");
  assert(geometry.shippingMeshParts === 225 && geometry.physicalConstituentParts === 385, "geometry_part_count_mismatch");
  assert(geometry.xrMeshBudget.passed === true && geometry.screenVisibility.allClear === true, "geometry_screen_or_mesh_check_failed");
  assert(geometry.userClearances.allRoutesClear === true && geometry.userClearances.allSitStandSweepsClear === true, "geometry_clearance_check_failed");
  assert(supports.sourceBlendSha256 === release.sourceArtifacts.authoredBlend.sha256 && supports.registrySha256 === release.sourceArtifacts.objectRegistry.sha256, "support_measurement_binding_mismatch");
  assert(supports.shippingMeshParts === 225 && supports.physicalConstituentParts === 385 && supports.declaredParts === 384, "support_part_count_mismatch");
  assert(Object.values(supports.failures).every((failures) => failures.length === 0), "support_measurement_failed");
  return { registry, geometry, supports };
}

async function assertImage(path, expectedFormat, width = 1280, height = 800) {
  const metadata = await sharp(path).metadata();
  assert(metadata.format === expectedFormat && metadata.width === width && metadata.height === height, `image_format_mismatch:${relative(root, path)}`);
  return fileRecord(path);
}

export async function validateCleanEvidence(basePath = join(root, release.runtimeEvidencePath, release.cleanCapture.evidenceSubpath)) {
  const [settings, debug] = await Promise.all([
    readJson(join(basePath, "capture-settings.json")),
    readJson(join(basePath, "scene-debug.json"))
  ]);
  assert(settings.glbSha256 === release.finalGlb.sha256 && settings.width === 1280 && settings.height === 800, "clean_capture_settings_mismatch");
  assert(JSON.stringify(settings.views.map(({ id }) => id)) === JSON.stringify(release.reviewViews), "clean_capture_view_set_mismatch");
  assert(settings.normalProductMode === false && settings.qualityOutcome === "not-evaluated-by-this-test", "clean_capture_quality_claim");
  assert(debug.state === "loaded" && debug.failureReason === null && debug.loadStage === "loaded", "clean_runtime_not_loaded");
  assert(debug.assetBytesLoaded === release.finalGlb.sizeBytes && debug.assetBytesExpected === release.finalGlb.sizeBytes, "clean_runtime_asset_size_mismatch");
  assert(debug.meshCount === 225 && debug.materialCount === 14 && debug.triangleEstimate === 117619, "clean_runtime_inventory_mismatch");
  assert(debug.missingAssets.length === 0 && debug.renderProfile === release.renderProfile, "clean_runtime_profile_or_assets_mismatch");
  await Promise.all(["clean-spawn", ...release.reviewViews].map((name) => assertImage(join(basePath, `${name}.png`), "png")));
  return { settings, debug };
}

export async function validateNormalEvidence(basePath = join(root, release.runtimeEvidencePath, release.normalCapture.evidenceSubpath)) {
  const evidence = await readJson(join(basePath, "normal-product-evidence.json"));
  assert(evidence.platformCommit === release.platformValidatorCommit, "normal_product_platform_mismatch");
  assert(evidence.manifestSha256 === release.sourceArtifacts.sceneManifest.sha256 && evidence.glbSha256 === release.finalGlb.sha256, "normal_product_input_mismatch");
  assert(evidence.syntheticReviewPoseUsed === false && evidence.verdict === "functional-checks-passed", "normal_product_functional_verdict_mismatch");
  assert(evidence.seats.length === 8 && evidence.seats.every((seat) => seat.authoritativeClaimAndRelease === true
    && seat.seatedMovementLocked === true
    && seat.eyeHeightAboveSeatM >= 0.6
    && seat.eyeHeightAboveSeatM <= 0.85
    && Math.hypot(seat.afterRelease.root.x, seat.afterRelease.root.y, seat.afterRelease.root.z + 2.85) < 0.005), "normal_product_seat_check_failed");
  const surface = evidence.mediaAfterCreate.surfaces.find(({ surfaceId }) => surfaceId === "debug-main");
  assert(surface?.activeObjectType === "screen-share" && surface.textureId === null, "normal_product_media_object_mismatch");
  assert(evidence.physicalSurfacesMissingLogicalState.length === 0, "normal_product_surface_binding_failed");
  await Promise.all(normalEvidenceFiles.filter((name) => extname(name) === ".png").map((name) => assertImage(join(basePath, name), "png")));
  return evidence;
}

export async function relativeFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await relativeFiles(join(directory, entry.name), name));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort();
}

export async function recordsUnder(repositoryPath) {
  const directory = join(root, repositoryPath);
  return Promise.all((await relativeFiles(directory)).map(async (name) => ({
    path: `${repositoryPath}/${name}`,
    ...await fileRecord(join(directory, name))
  })));
}

export function assertPendingGates(value, path = "artifact", historical = false) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPendingGates(item, `${path}[${index}]`, historical));
    return;
  }
  if (!value || typeof value !== "object") return;
  const itemHistorical = historical || ["0.1.0", "0.1.1", "0.2.0"].includes(value.version ?? value.releaseVersion);
  for (const [key, child] of Object.entries(value)) {
    if (key === "status") assert(!["active", "approved"].includes(child), `forbidden_status:${path}`);
    if (["humanAcceptance", "visualAcceptance", "humanVisualAcceptance"].includes(key)) assert(child === release.humanAcceptance || child?.status === release.humanAcceptance, `human_acceptance_claim:${path}`);
    if (["isCurrent", "publicationReady", "visualAccepted", "humanAcceptanceRecorded", "stagingVerified", "productionActivation"].includes(key)) assert(child === false, `activation_claim:${path}:${key}`);
    if (key === "rightsApproved" && !itemHistorical) assert(child === false, `rights_approval_claim:${path}`);
    assertPendingGates(child, `${path}.${key}`, itemHistorical);
  }
}

export function posix(path) {
  return path.split(sep).join("/");
}
