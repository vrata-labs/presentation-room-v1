import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import validator from "gltf-validator";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const version = "0.4.1";
const pin = "a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d";
const json = path => readFile(path, "utf8").then(JSON.parse);
const record = async path => { const bytes = await readFile(path); return { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length }; };
const repository = await json(join(root, "scene-repository.json"));
const sceneId = repository.sceneId;
assert(["personal-workspace-v1", "presentation-room-v1"].includes(sceneId), "scene_identity");
const personal = sceneId === "personal-workspace-v1";
const historical = personal ? "a13fb5ab5fefc50a64d3b0634deb1220cf6138a8" : "92a6b567aeefbaee9e49007125ff84ff9ea7cd44";
const sourcePath = `source/releases/${version}`;
const provenancePath = `provenance/releases/${version}`;
const releasePath = `assets/scenes/${sceneId}/${version}`;
const capturePath = `provenance/runtime-capture-${version}`;
const lockName = personal ? "review-source-lock.json" : "accepted-source-lock.json";
function git(args, options = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16*1024*1024, ...options });
  assert.equal(result.status, 0, result.stderr ?? "git_query_failed");
  return result.stdout;
}
async function verifyRecord(value) {
  assert(typeof value.path === "string" && !value.path.startsWith("/") && !value.path.split("/").includes("..") && !value.path.includes("\\"), "unsafe_record_path");
  assert.deepEqual(await record(join(root, value.path)), { sha256: value.sha256, sizeBytes: value.sizeBytes }, `record_drift:${value.path}`);
}
async function paths(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(entry.name !== "__pycache__" && !entry.name.endsWith(".pyc"), "python_cache_forbidden");
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await paths(path));
    else { assert(entry.isFile(), "unsupported_entry"); result.push(relative(root, path)); }
  }
  return result.sort();
}
function reviewGates(value) {
  assert.equal(value.isCurrent, false, "current_release_not_authorized");
  assert.equal(value.publicationReady, false, "promotion_not_authorized");
  if (value.humanAcceptance !== undefined) assert.equal(value.humanAcceptance, "pending-human-acceptance");
  if (value.visualAccepted !== undefined) assert.equal(value.visualAccepted, false);
}

const manifest = await json(join(root, "manifest.json"));
const packageJson = await json(join(root, "package.json"));
assert.equal(repository.releaseVersion, version);
assert.equal(packageJson.version, version);
assert.equal(packageJson.name, `@vrata/${sceneId}`);
assert.equal(repository.oneSceneOnly, true);
assert.equal(repository.platformValidatorCommit, pin);
assert.equal((await readFile(join(root, "platform-validator.lock"), "utf8")).trim(), pin);
assert.equal(manifest.platformValidatorCommit, pin);
const previous = JSON.parse(git(["show", `${historical}:manifest.json`]));
assert.deepEqual(manifest.releases.slice(0, previous.releases.length), previous.releases, "historical_release_records_changed");
assert.deepEqual(manifest.releases.map(item => item.version), ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0", version]);
assert.deepEqual((await readdir(join(root, "assets/scenes"))).sort(), [sceneId]);
assert.deepEqual((await readdir(join(root, "assets/scenes", sceneId))).sort(), manifest.releases.map(item => item.version).sort());
// Verify the current checkout's historical bytes as well as replaying historical
// validators in their own pinned root. New root tooling is not old evidence.
const oldEntries = git(["ls-tree", "-r", "-z", historical, "--", "assets/scenes", "source", "provenance"])
  .split("\0").filter(Boolean).map(line => { const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(line); assert(match); return { oid: match[1], path: match[2] }; })
  .filter(item => item.path !== "source/release-acceptance-index.json");
const actualOids = git(["hash-object", "--no-filters", "--stdin-paths"], { input: oldEntries.map(item => item.path).join("\n")+"\n" }).trim().split("\n");
assert.deepEqual(actualOids, oldEntries.map(item => item.oid), "historical_source_or_artifact_bytes_changed");
const index = await json(join(root, "source/release-acceptance-index.json"));
const oldIndex = JSON.parse(git(["show", `${historical}:source/release-acceptance-index.json`]));
assert.deepEqual(index.releases.slice(0, oldIndex.releases.length), oldIndex.releases, "historical_acceptance_changed");

const ledger = await json(join(root, provenancePath, "release-ledger.json"));
const lock = await json(join(root, sourcePath, lockName));
const entry = manifest.releases.at(-1);
const scene = await json(join(root, releasePath, "scene.json"));
for (const value of [entry, ledger, lock, scene]) { reviewGates(value); assert.equal(value.sceneId, sceneId); }
assert.equal(scene.version, version);
assert.equal(scene.status, "review");
assert.equal(entry.status, "review");
for (const value of [repository, manifest, index.releases.at(-1)]) reviewGates(value);
assert.equal(scene.rights.approvalStatus, "approved-for-public-staging-review");
assert.equal(scene.rights.rightsApproved, true);
assert.equal(lock.platformValidatorCommit, pin);
assert.equal(lock.qualityOutcome, "READY_FOR_USER_REVIEW");
assert.equal(ledger.qualityOutcome, "READY_FOR_USER_REVIEW");
assert.deepEqual((await readdir(join(root, releasePath))).sort(), ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]);
for (const [name, expected] of Object.entries(ledger.files)) assert.deepEqual(await record(join(root, releasePath, name)), expected, `release_bytes:${name}`);
assert.deepEqual(entry.files, ledger.files);
assert.deepEqual(entry.stats, ledger.stats);
await verifyRecord(ledger.sourceLock);
await verifyRecord(lock.baseSourceLock);
assert.deepEqual((await paths(join(root, sourcePath))).filter(path => basename(path) !== lockName), lock.sourceFiles.map(item => item.path));
for (const item of [...lock.sourceFiles, ...ledger.evidenceFiles]) await verifyRecord(item);
assert.deepEqual([...await paths(join(root, provenancePath)), ...await paths(join(root, capturePath))].filter(path => basename(path) !== "release-ledger.json").sort(), ledger.evidenceFiles.map(item => item.path).sort(), "evidence_inventory_drift");
const privateRoots = ["tmp", "home", "mnt", "Users", "private/tmp"].map(value => `/${value}/`);
for (const item of lock.sourceFiles) {
  const data = await readFile(join(root, item.path));
  assert(!privateRoots.some(value => data.includes(Buffer.from(value))), `nonportable_source:${item.path}`);
}
const indexEntry = index.releases.at(-1);
assert.equal(indexEntry.version, version);
assert.equal(indexEntry.lockSha256, (await record(join(root, sourcePath, lockName))).sha256);
assert.equal(indexEntry.releaseLedgerSha256, (await record(join(root, provenancePath, "release-ledger.json"))).sha256);

