import { join, resolve } from "node:path";

import {
  assert,
  fileRecord,
  glbInspection,
  materializeMetadataRelease,
  readJson,
  toRuntimePosition,
  writeJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const requiredReleaseFiles = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
const toolingPaths = [
  "scripts/lib.mjs",
  "scripts/build-review-candidate.mjs",
  "scripts/inspect-release.mjs",
  "scripts/validate-repository.mjs",
  "scripts/verify-reproducibility.mjs",
  "tests/repository.test.mjs"
];
const historicalEvidencePaths = [
  "source/scene-contract.json",
  "source/scene-contract-lock.json",
  "source/review-candidate-lock.json",
  "provenance/asset-ledger.json",
  "provenance/generation-ledger.json"
];

const contract = await readJson(join(root, "source/scene-contract.json"));
const releaseContract = await readJson(join(root, "source/metadata-release.json"));
const historicalLock = await readJson(join(root, "source/review-candidate-lock.json"));
const rights = contract.rights;
const historicalPath = join(root, "assets/scenes", contract.sceneId, contract.version);
const releasePath = join(root, "assets/scenes", contract.sceneId, releaseContract.version);

assert(contract.version === "0.1.0", "historical_source_contract_mismatch");
assert(contract.toolchain.platformValidatorCommit === "9153bb9818a2907fb33ba96375f7b31c1641f12f", "historical_validator_commit_mismatch");
assert(releaseContract.version === "0.1.1" && releaseContract.baseVersion === contract.version, "metadata_release_version_mismatch");
assert(releaseContract.releaseKind === "metadata-only-review", "metadata_release_kind_mismatch");
assert(releaseContract.status === "review" && releaseContract.humanAcceptance === "pending-human-acceptance", "metadata_release_gate_mismatch");
assert(releaseContract.isCurrent === false && releaseContract.publicationReady === false, "metadata_release_activation_claim");
assert(releaseContract.renderProfile === "neutral-pbr", "metadata_release_render_profile_mismatch");
assert(releaseContract.platformValidatorCommit === "61736f6289f941e290f4fe156f17efdd64ef876b", "metadata_validator_commit_mismatch");
assert(JSON.stringify(releaseContract.unchangedFiles) === JSON.stringify(["LICENSES.md", "preview.webp", "scene.glb"]), "metadata_release_payload_contract_mismatch");

const historicalFiles = {};
for (const name of requiredReleaseFiles) {
  historicalFiles[name] = await fileRecord(join(historicalPath, name));
  assert(JSON.stringify(historicalFiles[name]) === JSON.stringify(historicalLock.release.files[name]), `historical_release_changed:${name}`);
}

const expectedRuntimeSpawn = toRuntimePosition(contract.spawn.position);
const focalSurface = contract.mediaSurfaces.find(({ surfaceId }) => surfaceId === "debug-main");
const expectedRuntimeTarget = toRuntimePosition(focalSurface.position);
assert(JSON.stringify(releaseContract.runtimeSpawn.position) === JSON.stringify(expectedRuntimeSpawn), "metadata_runtime_spawn_position_mismatch");
assert(JSON.stringify(releaseContract.runtimeSpawn.lookAt) === JSON.stringify(expectedRuntimeTarget), "metadata_runtime_spawn_target_mismatch");
assert(releaseContract.runtimeSpawn.forwardAxis === "-Z" && releaseContract.runtimeSpawn.yaw === Math.PI, "metadata_runtime_spawn_heading_mismatch");

const dx = expectedRuntimeTarget.x - expectedRuntimeSpawn.x;
const dz = expectedRuntimeTarget.z - expectedRuntimeSpawn.z;
const targetLength = Math.hypot(dx, dz);
const forwardX = Math.sin(releaseContract.runtimeSpawn.yaw);
const forwardZ = -Math.cos(releaseContract.runtimeSpawn.yaw);
assert(Math.abs(forwardX - dx / targetLength) < 1e-12 && Math.abs(forwardZ - dz / targetLength) < 1e-12, "metadata_runtime_spawn_not_facing_screen");

await materializeMetadataRelease(historicalPath, releasePath, releaseContract);

const releaseFiles = {};
for (const name of requiredReleaseFiles) {
  releaseFiles[name] = await fileRecord(join(releasePath, name));
}
for (const name of releaseContract.unchangedFiles) {
  assert(JSON.stringify(releaseFiles[name]) === JSON.stringify(historicalFiles[name]), `metadata_release_payload_changed:${name}`);
}

const measured = await glbInspection(join(releasePath, "scene.glb"));
const stats = {
  triangles: measured.triangles,
  objects: measured.objects,
  meshes: measured.meshes,
  primitives: measured.primitives,
  materials: measured.materials,
  textures: measured.textures,
  animations: measured.animations
};
assert(JSON.stringify(stats) === JSON.stringify(historicalLock.release.stats), "metadata_release_glb_stats_changed");

const historicalRelease = {
  sceneId: contract.sceneId,
  version: contract.version,
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  rightsStatus: rights.status,
  rightsApproved: rights.rightsApproved,
  rightsApprovalDate: rights.rightsOwnerVerdict.receivedOn,
  licenseRef: rights.licenseRef,
  isCurrent: false,
  publicationReady: false,
  renderMode: contract.renderMode,
  platformValidatorCommit: contract.toolchain.platformValidatorCommit,
  releasePath: `assets/scenes/${contract.sceneId}/${contract.version}`,
  files: historicalFiles,
  stats,
  reproducibility: historicalLock.reproducibility
};
const metadataRelease = {
  sceneId: contract.sceneId,
  version: releaseContract.version,
  baseVersion: releaseContract.baseVersion,
  releaseKind: releaseContract.releaseKind,
  status: releaseContract.status,
  humanAcceptance: releaseContract.humanAcceptance,
  rightsStatus: rights.status,
  rightsApproved: rights.rightsApproved,
  rightsApprovalDate: rights.rightsOwnerVerdict.receivedOn,
  licenseRef: rights.licenseRef,
  isCurrent: releaseContract.isCurrent,
  publicationReady: releaseContract.publicationReady,
  renderMode: releaseContract.renderMode,
  renderProfile: releaseContract.renderProfile,
  platformValidatorCommit: releaseContract.platformValidatorCommit,
  releasePath: `assets/scenes/${contract.sceneId}/${releaseContract.version}`,
  files: releaseFiles,
  stats,
  reproducibility: {
    scope: "same-input-two-run-metadata-only-release",
    runs: 2,
    result: "byte-identical-release-files",
    sourceVersion: releaseContract.baseVersion,
    unchangedPayloadSha256: Object.fromEntries(releaseContract.unchangedFiles.map((name) => [name, releaseFiles[name].sha256]))
  }
};
const manifest = {
  schemaVersion: 1,
  sceneId: contract.sceneId,
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  rightsStatus: rights.status,
  rightsApproved: rights.rightsApproved,
  rightsApprovalDate: rights.rightsOwnerVerdict.receivedOn,
  licenseRef: rights.licenseRef,
  publicationReady: false,
  platformValidatorCommit: releaseContract.platformValidatorCommit,
  releases: [historicalRelease, metadataRelease]
};
await writeJson(join(root, "manifest.json"), manifest);

const tooling = await Promise.all(toolingPaths.map(async (repositoryPath) => ({
  repositoryPath,
  ...await fileRecord(join(root, repositoryPath))
})));
const historicalEvidence = await Promise.all(historicalEvidencePaths.map(async (repositoryPath) => ({
  repositoryPath,
  ...await fileRecord(join(root, repositoryPath))
})));
const metadataOutputs = [
  ...requiredReleaseFiles.map((name) => `${metadataRelease.releasePath}/${name}`),
  "manifest.json"
];
const metadataReleaseLock = {
  schemaVersion: 1,
  sceneId: contract.sceneId,
  version: releaseContract.version,
  baseVersion: releaseContract.baseVersion,
  releaseKind: releaseContract.releaseKind,
  status: releaseContract.status,
  humanAcceptance: releaseContract.humanAcceptance,
  rightsStatus: rights.status,
  rightsApproved: rights.rightsApproved,
  rightsApprovalDate: rights.rightsOwnerVerdict.receivedOn,
  licenseRef: rights.licenseRef,
  isCurrent: releaseContract.isCurrent,
  publicationReady: releaseContract.publicationReady,
  renderMode: releaseContract.renderMode,
  renderProfile: releaseContract.renderProfile,
  historicalValidatorCommit: contract.toolchain.platformValidatorCommit,
  platformValidatorCommit: releaseContract.platformValidatorCommit,
  historicalReproducibility: releaseContract.historicalReproducibility,
  sourceContract: {
    path: "source/scene-contract.json",
    version: contract.version,
    role: "historical-authoring-source",
    ...await fileRecord(join(root, "source/scene-contract.json"))
  },
  releaseContract: {
    path: "source/metadata-release.json",
    ...await fileRecord(join(root, "source/metadata-release.json"))
  },
  historicalEvidence,
  tooling,
  historicalRelease: {
    path: historicalRelease.releasePath,
    files: historicalFiles
  },
  release: {
    path: metadataRelease.releasePath,
    files: releaseFiles,
    stats
  },
  unchangedPayload: Object.fromEntries(releaseContract.unchangedFiles.map((name) => [name, {
    historical: historicalFiles[name],
    release: releaseFiles[name]
  }])),
  reproducibility: metadataRelease.reproducibility,
  outputs: await Promise.all(metadataOutputs.map(async (repositoryPath) => ({
    repositoryPath,
    ...await fileRecord(join(root, repositoryPath))
  }))),
  boundaries: contract.releaseBoundary
};
await writeJson(join(root, "source/metadata-release-lock.json"), metadataReleaseLock);

const glbRecord = releaseFiles["scene.glb"];
process.stdout.write(`Built ${contract.sceneId}@${releaseContract.version} metadata-only review release from ${contract.version}\n`);
process.stdout.write(`GLB ${glbRecord.sizeBytes} bytes sha256=${glbRecord.sha256} (identical to ${contract.version})\n`);
process.stdout.write(`Stats ${JSON.stringify(stats)}\n`);
