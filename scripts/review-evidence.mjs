import { spawnSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";

import { fileRecord, readJson } from "./lib.mjs";

export const captureEvidenceFileNames = [
  "entry.png",
  "audience.png",
  "presenter.png",
  "diagonal-overview.png",
  "scene-debug.json",
  "capture-settings.json",
  "preview.webp"
];
export const runtimeEvidenceFileNames = [...captureEvidenceFileNames, "capture-binding.json"];

export function imageMagickVersion() {
  const result = spawnSync("compare", ["-version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("imagemagick_compare_not_found");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`imagemagick_version_failed:${result.stderr.trim()}`);
  const version = result.stdout.split(/\r?\n/, 1)[0]?.trim();
  if (!version?.startsWith("Version: ImageMagick ")) throw new Error(`invalid_imagemagick_version:${version}`);
  return version;
}

function compare(metric, reference, actual) {
  const result = spawnSync("compare", ["-metric", metric, reference, actual, "null:"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("imagemagick_compare_not_found");
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`image_compare_failed:${metric}:${result.stderr.trim()}`);
  const value = Number.parseFloat(result.stderr.trim().split(/\s+/)[0] ?? "");
  if (!Number.isFinite(value)) throw new Error(`invalid_image_metric:${metric}:${result.stderr.trim()}`);
  return value;
}

export function localRuntimeFromSceneDebug(sceneDebug) {
  return {
    status: sceneDebug.state === "loaded" && sceneDebug.failureReason === null && sceneDebug.missingAssets?.length === 0 ? "passed" : "failed",
    state: sceneDebug.state,
    failureReason: sceneDebug.failureReason,
    missingAssets: sceneDebug.missingAssets,
    loadMs: sceneDebug.loadMs,
    renderProfileApplyMs: sceneDebug.renderProfileApplyMs,
    renderProfile: sceneDebug.renderProfile,
    lightMappedMaterialCount: sceneDebug.lightMappedMaterialCount,
    materialCount: sceneDebug.materialCount,
    triangleEstimate: sceneDebug.triangleEstimate,
    darkPixelRatio: sceneDebug.screenshot?.darkPixelRatio,
    assetBytesLoaded: sceneDebug.assetBytesLoaded,
    spawnApplied: sceneDebug.spawnApplied
  };
}

export function normalizationFromSceneDebug(sceneDebug) {
  const localCaptureUrl = (value) => typeof value === "string" && /^local-capture\/[a-z0-9.-]+$/.test(value);
  return {
    policy: "repository-relative-local-capture-urls",
    bundleUrl: sceneDebug.bundleUrl,
    assetUrl: sceneDebug.assetUrl,
    machineLocalUrlsRemoved: localCaptureUrl(sceneDebug.bundleUrl) && localCaptureUrl(sceneDebug.assetUrl)
  };
}

export async function readRuntimeEvidence(root, reviewRelease) {
  const basePath = reviewRelease.runtimeEvidencePath;
  const files = Object.fromEntries(await Promise.all(runtimeEvidenceFileNames.map(async (name) => [
    name,
    { path: `${basePath}/${name}`, ...await fileRecord(join(root, basePath, name)) }
  ])));
  const sceneDebug = await readJson(join(root, basePath, "scene-debug.json"));
  const captureSettings = await readJson(join(root, basePath, "capture-settings.json"));
  const captureBinding = await readJson(join(root, reviewRelease.captureBindingPath));
  return {
    basePath,
    files,
    sceneDebug,
    captureSettings,
    captureBinding,
    normalization: normalizationFromSceneDebug(sceneDebug),
    localRuntime: localRuntimeFromSceneDebug(sceneDebug)
  };
}

export async function computeLocalCaptureAttestation(root, reviewRelease, releaseDirectory = join(root, reviewRelease.releasePath)) {
  const basePath = reviewRelease.runtimeEvidencePath;
  const sceneDebug = await readJson(join(root, basePath, "scene-debug.json"));
  const captureFiles = Object.fromEntries(await Promise.all(captureEvidenceFileNames.map(async (name) => [
    name,
    { path: `${basePath}/${name}`, ...await fileRecord(join(root, basePath, name)) }
  ])));
  return {
    schemaVersion: 1,
    attestationType: "local-capture-attestation",
    sceneId: reviewRelease.sceneId,
    releaseVersion: reviewRelease.version,
    purpose: "Attests exact local capture inputs and diagnostics; does not record human acceptance.",
    humanAcceptanceRecorded: false,
    platformCaptureImplementationCommit: reviewRelease.platformCaptureImplementationCommit,
    inputs: {
      sceneGlb: {
        path: `${reviewRelease.releasePath}/scene.glb`,
        ...await fileRecord(join(resolve(releaseDirectory), "scene.glb"))
      },
      sceneManifest: {
        path: `${reviewRelease.releasePath}/scene.json`,
        ...await fileRecord(join(resolve(releaseDirectory), "scene.json"))
      },
      reviewConfig: {
        path: "source/scene-contract.json",
        ...await fileRecord(join(root, "source/scene-contract.json"))
      }
    },
    diagnostics: localRuntimeFromSceneDebug(sceneDebug),
    captureFiles
  };
}

function withinAbsoluteTolerance(recorded, actual, tolerance) {
  return Number.isFinite(recorded) && Number.isFinite(actual) && Math.abs(recorded - actual) <= tolerance;
}

export function visualMeasurementsWithinTolerance(recorded, actual, tolerance) {
  return recorded.views.length === actual.views.length
    && recorded.views.every((view, index) => {
      const measured = actual.views[index];
      return view.id === measured.id
        && JSON.stringify(view.threshold) === JSON.stringify(measured.threshold)
        && view.status === measured.status
        && withinAbsoluteTolerance(view.phash, measured.phash, tolerance.perViewPhashAbsolute)
        && withinAbsoluteTolerance(view.ncc, measured.ncc, tolerance.perViewNccAbsolute);
    })
    && withinAbsoluteTolerance(recorded.phashTotal, actual.phashTotal, tolerance.aggregatePhashAbsolute)
    && withinAbsoluteTolerance(recorded.nccMean, actual.nccMean, tolerance.aggregateNccAbsolute)
    && recorded.result === actual.result;
}

export async function measureVisualParity(root, reviewRelease, evidencePath = reviewRelease.runtimeEvidencePath) {
  const evidenceDirectory = isAbsolute(evidencePath) ? evidencePath : join(root, evidencePath);
  const views = reviewRelease.reviewViews.map((id) => {
    const threshold = reviewRelease.visualParity.perView[id];
    const phash = compare("PHASH", join(root, "source/review", `${id}.webp`), join(evidenceDirectory, `${id}.png`));
    const ncc = compare("NCC", join(root, "source/review", `${id}.webp`), join(evidenceDirectory, `${id}.png`));
    return { id, phash, ncc, threshold, status: phash <= threshold.phashMax && ncc >= threshold.nccMin ? "passed" : "failed" };
  });
  const phashTotal = views.reduce((total, view) => total + view.phash, 0);
  const nccMean = views.reduce((total, view) => total + view.ncc, 0) / views.length;
  const passed = views.every(({ status }) => status === "passed")
    && phashTotal <= reviewRelease.visualParity.aggregate.phashTotalMax
    && nccMean >= reviewRelease.visualParity.aggregate.nccMeanMin;
  return { imageMagickVersion: imageMagickVersion(), views, phashTotal, nccMean, result: passed ? "passed" : "failed" };
}
