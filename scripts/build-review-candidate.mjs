import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  assert,
  fileRecord,
  glbInspection,
  readJson,
  resolveBlenderExecutable,
  run,
  sha256,
  toRuntimePosition,
  verifyBlender,
  writeJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = resolveBlenderExecutable();
const contract = await readJson(join(root, "source/scene-contract.json"));
const rights = contract.rights;
const releasePath = join(root, "assets/scenes", contract.sceneId, contract.version);
const buildPath = join(root, "build");
const pngPath = join(buildPath, "review-png");
const reviewPath = join(root, "source/review");
const blendPath = join(root, "source/review-candidate.blend");
const authorGlb = join(buildPath, "author.glb");
const firstGlb = join(buildPath, "export-first.glb");
const secondGlb = join(buildPath, "export-second.glb");
const reviewViews = contract.reviewViews.map(({ id }) => id);

verifyBlender(blender);
await rm(buildPath, { recursive: true, force: true });
await rm(releasePath, { recursive: true, force: true });
await rm(reviewPath, { recursive: true, force: true });
await mkdir(pngPath, { recursive: true });
await mkdir(reviewPath, { recursive: true });
await mkdir(releasePath, { recursive: true });

run(blender, [
  "--background",
  "--factory-startup",
  "--python",
  join(root, "source/author_scene.py"),
  "--",
  "--blend",
  blendPath,
  "--glb",
  authorGlb,
  "--review-dir",
  pngPath
]);

function exportSavedBlend(output) {
  run(blender, [
    "--background",
    blendPath,
    "--python",
    join(root, "source/export_scene.py"),
    "--",
    "--output",
    output
  ]);
}

exportSavedBlend(firstGlb);
exportSavedBlend(secondGlb);
const [authorBytes, firstBytes, secondBytes] = await Promise.all([
  readFile(authorGlb),
  readFile(firstGlb),
  readFile(secondGlb)
]);
assert(authorBytes.equals(firstBytes), "author_and_saved_blend_export_differ");
assert(firstBytes.equals(secondBytes), "same_host_two_run_glb_not_byte_identical");
await copyFile(firstGlb, join(releasePath, "scene.glb"));

for (const viewId of reviewViews) {
  run("cwebp", ["-quiet", "-q", "90", join(pngPath, `${viewId}.png`), "-o", join(reviewPath, `${viewId}.webp`)]);
}
await copyFile(join(reviewPath, "entry.webp"), join(releasePath, "preview.webp"));
await copyFile(join(root, "provenance/LICENSES.review.md"), join(releasePath, "LICENSES.md"));

const glbPath = join(releasePath, "scene.glb");
const glbRecord = await fileRecord(glbPath);
const measured = await glbInspection(glbPath);
const stats = {
  triangles: measured.triangles,
  objects: measured.objects,
  meshes: measured.meshes,
  primitives: measured.primitives,
  materials: measured.materials,
  textures: measured.textures,
  animations: measured.animations
};

const sceneManifest = {
  schemaVersion: 1,
  sceneId: contract.sceneId,
  version: contract.version,
  label: "Presentation Room",
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  publicationReady: false,
  renderMode: contract.renderMode,
  glbPath: "scene.glb",
  glbSha256: glbRecord.sha256,
  preview: "preview.webp",
  source: "source/review-candidate.blend",
  productPurpose: contract.productPurpose,
  bounds: {
    width: contract.room.widthM,
    height: contract.room.heightM,
    depth: contract.room.depthM
  },
  coordinateAdapter: contract.coordinateAdapter,
  spawnPoints: [{
    id: contract.spawn.id,
    position: toRuntimePosition(contract.spawn.position),
    yaw: contract.spawn.yaw,
    openRadiusM: contract.spawn.openRadiusM
  }],
  anchors: {
    seatAnchors: contract.seats.map((seat) => ({
      id: seat.id,
      row: seat.row,
      position: toRuntimePosition(seat.position),
      yaw: seat.yaw,
      seatHeight: seat.seatHeight,
      radius: seat.radius,
      visible: seat.visible,
      aimTargetSurfaceId: seat.aimTargetSurfaceId
    }))
  },
  mediaSurfaces: contract.mediaSurfaces.map((surface) => ({
    surfaceId: surface.surfaceId,
    purpose: surface.purpose,
    widthM: surface.widthM,
    heightM: surface.heightM,
    aspectRatio: surface.aspectRatio,
    visible: surface.visible,
    transform: { ...toRuntimePosition(surface.position), yaw: surface.yaw }
  })),
  circulation: contract.circulation,
  stats,
  rights: {
    status: rights.status,
    rightsApproved: rights.rightsApproved,
    rightsOwnerVerdict: rights.rightsOwnerVerdict,
    ownershipBasis: rights.ownershipBasis,
    externalAssetsUsed: rights.externalAssetsUsed,
    licenseRef: rights.licenseRef,
    licenseFile: "LICENSES.md",
    sourceLedger: "provenance/asset-ledger.json",
    clearedFor: rights.allowedUses,
    notGrantedByThisVerdict: rights.notGrantedByThisVerdict
  }
};
await writeJson(join(releasePath, "scene.json"), sceneManifest);