const [quality, reproduction, authorization, registry, geometry, support, clean, normal, runs] = await Promise.all([
  json(join(root, provenancePath, "quality-review.json")), json(join(root, provenancePath, "reproducibility.json")),
  json(join(root, provenancePath, "rights-review-authorization.json")), json(join(root, sourcePath, "object-registry.json")),
  json(join(root, provenancePath, "geometry-measurements.json")), json(join(root, provenancePath, "support-measurements.json")),
  json(join(root, capturePath, "clean/capture-settings.json")), json(join(root, capturePath, "normal-product/normal-product-evidence.json")),
  json(join(root, provenancePath, "local-run-results.json"))
]);
assert.equal(quality.qualityOutcome, "READY_FOR_USER_REVIEW");
assert.equal(quality.humanAcceptance, "pending-human-acceptance");
assert.deepEqual(quality.unresolvedQualityBlockers, []);
assert.equal(authorization.userDecision, "Да, разрешаю review-публикацию");
assert.equal(authorization.glbSha256, ledger.files["scene.glb"].sha256);
assert.equal(reproduction.result, "passed");
assert.deepEqual(reproduction.expected, ledger.files["scene.glb"]);
assert.deepEqual(reproduction.runs[0], reproduction.runs[1]);
assert.deepEqual(reproduction.source, await record(join(root, sourcePath, "baked-source.blend")));
assert.deepEqual(reproduction.atlas, await record(join(root, sourcePath, "lightmap.png")));
assert.deepEqual(reproduction.exporter, await record(join(root, sourcePath, "export-scene.py")));
assert.deepEqual(reproduction.finalizer, await record(join(root, sourcePath, "finalize-glb.mjs")));
assert.equal(packageJson.devDependencies["@gltf-transform/cli"], "4.4.2");
assert.equal(packageJson.devDependencies.meshoptimizer, "1.0.1");
for (const report of [geometry, support]) assert.equal(report.sourceBlendSha256, (await record(join(root, sourcePath, "draft-scene.blend"))).sha256);
assert.equal(geometry.registrySha256, (await record(join(root, sourcePath, "object-registry.json"))).sha256);
assert.equal(geometry.screenVisibility.allClear, true, "screen_visibility_failed");
assert.equal(geometry.screenVisibility.rays.length, (personal ? 1 : 8)*5, "screen_visibility_coverage");
assert(geometry.screenVisibility.rays.every(ray => ray.clear && ray.obstruction === null), "screen_visibility_failed");
assert.equal(geometry.userClearances.routes.length, personal ? 2 : 9, "route_coverage");
assert(geometry.userClearances.routes.every(route => route.clear && route.minimumClearanceM >= route.actorRadiusM), "route_clearance_failed");
if (personal) {
  assert.equal(geometry.userClearances.kneeEnvelope.clear, true);
  assert.equal(geometry.userClearances.spawnOpenRadius.clear, true);
  assert.equal(geometry.userClearances.plantRouteClearance.clear, true);
  assert.equal(geometry.userClearances.handReach.length, 4);
  assert(geometry.userClearances.handReach.every(target => target.reachable && target.distanceM <= target.maximumReachM), "hand_reach_failed");
} else {
  assert.equal(geometry.userClearances.sitStandSweeps.length, 8);
  assert(geometry.userClearances.sitStandSweeps.every(sweep => sweep.clear && sweep.minimumClearanceM >= sweep.bodyRadiusM), "sit_stand_failed");
}
for (const errors of Object.values(support.failures)) assert.deepEqual(errors, []);
if (personal) assert.deepEqual((await json(join(root, provenancePath, "arrangement-measurements.json"))).failures, []);
const enclosure = await json(join(root, sourcePath, "lightmap-raw.enclosure.json"));
assert.equal(enclosure.nonmanifoldEdges, 0);
assert(Math.abs(enclosure.actualVolumeM3-enclosure.expectedUnionVolumeM3) < 1e-3);
if (!personal) assert.equal((await json(join(root, sourcePath, "lightmap-raw.uv.json"))).overlappingCentroids, 0);

