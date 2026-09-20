import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RuntimeTestApi } from "../../apps/runtime-web/src/testing/runtime-test-api.js";

type Point = { x: number; y: number; z: number };
type NormalDebug = {
  participantId: string;
  roomStateConnected: boolean;
  currentSeatId: string | null;
  pendingSeatId: string | null;
  seatOccupancy: Record<string, string>;
  featureFlags: { avatarSeatingEnabled: boolean };
  localPose: { root: Point & { yaw: number }; head: Point };
  sceneDebug: { state: string; spawnApplied: boolean; spawnPointId: string; camera: { world: Point; forward: Point } };
  mediaObjects: {
    physicalSurfaceIdsWithoutLogicalState: string[];
    blockedReason: string | null;
    surfaces: Array<{ surfaceId: string; widthM: number; heightM: number; widthPx: number; heightPx: number; worldPosition: Point; runtimeVisible: boolean; activeObjectType: string | null }>;
  };
};

async function normalDebug(page: Page): Promise<NormalDebug> {
  return page.evaluate(() => {
    const debug = (window as Window & { __VRATA_DEBUG__: NormalDebug }).__VRATA_DEBUG__;
    return { participantId: debug.participantId, roomStateConnected: debug.roomStateConnected, currentSeatId: debug.currentSeatId, pendingSeatId: debug.pendingSeatId, seatOccupancy: debug.seatOccupancy, featureFlags: debug.featureFlags, localPose: debug.localPose, sceneDebug: debug.sceneDebug && { state: debug.sceneDebug.state, spawnApplied: debug.sceneDebug.spawnApplied, spawnPointId: debug.sceneDebug.spawnPointId, camera: debug.sceneDebug.camera }, mediaObjects: debug.mediaObjects && { physicalSurfaceIdsWithoutLogicalState: debug.mediaObjects.physicalSurfaceIdsWithoutLogicalState, blockedReason: debug.mediaObjects.blockedReason, surfaces: debug.mediaObjects.surfaces } };
  });
}