const releaseFiles = {};
for (const name of ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]) {
  releaseFiles[name] = await fileRecord(join(releasePath, name));
}

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
  platformValidatorCommit: contract.toolchain.platformValidatorCommit,
  releases: [{
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
    releasePath: `assets/scenes/${contract.sceneId}/${contract.version}`,
    files: releaseFiles,
    stats,
    reproducibility: {
      scope: "same-host-same-saved-blend-same-blender-binary-two-run",
      runs: 2,
      result: "byte-identical-glb",
      sha256: glbRecord.sha256
    }
  }]
};
await writeJson(join(root, "manifest.json"), manifest);

const toolingPaths = [
  "scripts/lib.mjs",
  "scripts/build-review-candidate.mjs",
  "scripts/inspect-release.mjs",
  "scripts/validate-repository.mjs",
  "scripts/verify-reproducibility.mjs",
  "tests/repository.test.mjs"
];
const sourceRecords = [
  { repositoryPath: "source/scene-contract.json", kind: "project-authored-scene-source" },
  { repositoryPath: "source/author_scene.py", kind: "project-authored-scene-source" },
  { repositoryPath: "source/export_scene.py", kind: "project-authored-scene-source" },
  { repositoryPath: "source/render_review.py", kind: "project-authored-scene-source" },
  { repositoryPath: "provenance/rights-status.json", kind: "human-rights-owner-verdict" },
  { repositoryPath: "provenance/LICENSES.review.md", kind: "license-notice" },
  ...toolingPaths.map((repositoryPath) => ({ repositoryPath, kind: "repository-tooling" }))
];
const assetLedger = {
  schemaVersion: 1,
  sceneId: contract.sceneId,
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  rightsStatus: rights.status,
  rightsApproved: rights.rightsApproved,
  rightsOwnerVerdict: rights.rightsOwnerVerdict,
  licenseRef: rights.licenseRef,
  licensePath: rights.licensePath,
  externalAssetsUsed: rights.externalAssetsUsed,
  records: []
};
for (const { repositoryPath, kind } of sourceRecords) {
  assetLedger.records.push({
    id: `project-authored:${repositoryPath}`,
    kind,
    repositoryPath,
    ...await fileRecord(join(root, repositoryPath)),
    externalSource: null,
    rightsStatus: rights.status,
    licenseRef: rights.licenseRef
  });
}
await writeJson(join(root, "provenance/asset-ledger.json"), assetLedger);

const generatedPaths = [
  "source/review-candidate.blend",
  ...reviewViews.map((viewId) => `source/review/${viewId}.webp`),
  `assets/scenes/${contract.sceneId}/${contract.version}/scene.glb`,
  `assets/scenes/${contract.sceneId}/${contract.version}/scene.json`,
  `assets/scenes/${contract.sceneId}/${contract.version}/preview.webp`,
  `assets/scenes/${contract.sceneId}/${contract.version}/LICENSES.md`
];
const generationLedger = {
  schemaVersion: 1,
  sceneId: contract.sceneId,
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  rightsStatus: rights.status,
  rightsApproved: rights.rightsApproved,
  rightsOwnerVerdict: rights.rightsOwnerVerdict,
  licenseRef: rights.licenseRef,
  method: "scene-specific procedural Blender authoring from the product brief",
  agent: "OpenCode",
  externalAssetsUsed: false,
  downloadedReferencesUsed: false,
  tooling: await Promise.all(toolingPaths.map(async (repositoryPath) => ({
    repositoryPath,
    ...await fileRecord(join(root, repositoryPath))
  }))),
  outputs: []
};
for (const repositoryPath of generatedPaths) {
  generationLedger.outputs.push({ repositoryPath, ...await fileRecord(join(root, repositoryPath)) });
}
await writeJson(join(root, "provenance/generation-ledger.json"), generationLedger);

const sourceLock = {
  schemaVersion: 1,
  sceneId: contract.sceneId,
  version: contract.version,
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  rightsStatus: rights.status,
  rightsApproved: rights.rightsApproved,
  rightsApprovalDate: rights.rightsOwnerVerdict.receivedOn,
  licenseRef: rights.licenseRef,
  publicationReady: false,
  renderMode: contract.renderMode,
  toolchain: contract.toolchain,
  coordinateTransform: "x=x,y=y,z=-z",
  source: {
    blendPath: "source/review-candidate.blend",
    blend: await fileRecord(blendPath),
    authorScript: await fileRecord(join(root, "source/author_scene.py")),
    exportScript: await fileRecord(join(root, "source/export_scene.py")),
    renderScript: await fileRecord(join(root, "source/render_review.py"))
  },
  tooling: await Promise.all(toolingPaths.map(async (repositoryPath) => ({
    repositoryPath,
    ...await fileRecord(join(root, repositoryPath))
  }))),
  reviewViews: await Promise.all(reviewViews.map(async (id) => ({
    id,
    path: `source/review/${id}.webp`,
    ...await fileRecord(join(reviewPath, `${id}.webp`))
  }))),
  release: {
    path: `assets/scenes/${contract.sceneId}/${contract.version}`,
    files: releaseFiles,
    stats
  },
  reproducibility: manifest.releases[0].reproducibility,
  boundaries: contract.releaseBoundary
};
await writeJson(join(root, "source/review-candidate-lock.json"), sourceLock);

process.stdout.write(`Built ${contract.sceneId}@${contract.version} review candidate\n`);
process.stdout.write(`GLB ${glbRecord.sizeBytes} bytes sha256=${glbRecord.sha256}\n`);
process.stdout.write(`Stats ${JSON.stringify(stats)}\n`);
