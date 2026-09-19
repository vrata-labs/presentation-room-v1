import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import validator from "gltf-validator";
import sharp from "sharp";

import { assert, fileRecord, glbInspection, readJson } from "./lib.mjs";
import { release030 as release } from "./release-0.3-config.mjs";

export const root = resolve(import.meta.dirname, "..");
export const requiredReleaseFiles = Object.freeze(["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]);
export const runtimeCaptureBaseFiles = Object.freeze([
  ...release.reviewViews.map((id) => `${id}.png`),
  "scene-debug.json",
  "capture-settings.json"
]);
export const runtimeRunEvidenceFiles = Object.freeze(release.runtimeCapture.runs.flatMap((runId) => (
  runtimeCaptureBaseFiles.map((name) => `runs/${runId}/${name}`)
)));
export const runtimeEvidenceFiles = Object.freeze([
  ...runtimeRunEvidenceFiles,
  "stability.json",
  "visual-parity.json",
  "capture-binding.json"
]);
export const requiredMeshTags = Object.freeze([
  "vrataObjectId",
  "vrataPartId",
  "vrataInteractionStatus",
  "vrataBakePolicy",
  "vrataAssetOrigin",
  "vrataAuthoringRelease"
]);

export function pendingRights() {
  return {
    status: release.rightsStatus,
    rightsApproved: false,
    rightsOwnerVerdict: {
      decision: release.rightsStatus,
      decisionMaker: null,
      receivedOn: null
    },
    ownershipBasis: "entirely-project-authored",
    externalAssetsUsed: false,
    downloadedAssetsUsed: false,
    privateSenseTowerMaterialsUsed: false,
    imageTo3dOutputUsed: false,
    brandingUsed: false,
    licenseRef: null,
    licenseFile: "LICENSES.md",
    sourceLedger: `${release.provenancePath}/release-asset-ledger.json`,
    clearedFor: [],
    notGrantedUntilApproval: [
      "staging",
      "public-web-runtime",
      "redistribution",
      "production-activation",
      "human-visual-acceptance"
    ],
    publicationReady: false
  };
}

export function glbJson(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 20, "invalid_glb_header");
  assert(bytes.subarray(0, 4).toString("ascii") === "glTF", "invalid_glb_magic");
  assert(bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, "invalid_glb_version_or_length");
  const jsonLength = bytes.readUInt32LE(12);
  assert(bytes.subarray(16, 20).toString("ascii") === "JSON", "glb_json_chunk_missing");
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\u0000\u0020\t\r\n]+$/u, ""));
}

function hashTypedArray(hash, value) {
  hash.update(value.constructor.name);
  hash.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
}

export async function geometryFingerprint(path) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const nodes = document.getRoot().listNodes()
    .filter((node) => node.getMesh())
    .sort((left, right) => left.getName().localeCompare(right.getName()));
  const hash = createHash("sha256");
  for (const node of nodes) {
    hash.update(node.getName());
    hash.update("\0");
    hash.update(JSON.stringify(node.getWorldMatrix()));
    for (const primitive of node.getMesh().listPrimitives()) {
      hash.update(`mode:${primitive.getMode()};`);
      const position = primitive.getAttribute("POSITION");
      assert(position, `geometry_position_missing:${node.getName()}`);
      hashTypedArray(hash, position.getArray());
      const indices = primitive.getIndices();
      if (indices) hashTypedArray(hash, indices.getArray());
      else hash.update("no-indices");
    }
  }
  return { meshNodes: nodes.length, sha256: hash.digest("hex") };
}

function statsFromInspection(inspection) {
  return {
    triangles: inspection.triangles,
    objects: inspection.objects,
    meshes: inspection.meshes,
    primitives: inspection.primitives,
    materials: inspection.materials,
    textures: inspection.textures,
    animations: inspection.animations
  };
}