const views = (await json(join(root, sourcePath, "capture-config.json"))).reviewViews.map(view => view.id).sort();
const sourceRender = await json(join(root, sourcePath, "review/source-render-settings.json"));
assert.equal(sourceRender.sourceBlendSha256, (await record(join(root, sourcePath, "draft-scene.blend"))).sha256);
assert.equal(sourceRender.renderScriptSha256, (await record(join(root, sourcePath, "render-review.py"))).sha256);
assert.deepEqual(clean.views.map(view => view.id).sort(), views);
assert.deepEqual(clean.cameraEvidence.map(view => view.id).sort(), views);
for (const view of clean.views) {
  const camera = clean.cameraEvidence.find(item => item.id === view.id).actualCamera;
  const delta = ["x", "y", "z"].map(axis => view.target[axis]-view.position[axis]);
  const length = Math.hypot(...delta);
  for (const [index, axis] of ["x", "y", "z"].entries()) {
    assert(Math.abs(camera.world[axis]-view.position[axis]) < .002, "capture_camera_position");
    assert(Math.abs(camera.forward[axis]-delta[index]/length) < .002, "capture_camera_direction");
  }
}
for (const capture of [clean, normal]) {
  assert.equal(capture.glbSha256, ledger.files["scene.glb"].sha256);
  assert.equal(capture.captureBinding.runtimePlatformCommit, pin);
  assert.equal(capture.captureBinding.manifestSha256, ledger.files["scene.json"].sha256);
  assert.equal(capture.captureBinding.configSha256, (await record(join(root, sourcePath, "capture-config.json"))).sha256);
  assert.equal(capture.captureBinding.baseSha256, (await record(join(root, sourcePath, "scene-quality-0.4.1-base.ts"))).sha256);
  assert.equal(capture.captureBinding.runnerSha256, (await record(join(root, sourcePath, "scene-quality-0.4.1-local.spec.ts"))).sha256);
}
assert.equal(normal.verdict, "functional-checks-passed");
assert.equal(normal.seats.length, personal ? 1 : 8);
assert.deepEqual(normal.seats.map(seat => seat.seatId).sort(), scene.anchors.seatAnchors.map(seat => seat.id).sort());
assert(normal.seats.every(seat => seat.authoritativeClaimAndRelease && seat.seatedMovementLocked && Math.abs(seat.afterRelease.root.y) < .01), "authoritative_seat_release_failed");
assert.equal(normal.syntheticReviewPoseUsed, false);
assert(runs.runs.length === 2 && runs.runs.every(run => run.stats.expected === 1 && run.stats.unexpected === 0 && run.stats.flaky === 0 && run.stats.skipped === 0));
for (const run of runs.runs) assert.deepEqual(run.captureBinding, run.mode === "clean" ? clean.captureBinding : normal.captureBinding, "runner_capture_binding");
const content = await json(join(root, capturePath, "normal-product", personal ? "rendered-workspace-content.json" : "rendered-media-frames.json"));
assert.deepEqual(content.captureBinding, normal.captureBinding);
if (personal) assert(content.board.notes.some(note => note.text.includes("Workspace review 0.4.1")));
else assert(content.after.videos.some(video => video.width > 0 && video.height > 0 && video.time > 0));
const diagnostics = await json(join(root, capturePath, "clean/scene-debug.json"));
assert.equal(diagnostics.state, "loaded");
assert.equal(diagnostics.failureReason, null);
assert.deepEqual(diagnostics.missingAssets, []);
assert.equal(diagnostics.assetBytesLoaded, ledger.files["scene.glb"].sizeBytes);
assert.equal(diagnostics.renderProfile, "baked-pbr-v1");