async function verifyNormalProduct(page: Page, manifest: any, output: string, manifestBytes: Buffer) {
  const evidence: Record<string, unknown> = { platformCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), glbSha256: manifest.glbSha256, syntheticReviewPoseUsed: false, seats: [] };
  const seats = evidence.seats as Array<Record<string, unknown>>;
  const observer = await page.context().newPage();
  await observer.setViewportSize({ width: 320, height: 200 });
  try {
    const spawn = manifest.spawnPoints[0];
    await expect.poll(async () => (await normalDebug(page)).roomStateConnected, { timeout: 30_000 }).toBe(true);
    const initial = await normalDebug(page);
    evidence.spawn = initial;
    expect(initial.sceneDebug.spawnApplied).toBe(true);
    expect(initial.sceneDebug.spawnPointId).toBe(spawn.id);
    for (const axis of ["x", "y", "z"] as const) expect(initial.localPose.root[axis]).toBeCloseTo(spawn.position[axis], 2);
    expect(Math.atan2(Math.sin(initial.localPose.root.yaw - spawn.yaw), Math.cos(initial.localPose.root.yaw - spawn.yaw))).toBeCloseTo(0, 2);
    expect(initial.sceneDebug.camera.world.y).toBeCloseTo(spawn.position.y + 1.6, 2);
    expect(initial.featureFlags.avatarSeatingEnabled).toBe(true);
    await page.screenshot({ path: resolve(output, "normal-spawn.png") });
    for (const expected of manifest.mediaSurfaces) {
      const surface = initial.mediaObjects.surfaces.find(surface => surface.surfaceId === expected.surfaceId);
      expect(surface, expected.surfaceId).toBeDefined();
      expect(surface!.runtimeVisible).toBe(true);
      for (const field of ["widthM", "heightM", "widthPx", "heightPx"] as const) expect(surface![field]).toBe(expected[field]);
      for (const axis of ["x", "y", "z"] as const) expect(surface!.worldPosition[axis]).toBeCloseTo(expected.transform[axis], 2);
    }
    await observer.addInitScript(() => sessionStorage.setItem("vrata.participantId", `observer-${crypto.randomUUID()}`));
    await observer.goto(page.url(), { waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await normalDebug(observer)).roomStateConnected, { timeout: 60_000 }).toBe(true);
    expect((await normalDebug(observer)).participantId).not.toBe(initial.participantId);
    for (const anchor of manifest.anchors.seatAnchors) {
      expect(await page.evaluate(id => (window as Window & { __VRATA_TEST__: RuntimeTestApi }).__VRATA_TEST__.requestSeatClaimById(id), anchor.id)).toBe(true);
      await expect.poll(async () => {
        const [local, remote] = await Promise.all([normalDebug(page), normalDebug(observer)]);
        return { seat: local.currentSeatId, pending: local.pendingSeatId, localOccupant: local.seatOccupancy[anchor.id], remoteOccupant: remote.seatOccupancy[anchor.id] };
      }, { timeout: 20_000 }).toEqual({ seat: anchor.id, pending: null, localOccupant: initial.participantId, remoteOccupant: initial.participantId });
      await expect.poll(async () => {
        const debug = await normalDebug(page);
        return Math.hypot(debug.sceneDebug.camera.world.x - anchor.position.x, debug.sceneDebug.camera.world.z - anchor.position.z);
      }, { timeout: 20_000 }).toBeLessThan(.005);
      const claimed = await normalDebug(page);
      for (const axis of ["x", "z"] as const) expect(claimed.localPose.root[axis]).toBeCloseTo(anchor.position[axis], 2);
      await page.screenshot({ path: resolve(output, `normal-${anchor.id}.png`) });
      await page.keyboard.down("w");
      await page.waitForTimeout(350);
      await page.keyboard.up("w");
      const locked = await normalDebug(page);
      expect(locked.localPose.root).toEqual(claimed.localPose.root);
      const eyeHeightAboveSeatM = claimed.sceneDebug.camera.world.y - (anchor.position.y + anchor.seatHeight);
      // Anatomical DCC reference uses a 1.20m seated eye and a ~0.48m cushion.
      expect.soft(eyeHeightAboveSeatM, `seated eye above cushion at ${anchor.id}`).toBeGreaterThanOrEqual(.60);
      expect.soft(eyeHeightAboveSeatM, `seated eye above cushion at ${anchor.id}`).toBeLessThanOrEqual(.85);
      expect(await page.evaluate(position => (window as Window & { __VRATA_TEST__: RuntimeTestApi }).__VRATA_TEST__.teleportToFloor(position.x, position.z), spawn.position)).toBe(true);
      await expect.poll(async () => {
        const [local, remote] = await Promise.all([normalDebug(page), normalDebug(observer)]);
        return { seat: local.currentSeatId, localOccupant: local.seatOccupancy[anchor.id] ?? null, remoteOccupant: remote.seatOccupancy[anchor.id] ?? null };
      }, { timeout: 20_000 }).toEqual({ seat: null, localOccupant: null, remoteOccupant: null });
      await expect.configure({ soft: true }).poll(async () => {
        const debug = await normalDebug(page);
        return Math.hypot(debug.localPose.root.x - spawn.position.x, debug.localPose.root.y - spawn.position.y, debug.localPose.root.z - spawn.position.z);
      }, { timeout: 5_000 }).toBeLessThan(.005);
      seats.push({ seatId: anchor.id, authoritativeClaimAndRelease: true, seatedMovementLocked: true, localPose: claimed.localPose, actualCamera: claimed.sceneDebug.camera, eyeHeightAboveSeatM, afterRelease: (await normalDebug(page)).localPose });
    }
    await observer.close();
    const beforeWalking = (await normalDebug(page)).localPose.root;
    await page.keyboard.down("w");
    await page.waitForTimeout(350);
    await page.keyboard.up("w");
    const walked = await normalDebug(page);
    evidence.standingMovement = { from: beforeWalking, to: walked.localPose.root };
    expect(Math.hypot(walked.localPose.root.x - beforeWalking.x, walked.localPose.root.z - beforeWalking.z)).toBeGreaterThan(.1);
    const surfaceId = manifest.mediaSurfaces[0].surfaceId;
    const media = await normalDebug(page);
    evidence.physicalSurfacesMissingLogicalState = media.mediaObjects.physicalSurfaceIdsWithoutLogicalState;
    expect.soft(media.mediaObjects.physicalSurfaceIdsWithoutLogicalState).not.toContain(surfaceId);
    const objectType = manifest.sceneId === "personal-workspace-v1" ? "markdown-board" : "screen-share";
    expect(await page.evaluate(({ surfaceId, objectType }) => {
      const api = (window as Window & { __VRATA_TEST__: RuntimeTestApi }).__VRATA_TEST__;
      return objectType === "markdown-board" ? api.createMarkdownBoardObject(surfaceId) : api.createScreenShareObject(surfaceId);
    }, { surfaceId, objectType })).toBe(true);
    await expect.configure({ soft: true }).poll(async () => (await normalDebug(page)).mediaObjects.surfaces.find(surface => surface.surfaceId === surfaceId)?.activeObjectType, { timeout: 10_000 }).toBe(objectType);
    evidence.mediaAfterCreate = (await normalDebug(page)).mediaObjects;
    await page.screenshot({ path: resolve(output, "normal-media.png") });
  } finally {
    if (!observer.isClosed()) await observer.close();
    evidence.finalDebug = await normalDebug(page).catch(() => null);
    evidence.verdict = test.info().errors.length ? "REWORK_REQUIRED" : "functional-checks-passed";
    await writeFile(resolve(output, "normal-product-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}

function storedZip(files: Record<string, Buffer>) {
  const table = Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const filename = Buffer.from(name);
    let checksum = 0xffffffff;
    for (const byte of data) checksum = table[(checksum ^ byte) & 0xff]! ^ (checksum >>> 8);
    checksum = (checksum ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test("@private-assets @scene-quality local exact 0.4.0 source/runtime camera pairs", async ({ page, request, baseURL }) => {
  test.setTimeout(900_000);
  const directory = process.env.SCENE_QUALITY_DIR;
  test.skip(!directory, "No candidate directory supplied");
  const assetName = process.env.SCENE_QUALITY_ASSET ?? "scene.glb";
  const asset = await readFile(resolve(directory!, assetName));
  const manifestBytes = await readFile(resolve(directory!, "scene.json"));
  const original = JSON.parse(manifestBytes.toString("utf8"));
  expect(createHash("sha256").update(asset).digest("hex")).toBe(original.glbSha256);
  const config = JSON.parse(await readFile(resolve(directory!, "capture-config.json"), "utf8"));
  const output = resolve(directory!, process.env.SCENE_QUALITY_OUTPUT ?? "runtime");
  const wanted = new Set((process.env.SCENE_QUALITY_VIEWS ?? "").split(",").filter(Boolean));
  const views = config.reviewViews.filter((view: { id: string }) => !wanted.size || wanted.has(view.id));
  expect(views.length).toBeGreaterThan(0);
  const normal = process.env.SCENE_QUALITY_NORMAL === "1";
  expect(original.anchors.seatAnchors.map((seat: { id: string }) => seat.id)).toEqual(original.sceneId === "personal-workspace-v1" ? ["owner-desk-seat"] : Array.from({ length: 8 }, (_, i) => `seat-${String(i + 1).padStart(2, "0")}`));
  expect(original.mediaSurfaces.map((surface: { surfaceId: string }) => surface.surfaceId)).toEqual([original.sceneId === "personal-workspace-v1" ? "workspace-main" : "debug-main"]);
  const manifest = structuredClone(original);
  if (!normal) {
    delete manifest.anchors;
    manifest.mediaSurfaces = manifest.mediaSurfaces.map((surface: object) => ({ ...surface, visible: false }));
  }
  const token = process.env.STAGING_ADMIN_TOKEN ?? "test-admin-token";
  const bundleId = `quality-${original.sceneId}-${Date.now()}`;
  const response = await request.post("/api/scene-bundles/uploads", {
    headers: { "x-vrata-admin-token": token },
    multipart: {
      bundleId,
      version: "v1",
      bundle: {
        name: "bundle.zip",
        mimeType: "application/zip",
        buffer: storedZip({ "scene.json": normal ? manifestBytes : Buffer.from(JSON.stringify(manifest)), "scene.glb": asset, ...(manifest.preview ? { [manifest.preview]: await readFile(resolve(directory!, manifest.preview)) } : {}) })
      }
    }
  });
  expect(response.status(), JSON.stringify(await response.json())).toBe(201);
  const uploaded = await response.json();
  const created = await request.post("/api/rooms", {
    headers: { "x-vrata-admin-token": token },
    data: {
      tenantId: "demo-tenant",
      templateId: original.sceneId === "personal-workspace-v1" ? "personal-workspace-basic" : "event-demo-basic",
      name: `Quality ${original.sceneId}`,
      guestAllowed: true,
      sceneBundleUrl: new URL(new URL(uploaded.publicUrl).pathname, baseURL).href,
      avatarConfig: { avatarsEnabled: true, avatarFallbackCapsulesEnabled: false, avatarSeatsEnabled: normal }
    }
  });
  expect(created.ok()).toBe(true);
  const room = await created.json();
  const url = new URL(`/rooms/${room.roomId}`, baseURL);
  url.search = "?debug=1&scenefit=0";
  if (normal) url.searchParams.set("role", "host");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetchOriginal(...args);
      if (new URL(response.url).pathname.endsWith("/scene.glb") && response.ok) {
        void response.clone().arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(digest => {
          (window as Window & { __SCENE_RECEIVED_SHA256__?: string }).__SCENE_RECEIVED_SHA256__ = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        });
      }
      return response;
    };
  });
  const received = page.waitForResponse((candidate) => candidate.url().endsWith("scene.glb") && candidate.ok(), { timeout: 180_000 });
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  const glbResponse = await received;
  await glbResponse.finished();
  await expect.poll(() => page.evaluate(() => (window as Window & { __SCENE_RECEIVED_SHA256__?: string }).__SCENE_RECEIVED_SHA256__), { timeout: 30_000 }).toBe(original.glbSha256);
  await expect.poll(async () => (await normalDebug(page)).sceneDebug?.state, { timeout: 90_000 }).toBe("loaded");
  const initial = await page.evaluate(() => (window as Window & { __VRATA_DEBUG__?: { sceneDebug?: Record<string, unknown> } }).__VRATA_DEBUG__?.sceneDebug);
  expect(initial?.state).toBe("loaded");
  expect(initial?.missingAssets).toEqual([]);
  expect(initial?.assetBytesLoaded).toBe(asset.length);
  expect(initial?.renderProfile).toBe("baked-pbr-v1");
  await mkdir(output, { recursive: true });
  if (normal) {
    await verifyNormalProduct(page, original, output, manifestBytes);
    return;
  }
  await page.screenshot({ path: resolve(output, "clean-spawn.png") });
  await page.addStyleTag({ content: ".hud { display:none!important; }" });
  const settings = { environmentIntensity: Number(process.env.SCENE_QUALITY_ENV ?? ".35"), exposure: 1.2 };
  expect(await page.evaluate((value) => (window as Window & { __VRATA_TEST__?: { setSceneReviewRendering: (settings: typeof value) => boolean } }).__VRATA_TEST__?.setSceneReviewRendering(value), settings)).toBe(true);
  const cameraEvidence = [];
  for (const view of views) {
    const dx = view.target.x - view.position.x;
    const dy = view.target.y - view.position.y;
    const dz = view.target.z - view.position.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const pose = {
      id: view.id,
      position: {
        x: view.position.x - 1.6 * Math.sin(yaw) * Math.sin(pitch),
        y: view.position.y - 1.6 * Math.cos(pitch),
        z: view.position.z - 1.6 * Math.cos(yaw) * Math.sin(pitch)
      },
      yaw,
      pitch,
      fovDegrees: view.fovDegrees
    };
    expect(await page.evaluate((value) => (window as Window & { __VRATA_TEST__?: { setSceneReviewPose: (pose: typeof value) => boolean } }).__VRATA_TEST__?.setSceneReviewPose(value), pose)).toBe(true);
    await expect.poll(async () => page.evaluate((expected) => {
      const actual = (window as Window & { __VRATA_DEBUG__?: { sceneDebug?: { camera?: { world?: { x: number; y: number; z: number } } } } }).__VRATA_DEBUG__?.sceneDebug?.camera?.world;
      return actual ? Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) : 1000;
    }, view.position), { timeout: 30_000, intervals: [500, 1000, 2000] }).toBeLessThan(.002);
    const actualCamera = await page.evaluate(() => (window as Window & { __VRATA_DEBUG__?: { sceneDebug?: { camera?: unknown } } }).__VRATA_DEBUG__?.sceneDebug?.camera);
    const length = Math.hypot(dx, dy, dz);
    const forward = (actualCamera as { forward: { x: number; y: number; z: number } }).forward;
    expect(Math.hypot(forward.x - dx / length, forward.y - dy / length, forward.z - dz / length)).toBeLessThan(.002);
    cameraEvidence.push({ id: view.id, requestedEye: view.position, appliedRigPose: pose, actualCamera });
    await page.screenshot({ path: resolve(output, `${view.id}.png`) });
  }
  const diagnostics = await page.evaluate(() => (window as Window & { __VRATA_DEBUG__?: { sceneDebug?: unknown } }).__VRATA_DEBUG__?.sceneDebug);
  await writeFile(resolve(output, "scene-debug.json"), `${JSON.stringify(diagnostics, null, 2)}\n`);
  await writeFile(resolve(output, "capture-settings.json"), `${JSON.stringify({ ...settings, width: 1280, height: 800, glbSha256: createHash("sha256").update(asset).digest("hex"), views, cameraEvidence, normalProductMode: normal, qualityOutcome: "not-evaluated-by-this-test" }, null, 2)}\n`);
});
