import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  assert,
  fileRecord,
  glbInspection,
  pathTrackedInGit,
  readJson,
  resolveBlenderExecutable,
  run,
  sha256,
  verifyBlender,
  writeJson
} from "./lib.mjs";
import { computeLocalCaptureAttestation, measureVisualParity, readRuntimeEvidence } from "./review-evidence.mjs";
import { canonicalRightsScope, reviewRelease } from "./review-release-config.mjs";

const root = resolve(import.meta.dirname, "..");
const bake = process.argv.includes("--bake");
const twice = process.argv.includes("--twice");
const materialize = process.argv.includes("--materialize");
const replaceMaterialized = process.argv.includes("--replace-materialized");
const requestedBakeDevice = process.env.SCENE_BAKE_DEVICE ?? reviewRelease.bake.device;
const output = repositoryPath(process.env.SCENE_BUILD_OUTPUT ?? reviewRelease.buildOutputPath);
const lightmap = repositoryPath(process.env.SCENE_LIGHTMAP ?? (bake
  ? reviewRelease.bakeOutputPath
  : reviewRelease.acceptedLightmapPath));
const releaseRoot = resolve(root, "assets/scenes", reviewRelease.sceneId);

function repositoryPath(path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

function isInside(parent, path) {
  const child = relative(parent, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function measuredStats(inspection) {
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

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function validateMaterializationPath(path, repositoryPath) {
  assert(!pathTrackedInGit(root, repositoryPath), `tracked_immutable_materialization_forbidden:${repositoryPath}`);
  if (!await pathExists(path)) return;
  assert(replaceMaterialized, `immutable_materialization_path_exists:${repositoryPath}`);
}

async function installStagedMaterialization(replacements, backupPath, stagingPath) {
  await mkdir(backupPath, { recursive: true });
  const backedUp = [];
  const installed = [];
  try {
    for (const replacement of replacements) {
      if (!await pathExists(replacement.target)) continue;
      await mkdir(dirname(replacement.backup), { recursive: true });
      await rename(replacement.target, replacement.backup);
      backedUp.push(replacement);
    }
    for (const replacement of replacements) {
      await mkdir(dirname(replacement.target), { recursive: true });
      await rename(replacement.staged, replacement.target);
      installed.push(replacement);
    }
  } catch (error) {
    try {
      for (const replacement of installed.reverse()) await rm(replacement.target, { recursive: true, force: true });
      for (const replacement of backedUp.reverse()) await rename(replacement.backup, replacement.target);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `materialization_install_and_rollback_failed:${backupPath}`);
    }
    await rm(backupPath, { recursive: true, force: true });
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
  await rm(backupPath, { recursive: true, force: true });
  await rm(stagingPath, { recursive: true, force: true });
}

function exportScene(blender, path, shouldBake) {
  const args = [
    "--background",
    join(root, reviewRelease.sourceBlendPath),
    "--python",
    join(root, reviewRelease.exportScriptPath),
    "--",
    "--output",
    path,
    "--lightmap",
    lightmap,
    "--size",
    String(reviewRelease.bake.resolution),
    "--samples",
    String(reviewRelease.bake.samples),
    "--scale",
    String(reviewRelease.bake.scale),
    "--device",
    requestedBakeDevice,
    "--intensity",
    String(reviewRelease.bake.defaultIntensity)
  ];
  if (shouldBake) args.push("--bake");
  run(blender, args);
}

async function materializeRelease() {
  assert(!bake && !twice, "materialization_cannot_bake_or_rebuild");
  const config = await readJson(join(root, "scene-repository.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  const baseReleases = manifest.releases.filter(({ version }) => version !== reviewRelease.version);
  const baseRelease = baseReleases.at(-1);
  const baseScene = await readJson(join(root, baseRelease.releasePath, "scene.json"));
  const contract = await readJson(join(root, "source/scene-contract.json"));
  const releasePath = join(root, reviewRelease.releasePath);
  const provenancePath = join(root, reviewRelease.provenancePath);
  const stagingPath = join(root, `build/materialize-${reviewRelease.version}`);
  const stagingReleasePath = join(stagingPath, "release");
  const stagingProvenancePath = join(stagingPath, "provenance.json");
  const stagingManifestPath = join(stagingPath, "manifest.json");
  const backupPath = join(root, `build/materialize-backup-${reviewRelease.version}`);

  assert(config.releaseMaterialized === true, "repository_materialization_flag_must_be_true");
  assert(JSON.stringify(baseReleases.map(({ version }) => version)) === JSON.stringify(["0.1.0", "0.1.1"]), "materialization_requires_append_after_0.1.1");
  assert(manifest.releases.length === baseReleases.length || (replaceMaterialized && manifest.releases.length === baseReleases.length + 1), "materialization_release_set_mismatch");
  assert(baseRelease.version === "0.1.1" && baseScene.version === "0.1.1", "materialization_base_release_mismatch");
  if (replaceMaterialized) {
    const headManifest = spawnSync("git", ["show", "HEAD:manifest.json"], { cwd: root, encoding: "utf8" });
    assert(headManifest.status === 0 && !JSON.parse(headManifest.stdout).releases.some(({ version }) => version === reviewRelease.version), "tracked_manifest_already_contains_review_release");
  }
  await validateMaterializationPath(releasePath, reviewRelease.releasePath);
  await validateMaterializationPath(provenancePath, reviewRelease.provenancePath);
  assert(!await pathExists(backupPath), `materialization_backup_requires_recovery:${relative(root, backupPath)}`);
  assert(config.platformValidatorCommit === reviewRelease.platformCaptureImplementationCommit, "materialization_validator_pin_mismatch");
  assert(JSON.stringify({
    status: manifest.rightsStatus,
    rightsApproved: manifest.rightsApproved,
    rightsApprovalDate: manifest.rightsApprovalDate,
    licenseRef: manifest.licenseRef,
    publicationReady: manifest.publicationReady
  }) === JSON.stringify({
    status: canonicalRightsScope.status,
    rightsApproved: canonicalRightsScope.rightsApproved,
    rightsApprovalDate: canonicalRightsScope.rightsApprovalDate,
    licenseRef: canonicalRightsScope.licenseRef,
    publicationReady: canonicalRightsScope.publicationReady
  }), "materialization_rights_contract_mismatch");

  const [glbRecord, atlasRecord, exporterRecord, sourceBlendRecord, runtimeEvidence, visualMeasurement] = await Promise.all([
    fileRecord(output),
    fileRecord(join(root, reviewRelease.acceptedLightmapPath)),
    fileRecord(join(root, reviewRelease.exportScriptPath)),
    fileRecord(join(root, reviewRelease.sourceBlendPath)),
    readRuntimeEvidence(root, reviewRelease),
    measureVisualParity(root, reviewRelease)
  ]);
  assert(glbRecord.sha256 === reviewRelease.releaseGlbSha256, `release_glb_digest_mismatch:${glbRecord.sha256}`);
  assert(atlasRecord.sha256 === reviewRelease.acceptedLightmapSha256, `accepted_lightmap_digest_mismatch:${atlasRecord.sha256}`);
  assert(runtimeEvidence.normalization.machineLocalUrlsRemoved === true, "runtime_evidence_urls_not_normalized");
  assert(runtimeEvidence.localRuntime.status === "passed", "runtime_evidence_failed");
  assert(visualMeasurement.result === "passed", "visual_evidence_failed");
  const inspection = await glbInspection(output);
  const stats = measuredStats(inspection);
  assert(glbRecord.sizeBytes <= contract.budgets.glbBytesMax, "release_glb_size_budget_exceeded");
  assert(stats.triangles <= contract.budgets.trianglesMax && stats.objects <= contract.budgets.objectsMax && stats.meshes <= contract.budgets.meshesMax, "release_geometry_budget_exceeded");
  assert(stats.materials <= contract.budgets.materialsMax && stats.textures <= contract.budgets.texturesMax, "release_material_budget_exceeded");

  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingReleasePath, { recursive: true });
  await Promise.all([
    copyFile(join(root, baseRelease.releasePath, "LICENSES.md"), join(stagingReleasePath, "LICENSES.md")),
    copyFile(join(root, reviewRelease.runtimeEvidencePath, "preview.webp"), join(stagingReleasePath, "preview.webp")),
    copyFile(output, join(stagingReleasePath, "scene.glb"))
  ]);
  const scene = {
    ...baseScene,
    version: reviewRelease.version,
    glbSha256: glbRecord.sha256,
    stats,
    renderProfile: reviewRelease.renderProfile
  };
  await writeJson(join(stagingReleasePath, "scene.json"), scene);
  const files = Object.fromEntries(await Promise.all(
    ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"].map(async (name) => [name, await fileRecord(join(stagingReleasePath, name))])
  ));
  assert(JSON.stringify(files["LICENSES.md"]) === JSON.stringify(baseRelease.files["LICENSES.md"]), "release_license_payload_changed");
  assert(JSON.stringify(files["preview.webp"]) === JSON.stringify({
    sha256: runtimeEvidence.files["preview.webp"].sha256,
    sizeBytes: runtimeEvidence.files["preview.webp"].sizeBytes
  }), "release_preview_evidence_mismatch");

  const reproducibility = {
    scope: "same-host-same-saved-blend-same-accepted-atlas-same-blender-binary-two-run",
    runs: 2,
    result: "byte-identical-glb",
    sha256: glbRecord.sha256,
    lightmapSha256: atlasRecord.sha256
  };
  const release = {
    sceneId: reviewRelease.sceneId,
    version: reviewRelease.version,
    baseVersion: baseRelease.version,
    releaseKind: reviewRelease.releaseKind,
    status: reviewRelease.status,
    humanAcceptance: reviewRelease.humanAcceptance,
    rightsStatus: manifest.rightsStatus,
    rightsApproved: manifest.rightsApproved,
    rightsApprovalDate: manifest.rightsApprovalDate,
    licenseRef: manifest.licenseRef,
    isCurrent: reviewRelease.isCurrent,
    publicationReady: reviewRelease.publicationReady,
    renderMode: reviewRelease.renderMode,
    renderProfile: reviewRelease.renderProfile,
    platformValidatorCommit: config.platformValidatorCommit,
    releasePath: reviewRelease.releasePath,
    files,
    stats,
    reproducibility
  };
  const captureAttestation = await computeLocalCaptureAttestation(root, reviewRelease, stagingReleasePath);
  assert(JSON.stringify(runtimeEvidence.captureBinding) === JSON.stringify(captureAttestation), "local_capture_attestation_mismatch");
  const provenance = {
    schemaVersion: 1,
    sceneId: reviewRelease.sceneId,
    releaseVersion: reviewRelease.version,
    status: reviewRelease.status,
    humanAcceptance: reviewRelease.humanAcceptance,
    isCurrent: false,
    publicationReady: false,
    platformValidatorCommit: config.platformValidatorCommit,
    rights: {
      status: canonicalRightsScope.status,
      rightsApproved: canonicalRightsScope.rightsApproved,
      rightsApprovalDate: canonicalRightsScope.rightsApprovalDate,
      licenseRef: canonicalRightsScope.licenseRef,
      rightsOwnerVerdict: {
        decision: canonicalRightsScope.status,
        decisionMaker: canonicalRightsScope.decisionMaker,
        receivedOn: canonicalRightsScope.rightsApprovalDate
      },
      ownershipBasis: canonicalRightsScope.ownershipBasis,
      allowedUses: [...canonicalRightsScope.allowedUses],
      notGrantedByThisVerdict: [...canonicalRightsScope.notGrantedByThisVerdict],
      externalAssetsUsed: canonicalRightsScope.externalAssetsUsed,
      downloadedAssetsUsed: canonicalRightsScope.downloadedAssetsUsed,
      privateSenseTowerMaterialsUsed: canonicalRightsScope.privateSenseTowerMaterialsUsed,
      imageTo3dOutputUsed: canonicalRightsScope.imageTo3dOutputUsed,
      brandingUsed: canonicalRightsScope.brandingUsed,
      publicationReady: canonicalRightsScope.publicationReady
    },
    source: {
      blend: { path: reviewRelease.sourceBlendPath, ...sourceBlendRecord },
      exporter: { path: reviewRelease.exportScriptPath, ...exporterRecord },
      atlas: {
        path: reviewRelease.acceptedLightmapPath,
        ...atlasRecord,
        width: reviewRelease.bake.resolution,
        height: reviewRelease.bake.resolution
      }
    },
    toolchain: {
      blenderVersion: reviewRelease.blender.version,
      blenderBuildHash: reviewRelease.blender.buildHash,
      blenderBinarySha256: reviewRelease.blender.binarySha256,
      acceptedBakeAuthoringEvidence: {
        evidenceType: "recorded-authoring-evidence",
        materializationPerformedBake: false,
        acceptedAtlasSha256: atlasRecord.sha256,
        contract: {
          ...reviewRelease.bake,
          transport: "emissiveTexture TEXCOORD_1 with baked-pbr-v1 metadata"
        }
      }
    },
    runtimeEvidence: {
      basePath: runtimeEvidence.basePath,
      files: runtimeEvidence.files,
      normalization: runtimeEvidence.normalization,
      captureSettings: runtimeEvidence.captureSettings,
      localCaptureAttestation: {
        path: reviewRelease.captureBindingPath,
        ...runtimeEvidence.files["capture-binding.json"],
        attestationType: runtimeEvidence.captureBinding.attestationType,
        humanAcceptanceRecorded: false
      }
    },
    release: {
      path: reviewRelease.releasePath,
      files,
      stats
    },
    reproducibility,
    localRuntime: runtimeEvidence.localRuntime,
    visualParity: {
      status: "passed",
      metricTool: "ImageMagick compare",
      metricToolVersion: visualMeasurement.imageMagickVersion,
      metricTolerance: reviewRelease.visualParity.metricTolerance,
      views: visualMeasurement.views,
      thresholdState: reviewRelease.visualParity.thresholdState,
      finalThresholdsDefined: true,
      aggregateThresholds: reviewRelease.visualParity.aggregate,
      phashTotal: visualMeasurement.phashTotal,
      nccMean: visualMeasurement.nccMean,
      result: visualMeasurement.result,
      humanAcceptanceRecorded: false
    }
  };
  const nextManifest = {
    ...manifest,
    platformValidatorCommit: config.platformValidatorCommit,
    releases: [...baseReleases, release]
  };
  await writeJson(stagingProvenancePath, provenance);
  await writeJson(stagingManifestPath, nextManifest);
  assert(JSON.stringify(await readJson(join(stagingReleasePath, "scene.json"))) === JSON.stringify(scene), "staged_scene_validation_failed");
  assert(JSON.stringify(await readJson(stagingProvenancePath)) === JSON.stringify(provenance), "staged_provenance_validation_failed");
  assert(JSON.stringify(await readJson(stagingManifestPath)) === JSON.stringify(nextManifest), "staged_manifest_validation_failed");
  await installStagedMaterialization([
    { staged: stagingReleasePath, target: releasePath, backup: join(backupPath, "release") },
    { staged: stagingProvenancePath, target: provenancePath, backup: join(backupPath, "provenance.json") },
    { staged: stagingManifestPath, target: join(root, "manifest.json"), backup: join(backupPath, "manifest.json") }
  ], backupPath, stagingPath);
  process.stdout.write(`Materialized immutable review release ${reviewRelease.sceneId}@${reviewRelease.version}\n`);
  process.stdout.write(`GLB ${glbRecord.sizeBytes} bytes sha256=${glbRecord.sha256}\n`);
  process.stdout.write(`Atlas ${atlasRecord.sizeBytes} bytes sha256=${atlasRecord.sha256}\n`);
  process.stdout.write(`Stats ${JSON.stringify(stats)}\n`);
}

async function buildRelease() {
  assert(!isInside(releaseRoot, output), "direct_immutable_release_output_forbidden");
  assert(!(bake && twice), "bake_and_two_run_verification_must_be_separate");
  if (bake) assert(requestedBakeDevice === reviewRelease.bake.device && requestedBakeDevice === "CUDA", `bake_device_must_be_cuda:${requestedBakeDevice}`);
  const blender = resolveBlenderExecutable();
  if (!bake) {
    try {
      await access(lightmap);
    } catch {
      throw new Error(`accepted_lightmap_missing:${relative(root, lightmap)}`);
    }
  }
  verifyBlender(blender);
  assert((await fileRecord(blender)).sha256 === reviewRelease.blender.binarySha256, "blender_binary_digest_mismatch");
  await mkdir(dirname(output), { recursive: true });
  exportScene(blender, output, bake);
  const firstSha256 = sha256(await readFile(output));
  const manifest = await readJson(join(root, "manifest.json"));
  const published = manifest.releases.find(({ version }) => version === reviewRelease.version);
  if (published) assert(firstSha256 === published.files?.["scene.glb"]?.sha256, `published_glb_digest_mismatch:${firstSha256}`);

  if (twice) {
    const second = join(dirname(output), `${basename(output, ".glb")}.second.glb`);
    try {
      exportScene(blender, second, false);
      const secondSha256 = sha256(await readFile(second));
      assert(secondSha256 === firstSha256, `two_run_glb_digest_mismatch:${firstSha256}:${secondSha256}`);
    } finally {
      await rm(second, { force: true });
    }
  }
  process.stdout.write(`${bake ? "Baked candidate" : "Built baked review"} ${reviewRelease.sceneId}@${reviewRelease.version} sha256=${firstSha256}\n`);
}

assert(reviewRelease.status === "review", "review_release_status_mismatch");
assert(reviewRelease.humanAcceptance === "pending-human-acceptance", "review_release_human_gate_mismatch");
assert(reviewRelease.isCurrent === false && reviewRelease.publicationReady === false, "review_release_activation_claim");
assert(reviewRelease.renderProfile === "baked-pbr-v1", "review_release_render_profile_mismatch");

if (materialize) await materializeRelease();
else await buildRelease();