function flattenReality(reality) {
  return reality.objects.flatMap((object) => object.parts.map((part) => ({
    ...part,
    objectInteractionStatus: object.interactionStatus
  })));
}

export function validateScenarios(scenarios, reality) {
  assert(scenarios.schemaVersion === 1 && scenarios.sceneId === release.sceneId && scenarios.releaseVersion === release.version, "scenario_identity_mismatch");
  assert(Array.isArray(scenarios.actorProfiles) && scenarios.actorProfiles.length === 1, "scenario_actor_profile_mismatch");
  assert(Array.isArray(scenarios.routes) && scenarios.routes.length === 1, "scenario_route_set_mismatch");
  assert(JSON.stringify(scenarios.routes[0].points) === JSON.stringify(reality.presenterRoute.points), "scenario_presenter_route_drift");
  assert(scenarios.routes[0].minimumWidthM === reality.presenterRoute.minimumWidthM, "scenario_presenter_route_width_drift");
  assert(Array.isArray(scenarios.scenarios), "scenario_list_missing");
  const objectIds = new Set(reality.objects.map(({ id }) => id));
  const bindingIds = new Set([
    ...reality.runtimeBindings.spawnPoints.map(({ id }) => id),
    ...reality.runtimeBindings.seatAnchors.map(({ id }) => id),
    ...reality.runtimeBindings.mediaSurfaces.map(({ surfaceId }) => surfaceId)
  ]);
  const scenarioIds = scenarios.scenarios.map(({ id }) => id);
  assert(new Set(scenarioIds).size === scenarioIds.length, "duplicate_scenario_id");
  for (const scenario of scenarios.scenarios) {
    assert(typeof scenario.id === "string" && scenario.id.length > 0, "invalid_scenario_id");
    assert(typeof scenario.implementationRequired === "boolean", `scenario_implementation_boundary_missing:${scenario.id}`);
    assert(Array.isArray(scenario.objectIds) && scenario.objectIds.length > 0, `scenario_objects_missing:${scenario.id}`);
    assert(scenario.objectIds.every((id) => objectIds.has(id)), `scenario_unknown_object:${scenario.id}`);
    assert(Array.isArray(scenario.runtimeBindingIds) && scenario.runtimeBindingIds.every((id) => bindingIds.has(id)), `scenario_unknown_binding:${scenario.id}`);
    assert(Array.isArray(scenario.steps) && scenario.steps.length > 0, `scenario_steps_missing:${scenario.id}`);
    assert(Array.isArray(scenario.acceptanceCriteria) && scenario.acceptanceCriteria.length > 0, `scenario_acceptance_missing:${scenario.id}`);
  }
  for (const seat of reality.runtimeBindings.seatAnchors) {
    const scenario = scenarios.scenarios.find(({ id }) => id === `${seat.id}-approach-sit-stand`);
    assert(scenario?.implementationRequired === true && scenario.runtimeBindingIds.includes(seat.id), `seat_scenario_missing:${seat.id}`);
  }
  const visibility = scenarios.scenarios.find(({ id }) => id === "screen-visible-from-all-seats");
  assert(visibility?.implementationRequired === true, "screen_visibility_scenario_missing");
  assert(reality.runtimeBindings.seatAnchors.every(({ id }) => visibility.runtimeBindingIds.includes(id)), "screen_visibility_seat_coverage_missing");
  assert(visibility.runtimeBindingIds.includes("debug-main"), "screen_visibility_media_binding_missing");
  const deferred = scenarios.scenarios.find(({ id }) => id === "presenter-controls-deferred");
  assert(deferred?.implementationRequired === false, "deferred_presenter_controls_claim");
  return { scenarios: scenarios.scenarios.length, actorProfiles: 1, routes: 1 };
}