const bytes = await readFile(join(root, releasePath, "scene.glb"));
const validation = await validator.validateBytes(bytes, { maxIssues: 100000 });
assert.equal(validation.issues.numErrors, 0); assert.equal(validation.issues.numWarnings, 0);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.read(join(root, releasePath, "scene.glb"));
const r = document.getRoot();
const primitives = r.listMeshes().flatMap(mesh => mesh.listPrimitives());
const stats = { triangles: primitives.reduce((sum, p) => sum+(p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount())/3, 0), objects: r.listNodes().length, meshes: r.listMeshes().length,
  primitives: primitives.length, materials: r.listMaterials().length, textures: r.listTextures().length, animations: r.listAnimations().length, scenes: r.listScenes().length };
assert.deepEqual(stats, ledger.stats);
assert(bytes.length <= 15728640 && stats.triangles <= 90000 && stats.meshes <= 250 && stats.primitives <= 250 && stats.materials <= 96 && stats.textures <= 48, "budget_exceeded");
assert.equal(diagnostics.meshCount, stats.primitives);
const cards = new Map(registry.objects.map(card => [card.objectId, card]));
const exportGeometry = await json(join(root, provenancePath, "export-geometry.json"));
assert.equal(exportGeometry.sourceBlendSha256, (await record(join(root, sourcePath, "baked-source.blend"))).sha256);
const covered = new Set();
for (const node of r.listNodes().filter(node => node.getMesh())) {
  const extras = node.getExtras();
  assert.equal(extras.vrataAuthoringRelease, version);
  assert.equal(extras.vrataAssetOrigin, "project-authored");
  const card = cards.get(extras.vrataObjectId);
  assert(card, `unknown_object:${node.getName()}`);
  const names = card.parts.includes(node.getName()) ? [node.getName()] : JSON.parse(extras.vrataConstituentParts ?? "null");
  assert(Array.isArray(names) && names.length, "unmapped_assembly");
  for (const name of names) { assert(card.parts.includes(name) && !covered.has(name), `part_coverage:${name}`); covered.add(name); }
  const boxes = names.map(name => exportGeometry.parts[name]);
  assert(boxes.every(Boolean), "source_geometry_missing");
  const lo = [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis])));
  const hi = [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis])));
  const expected = [[lo[0], lo[2], -hi[1]], [hi[0], hi[2], -lo[1]]];
  const actual = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  const m = node.getWorldMatrix();
  for (const primitive of node.getMesh().listPrimitives()) {
    const array = primitive.getAttribute("POSITION").getArray();
    for (let index = 0; index < array.length; index += 3) {
      const point = [0, 1, 2].map(axis => m[axis]*array[index]+m[4+axis]*array[index+1]+m[8+axis]*array[index+2]+m[12+axis]);
      for (let axis = 0; axis < 3; axis++) { actual[0][axis] = Math.min(actual[0][axis], point[axis]); actual[1][axis] = Math.max(actual[1][axis], point[axis]); }
    }
  }
  for (let side = 0; side < 2; side++) for (let axis = 0; axis < 3; axis++) assert(Math.abs(actual[side][axis]-expected[side][axis]) < 1e-4, `export_bounds_drift:${node.getName()}`);
  for (const primitive of node.getMesh().listPrimitives()) {
    if (extras.vrataBakePolicy === "include") {
      assert(primitive.getAttribute("TEXCOORD_1"), "lightmap_uv_missing");
      assert.equal(primitive.getMaterial().getExtras().vrataLightMap, true);
      assert.equal(primitive.getMaterial().getEmissiveTextureInfo().getTexCoord(), 1);
    }
  }
}
assert.deepEqual([...covered].sort(), registry.objects.flatMap(card => card.parts).sort());
console.log(`${sceneId}@${version}: exact source/release/capture bytes, history, ${stats.triangles} triangles, ${stats.primitives} primitives, rights scope and pending human visual gate verified.`);