export async function imageMetrics(path) {
  const image = sharp(path).removeAlpha();
  const metadata = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let luminanceTotal = 0;
  let darkPixels = 0;
  const pixels = info.width * info.height;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const luminance = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
    luminanceTotal += luminance;
    if (luminance < 0.1) darkPixels += 1;
  }
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    meanLuminance: Number((luminanceTotal / pixels).toFixed(8)),
    darkPixelRatioBelow10Percent: Number((darkPixels / pixels).toFixed(8))
  };
}

export async function reviewEvidence() {
  const directory = join(root, release.sourceReviewPath);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assert(JSON.stringify(entries) === JSON.stringify(release.reviewViews.map((id) => `${id}.webp`).sort()), "review_file_set_mismatch");
  return Promise.all(release.reviewViews.map(async (id) => {
    const repositoryPath = `${release.sourceReviewPath}/${id}.webp`;
    const path = join(root, repositoryPath);
    const [record, metrics] = await Promise.all([fileRecord(path), imageMetrics(path)]);
    assert(metrics.format === release.reviewImages.format && metrics.width === release.reviewImages.width && metrics.height === release.reviewImages.height, `review_image_format_mismatch:${id}`);
    assert(metrics.meanLuminance > 0.2 && metrics.darkPixelRatioBelow10Percent < 0.5, `review_image_empty_or_too_dark:${id}`);
    if (id === "entry") assert(metrics.darkPixelRatioBelow10Percent <= release.runtimeCapture.quality.entryDarkPixelRatioMax, "source_review_entry_too_dark");
    if (id === "screen-detail") assert(metrics.meanLuminance <= release.runtimeCapture.quality.screenMeanLuminanceMax, "source_review_screen_too_bright");
    return { id, path: repositoryPath, ...record, ...metrics };
  }));
}

function imageMagickMetric(metric, reference, capture) {
  const result = spawnSync("compare", ["-metric", metric, reference, capture, "null:"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("imagemagick_compare_not_found");
  if (result.error) throw result.error;
  assert(result.status === 0 || result.status === 1, `imagemagick_compare_failed:${metric}:${result.status}`);
  const value = Number.parseFloat(result.stderr.trim().split(/\s+/)[0] ?? "");
  assert(Number.isFinite(value), `imagemagick_metric_invalid:${metric}`);
  return value;
}

export function imageMagickVersion() {
  const result = spawnSync("compare", ["-version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("imagemagick_compare_not_found");
  if (result.error) throw result.error;
  assert(result.status === 0, `imagemagick_version_failed:${result.status}`);
  const version = result.stdout.split(/\r?\n/, 1)[0]?.trim();
  assert(version?.startsWith("Version: ImageMagick "), "imagemagick_version_invalid");
  return version;
}

export async function measureRuntimeCapture(directory, repositoryPath = release.runtimeEvidencePath) {
  const views = await Promise.all(release.reviewViews.map(async (id) => {
    const capturePath = join(directory, `${id}.png`);
    const referencePath = join(root, release.sourceReviewPath, `${id}.webp`);
    const [record, metrics] = await Promise.all([fileRecord(capturePath), imageMetrics(capturePath)]);
    assert(JSON.stringify(record) === JSON.stringify(release.runtimeCapture.acceptedViews[id]), `runtime_capture_digest_mismatch:${id}`);
    assert(metrics.format === "png" && metrics.width === release.reviewImages.width && metrics.height === release.reviewImages.height, `runtime_capture_image_format_mismatch:${id}`);
    assert(metrics.meanLuminance > 0.15 && metrics.darkPixelRatioBelow10Percent < 0.6, `runtime_capture_empty_or_too_dark:${id}`);
    if (id === "entry") assert(metrics.darkPixelRatioBelow10Percent <= release.runtimeCapture.quality.entryDarkPixelRatioMax, "runtime_capture_entry_too_dark");
    if (id === "screen-detail") {
      assert(metrics.darkPixelRatioBelow10Percent <= release.runtimeCapture.quality.screenDarkPixelRatioMax, "runtime_capture_screen_too_dark");
      assert(metrics.meanLuminance >= release.runtimeCapture.quality.screenMeanLuminanceMin && metrics.meanLuminance <= release.runtimeCapture.quality.screenMeanLuminanceMax, "runtime_capture_screen_luminance_invalid");
    }
    const threshold = release.runtimeCapture.visualParity.perView[id];
    const phash = imageMagickMetric("PHASH", referencePath, capturePath);
    const ncc = imageMagickMetric("NCC", referencePath, capturePath);
    const status = phash <= threshold.phashMax && ncc >= threshold.nccMin ? "passed" : "failed";
    assert(status === "passed", `runtime_visual_parity_failed:${id}:${phash}:${ncc}`);
    return {
      id,
      reference: { path: `${release.sourceReviewPath}/${id}.webp`, ...await fileRecord(referencePath) },
      capture: { path: `${repositoryPath}/${id}.png`, ...record },
      metrics,
      phash,
      ncc,
      threshold,
      status
    };
  }));
  const phashTotal = views.reduce((total, view) => total + view.phash, 0);
  const nccMean = views.reduce((total, view) => total + view.ncc, 0) / views.length;
  const aggregateThreshold = release.runtimeCapture.visualParity.aggregate;
  assert(phashTotal <= aggregateThreshold.phashTotalMax && nccMean >= aggregateThreshold.nccMeanMin, `runtime_visual_parity_aggregate_failed:${phashTotal}:${nccMean}`);
  return {
    metricTool: "ImageMagick compare",
    metricToolVersion: imageMagickVersion(),
    metricTolerance: release.runtimeCapture.visualParity.metricTolerance,
    thresholdState: release.runtimeCapture.visualParity.thresholdState,
    views,
    aggregateThreshold,
    aggregate: { phashTotal, nccMean },
    result: "passed"
  };
}

function roundUp(value, quantum) {
  return Number((Math.ceil(value / quantum) * quantum).toFixed(8));
}

function roundDown(value, quantum) {
  return Number((Math.floor(value / quantum) * quantum).toFixed(8));
}

export function deriveRuntimeThresholds(measurements) {
  assert(measurements.length === release.runtimeCapture.stability.requiredRuns, "runtime_threshold_run_count_mismatch");
  const derivation = release.runtimeCapture.visualParity.derivation;
  const observedPerView = {};
  const perView = {};
  for (const id of release.reviewViews) {
    const views = measurements.map((measurement) => measurement.views.find((view) => view.id === id));
    assert(views.every(Boolean), `runtime_threshold_view_missing:${id}`);
    const phashMaxObserved = Math.max(...views.map(({ phash }) => phash));
    const nccMinObserved = Math.min(...views.map(({ ncc }) => ncc));
    observedPerView[id] = { phashMaxObserved, nccMinObserved };
    perView[id] = {
      phashMax: roundUp(phashMaxObserved + derivation.perViewPhashAbsoluteMargin, derivation.perViewPhashRoundUpTo),
      nccMin: roundDown(nccMinObserved - derivation.perViewNccAbsoluteMargin, derivation.perViewNccRoundDownTo)
    };
  }
  const phashTotalMaxObserved = Math.max(...measurements.map(({ aggregate }) => aggregate.phashTotal));
  const nccMeanMinObserved = Math.min(...measurements.map(({ aggregate }) => aggregate.nccMean));
  return {
    basis: derivation.basis,
    runsMeasured: measurements.length,
    margins: derivation,
    observed: {
      perView: observedPerView,
      aggregate: { phashTotalMaxObserved, nccMeanMinObserved }
    },
    thresholds: {
      perView,
      aggregate: {
        phashTotalMax: roundUp(phashTotalMaxObserved + derivation.aggregatePhashAbsoluteMargin, derivation.aggregatePhashRoundUpTo),
        nccMeanMin: roundDown(nccMeanMinObserved - derivation.aggregateNccAbsoluteMargin, derivation.aggregateNccRoundDownTo)
      }
    }
  };
}

export function validateRuntimeStability(runs) {
  assert(runs.length === release.runtimeCapture.stability.requiredRuns, "runtime_stability_run_count_mismatch");
  assert(JSON.stringify(runs.map(({ id }) => id)) === JSON.stringify(release.runtimeCapture.runs), "runtime_stability_run_ids_mismatch");
  const perView = release.reviewViews.map((id) => {
    const views = runs.map(({ measurement }) => measurement.views.find((view) => view.id === id));
    assert(views.every(Boolean), `runtime_stability_view_missing:${id}`);
    const uniqueSha256 = [...new Set(views.map(({ capture }) => capture.sha256))];
    assert(uniqueSha256.length <= release.runtimeCapture.stability.maxUniqueImagesPerView, `runtime_capture_unstable:${id}`);
    const luminance = views.map(({ metrics }) => metrics.meanLuminance);
    const darkPixelRatio = views.map(({ metrics }) => metrics.darkPixelRatioBelow10Percent);
    return {
      id,
      imageComparison: "sha256-exact-byte",
      uniqueSha256,
      uniqueImageCount: uniqueSha256.length,
      byteIdentical: uniqueSha256.length === 1,
      observed: {
        meanLuminanceMin: Math.min(...luminance),
        meanLuminanceMax: Math.max(...luminance),
        darkPixelRatioMin: Math.min(...darkPixelRatio),
        darkPixelRatioMax: Math.max(...darkPixelRatio)
      }
    };
  });
  const thresholdDerivation = deriveRuntimeThresholds(runs.map(({ measurement }) => measurement));
  assert(JSON.stringify(thresholdDerivation.thresholds.perView) === JSON.stringify(release.runtimeCapture.visualParity.perView), "runtime_derived_per_view_threshold_mismatch");
  assert(JSON.stringify(thresholdDerivation.thresholds.aggregate) === JSON.stringify(release.runtimeCapture.visualParity.aggregate), "runtime_derived_aggregate_threshold_mismatch");
  const diagnosticDarkRatios = runs.map(({ diagnostics }) => diagnostics.darkPixelRatio);
  return {
    requiredRuns: release.runtimeCapture.stability.requiredRuns,
    completedRuns: runs.length,
    fullViewIds: release.reviewViews,
    allRunsComplete: true,
    imageComparison: "sha256-exact-byte",
    perView,
    diagnosticsDarkPixelRatio: {
      min: Math.min(...diagnosticDarkRatios),
      max: Math.max(...diagnosticDarkRatios)
    },
    thresholdDerivation,
    result: release.runtimeCapture.stability.requiredResult
  };
}

export function validateRuntimeDiagnostics(sceneDebug, captureSettings) {
  assert(JSON.stringify(captureSettings) === JSON.stringify(release.runtimeCapture.captureSettings), "runtime_capture_settings_mismatch");
  assert(sceneDebug.state === "loaded" && sceneDebug.failureReason === null && sceneDebug.loadStage === "loaded", "runtime_capture_load_failed");
  assert(Array.isArray(sceneDebug.missingAssets) && sceneDebug.missingAssets.length === 0, "runtime_capture_missing_assets");
  assert(sceneDebug.assetBytesLoaded === release.accepted.releaseGlbSizeBytes && sceneDebug.assetBytesExpected === release.accepted.releaseGlbSizeBytes, "runtime_capture_asset_size_mismatch");
  assert(sceneDebug.renderProfile === release.renderProfile && sceneDebug.lightMappedMaterialCount === 10 && sceneDebug.materialCount === 10, "runtime_capture_material_profile_mismatch");
  assert(sceneDebug.meshCount === 193 && sceneDebug.geometryCount === 193 && sceneDebug.triangleEstimate === 32060 && sceneDebug.textureCount === 17, "runtime_capture_inventory_mismatch");
  assert(sceneDebug.spawnApplied === true && sceneDebug.spawnPointId === "main" && sceneDebug.spawnYaw === Math.PI, "runtime_capture_spawn_mismatch");
  assert(sceneDebug.screenshot?.width > 0 && sceneDebug.screenshot?.height > 0 && sceneDebug.screenshot?.darkPixelRatio <= release.runtimeCapture.quality.diagnosticsDarkPixelRatioMax, "runtime_capture_screenshot_diagnostics_invalid");
  return {
    status: "passed",
    state: sceneDebug.state,
    failureReason: sceneDebug.failureReason,
    missingAssets: sceneDebug.missingAssets,
    loadMs: sceneDebug.loadMs,
    renderProfileApplyMs: sceneDebug.renderProfileApplyMs,
    renderProfile: sceneDebug.renderProfile,
    meshCount: sceneDebug.meshCount,
    materialCount: sceneDebug.materialCount,
    lightMappedMaterialCount: sceneDebug.lightMappedMaterialCount,
    triangleEstimate: sceneDebug.triangleEstimate,
    textureCount: sceneDebug.textureCount,
    assetBytesLoaded: sceneDebug.assetBytesLoaded,
    spawnApplied: sceneDebug.spawnApplied,
    darkPixelRatio: sceneDebug.screenshot.darkPixelRatio
  };
}

export async function validateCandidate(glbPath = join(root, release.buildOutputPath)) {
  const [reality, scenarios, glb, inspection, baseGeometry, candidateGeometry] = await Promise.all([
    readJson(join(root, release.realityPath)),
    readJson(join(root, release.scenariosPath)),
    readFile(glbPath),
    glbInspection(glbPath),
    geometryFingerprint(join(root, release.historicalGlbPath)),
    geometryFingerprint(glbPath)
  ]);
  assert(reality.schemaVersion === 1 && reality.sceneId === release.sceneId && reality.releaseVersion === release.version, "reality_identity_mismatch");
  assert(reality.changeScope.geometryChanged === false && reality.changeScope.oldLightmapReused === false && reality.changeScope.rebakeRequired === true, "reality_change_scope_mismatch");
  assert(reality.designConstraints.existingWindowCount === 0 && reality.designConstraints.artificialWindowOpeningAdded === false, "artificial_window_claim");
  assert(reality.designConstraints.panoramaSphereAdded === false && reality.designConstraints.externalAssetsUsed === false && reality.designConstraints.brandingUsed === false, "external_visual_asset_claim");
  const inventory = flattenReality(reality);
  assert(inventory.length === reality.expectedCounts.meshParts && inventory.length === 193, "reality_mesh_count_mismatch");
  const inventoryByName = new Map(inventory.map((part) => [part.nodeName, part]));
  assert(inventoryByName.size === inventory.length, "duplicate_reality_mesh_name");
  assert(reality.objects.length === reality.expectedCounts.logicalObjects && reality.objects.length === 18, "reality_object_count_mismatch");
  assert(reality.materials.length === reality.expectedCounts.materials && reality.materials.length === 10, "reality_material_count_mismatch");
  assert(reality.runtimeBindings.seatAnchors.length === 8 && reality.runtimeBindings.mediaSurfaces.length === 1, "reality_runtime_binding_count_mismatch");
  assert(reality.reviewViews.length === reality.expectedCounts.reviewViews && JSON.stringify(reality.reviewViews.map(({ id }) => id)) === JSON.stringify(release.reviewViews), "reality_review_view_set_mismatch");

  const document = glbJson(glb);
  const meshNodes = (document.nodes ?? []).filter((node) => Number.isInteger(node.mesh));
  assert(meshNodes.length === inventory.length, "glb_mesh_node_count_mismatch");
  assert(JSON.stringify(meshNodes.map(({ name }) => name).sort()) === JSON.stringify([...inventoryByName.keys()].sort()), "glb_mesh_inventory_mismatch");
  const statusCounts = { passive: 0, deferred: 0, interactive: 0 };
  for (const node of meshNodes) {
    const expected = inventoryByName.get(node.name);
    const extras = node.extras ?? {};
    for (const key of requiredMeshTags) assert(Object.hasOwn(extras, key), `glb_mesh_tag_missing:${node.name}:${key}`);
    assert(extras.vrataObjectId === expected.objectId && extras.vrataPartId === expected.partId, `glb_mesh_identity_mismatch:${node.name}`);
    assert(extras.vrataInteractionStatus === expected.interactionStatus && extras.vrataInteractionStatus === expected.objectInteractionStatus, `glb_mesh_status_mismatch:${node.name}`);
    assert(extras.vrataBakePolicy === "include" && extras.vrataAssetOrigin === "project-authored" && extras.vrataAuthoringRelease === release.version, `glb_mesh_provenance_mismatch:${node.name}`);
    for (const primitive of document.meshes[node.mesh].primitives) assert(Number.isInteger(primitive.attributes?.TEXCOORD_1), `glb_lightmap_uv_missing:${node.name}`);
    statusCounts[expected.interactionStatus] += 1;
  }
  assert(Object.values(statusCounts).every((count) => count > 0), "glb_interaction_status_coverage_missing");
  assert((document.materials ?? []).length === 10, "glb_material_count_mismatch");
  for (const material of document.materials) {
    assert(material.extras?.vrataRenderProfile === release.renderProfile, `glb_material_profile_mismatch:${material.name}`);
    assert(material.extras?.vrataLightMap === true && material.extras?.vrataLightMapIntensity === release.bake.lightMapIntensity, `glb_material_lightmap_mismatch:${material.name}`);
    assert(Array.isArray(material.extras?.vrataOriginalEmissive) && typeof material.extras?.vrataOriginalEmissiveIntensity === "number", `glb_material_original_emission_missing:${material.name}`);
    assert(Number.isInteger(material.emissiveTexture?.index) && material.emissiveTexture.texCoord === 1, `glb_material_emissive_transport_mismatch:${material.name}`);
  }
  assert(!(document.cameras?.length) && !(document.animations?.length), "glb_camera_or_animation_exported");
  assert(!(document.extensionsUsed ?? []).includes("KHR_lights_punctual"), "glb_light_exported");
  const sceneExtras = document.scenes?.[document.scene ?? 0]?.extras ?? {};
  assert(sceneExtras.vrataSceneId === release.sceneId && sceneExtras.vrataAuthoringRelease === release.version, "glb_scene_identity_mismatch");
  assert(sceneExtras.vrataWindowCount === 0 && sceneExtras.vrataPanoramaSphere === false && sceneExtras.vrataExternalAssetsUsed === false, "glb_design_boundary_mismatch");

  const stats = statsFromInspection(inspection);
  assert(inspection.scenes === 1 && stats.triangles === 32060 && stats.objects === 210 && stats.meshes === 193 && stats.primitives === 193, "glb_geometry_stats_mismatch");
  assert(stats.materials === 10 && stats.textures === 8 && stats.animations === 0, "glb_material_stats_mismatch");
  assert(glb.length <= release.budgets.glbBytesMax && stats.triangles <= release.budgets.trianglesMax && stats.objects <= release.budgets.objectsMax, "glb_budget_exceeded");
  assert(stats.meshes <= release.budgets.meshesMax && stats.materials <= release.budgets.materialsMax && stats.textures <= release.budgets.texturesMax, "glb_budget_exceeded");
  assert(baseGeometry.sha256 === release.accepted.geometryFingerprintSha256 && candidateGeometry.sha256 === baseGeometry.sha256, "geometry_fingerprint_changed");
  const scenarioStats = validateScenarios(scenarios, reality);
  const khronos = await validator.validateBytes(new Uint8Array(glb), { uri: `${release.sceneId}@${release.version}/scene.glb`, maxIssues: 500 });
  assert(khronos.issues.numErrors === 0 && khronos.issues.numWarnings === 0, `khronos_validation_failed:${khronos.issues.numErrors}:${khronos.issues.numWarnings}`);
  return {
    reality,
    scenarios,
    stats,
    statusCounts,
    scenarioStats,
    geometry: { baseVersion: release.baseVersion, ...candidateGeometry, unchanged: true },
    gltfInventory: {
      nodes: (document.nodes ?? []).length,
      meshNodes: meshNodes.length,
      materials: (document.materials ?? []).length,
      textureObjects: (document.textures ?? []).length,
      imagePayloads: (document.images ?? []).length,
      cameras: (document.cameras ?? []).length,
      animations: (document.animations ?? []).length
    },
    khronos: {
      validator: "gltf-validator 2.0.0-dev.3.10",
      errors: khronos.issues.numErrors,
      warnings: khronos.issues.numWarnings,
      infos: khronos.issues.numInfos,
      hints: khronos.issues.numHints
    }
  };
}

export async function pathRecord(repositoryPath) {
  return { path: repositoryPath, ...await fileRecord(join(root, repositoryPath)) };
}

export function assertPendingGates(value, path = "artifact", options = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPendingGates(item, `${path}[${index}]`, options));
    return;
  }
  if (!value || typeof value !== "object") return;
  const version = value.releaseVersion ?? value.version;
  const allowApprovedRights = version === release.version
    ? false
    : options.allowApprovedRights === true;
  const childOptions = { allowApprovedRights };
  for (const [key, child] of Object.entries(value)) {
    if (key === "humanGates") {
      assert(child && typeof child === "object" && !Array.isArray(child), `invalid_human_gates:${path}`);
      if (Object.hasOwn(child, "visual")) assert(child.visual === release.humanAcceptance, `human_acceptance_claim:${path}:visual`);
      if (Object.hasOwn(child, "rights")) assert(child.rights === (allowApprovedRights ? "approved-for-public-staging-review" : release.rightsStatus), `rights_status_claim:${path}:rights`);
    }
    if (key === "status") {
      assert(!["active", "approved"].includes(child), `forbidden_status:${path}:${child}`);
      if (child === "approved-for-public-staging-review") assert(allowApprovedRights, `rights_approval_claim:${path}`);
    }
    if (["humanAcceptance", "visualApproval", "visualAcceptance", "acceptanceStatus", "visualAcceptanceStatus", "humanVisualAcceptance"].includes(key)) {
      const status = typeof child === "string" ? child : child?.status;
      assert(status === release.humanAcceptance, `human_acceptance_claim:${path}:${key}`);
    }
    if (["rightsStatus", "rightsApproval", "rightsApprovalStatus", "approvalStatus", "humanRightsApproval"].includes(key)) {
      const status = typeof child === "string" ? child : child?.status;
      assert(status === (allowApprovedRights ? "approved-for-public-staging-review" : release.rightsStatus), `rights_status_claim:${path}:${key}`);
    }
    if (["rightsApproved", "humanRightsAccepted"].includes(key) && !allowApprovedRights) assert(child === false, `rights_approval_claim:${path}`);
    if (["isCurrent", "publicationReady", "visualAccepted", "humanVisualAccepted", "humanAcceptanceRecorded", "productionActivation", "stagingVerified", "immutableRelease"].includes(key)) assert(child === false, `activation_claim:${path}:${key}`);
    if (key === "releases" && options.allowHistoricalManifestRecords === true && Array.isArray(child)) {
      child.forEach((record, index) => assertPendingGates(record, `${path}.releases[${index}]`, {
        allowApprovedRights: ["0.1.0", "0.1.1", "0.2.0"].includes(record?.version)
      }));
    } else {
      assertPendingGates(child, `${path}.${key}`, childOptions);
    }
  }
}
