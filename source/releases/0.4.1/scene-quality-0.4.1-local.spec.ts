import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import "./scene-quality-0.4.1-base.js";

test.use({ actionTimeout: 15_000 });

// Extend the preserved historical capture harness without editing its bytes.
// Local mock mode proves rendered frames, not WebRTC transport. Public review QA
// uses real transport with a generated capture source instead of an OS dialog.
test.beforeEach(async ({ page }) => {
  if (process.env.SCENE_QUALITY_NORMAL !== "1") return;
  await page.addInitScript(({ real }) => {
    if (location.pathname.startsWith("/rooms/") && !real) {
      const url = new URL(location.href);
      url.searchParams.set("sharemock", "1");
      history.replaceState(null, "", url);
    }
    const videos: HTMLVideoElement[] = [];
    const original = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = original(tag, options);
      if (tag.toLowerCase() === "video") videos.push(element as HTMLVideoElement);
      return element;
    }) as typeof document.createElement;
    (window as any).__reviewVideos = videos;
    if (real && navigator.mediaDevices) {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = original("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext("2d")!;
        let frame = 0;
        function draw() {
          frame++;
          context.fillStyle = "#173f69";
          context.fillRect(0, 0, 1280, 720);
          context.fillStyle = "#f4f2e8";
          context.font = "48px sans-serif";
          context.fillText("VRATA — PRESENTATION REVIEW", 80, 140);
          context.font = "32px sans-serif";
          context.fillText("Live screen-sharing frames", 80, 230);
          context.fillText(`Frame ${frame}`, 80, 300);
          context.fillStyle = "#56c8f0";
          context.fillRect(80 + frame % 500, 430, 240, 100);
          requestAnimationFrame(draw);
        }
        draw();
        return canvas.captureStream(24);
      };
    }
  }, { real: process.env.SCENE_QUALITY_SHARE_MODE === "real" });
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== "passed" || process.env.SCENE_QUALITY_NORMAL !== "1" || !process.env.SCENE_QUALITY_DIR) return;
  if (process.env.SCENE_QUALITY_SEAT_CYCLES || process.env.SCENE_QUALITY_RECONNECT_ON_RELEASE) return;
  const output = resolve(process.env.SCENE_QUALITY_DIR, process.env.SCENE_QUALITY_OUTPUT ?? "runtime");
  await mkdir(output, { recursive: true });
  if (process.env.SCENE_QUALITY_DIR.includes("personal-workspace")) {
    const text = "Workspace review 0.4.1 — a readable note on the work display";
    const surfaceSelect = page.locator('select:has(option[value="workspace-main"])');
    if (await surfaceSelect.inputValue() !== "workspace-main") await surfaceSelect.selectOption("workspace-main");
    await expect(surfaceSelect).toHaveValue("workspace-main");
    await page.getByLabel(/sticky note markdown/i).fill(text);
    await page.getByRole("button", { name: "Add Note", exact: true }).click({ noWaitAfter: true });
    await expect.poll(() => page.evaluate(() => ((window as any).__VRATA_DEBUG__.markdownBoard?.notes ?? []).map((note: any) => note.text)), { timeout: 15_000 }).toContain(text);
    await expect.poll(() => page.evaluate(() => (window as any).__VRATA_TEST__.getMediaCanvasRuntimeKinds("workspace-main"))).toContain("markdown-board");
    expect(await page.evaluate(() => (window as any).__VRATA_TEST__.requestSeatClaimById("owner-desk-seat"))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__VRATA_DEBUG__.currentSeatId), { timeout: 20_000 }).toBe("owner-desk-seat");
    await page.locator(".hud > summary").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".hud")).not.toHaveAttribute("open");
    await page.screenshot({ path: resolve(output, "normal-workspace-content.png"), timeout: 60_000 });
    await writeFile(resolve(output, "rendered-workspace-content.json"), JSON.stringify(await page.evaluate(() => ({
      seatId: (window as any).__VRATA_DEBUG__.currentSeatId,
      camera: (window as any).__VRATA_DEBUG__.sceneDebug.camera,
      board: (window as any).__VRATA_DEBUG__.markdownBoard,
      media: (window as any).__VRATA_DEBUG__.mediaObjects
    })).then(value => ({ captureBinding: JSON.parse(info.annotations.find(a => a.type === "scene-capture-binding")!.description!), ...value })), null, 2) + "\n");
    return;
  }
  if (!process.env.SCENE_QUALITY_DIR.includes("presentation-room")) return;
  await page.evaluate(() => (window as any).__VRATA_TEST__.stopActiveSurfaceObject());
  await expect.poll(() => page.evaluate(() => (window as any).__VRATA_DEBUG__.mediaObjects.surfaces.find((s: any) => s.surfaceId === "debug-main")?.activeObjectType)).toBe(null);
  await page.locator("#start-share").click();
  await expect.poll(() => page.evaluate(() => (window as any).__VRATA_DEBUG__.screenShare.localPublishing), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__VRATA_DEBUG__.mediaObjects.surfaces.find((surface: any) => surface.surfaceId === "debug-main")?.textureId), { timeout: 30_000 }).toBeTruthy();
  await expect.poll(() => page.evaluate(() => ((window as any).__reviewVideos as HTMLVideoElement[]).some(v => v.readyState >= 2 && v.videoWidth > 0 && v.currentTime > 0)), { timeout: 30_000 }).toBe(true);
  const before = await page.evaluate(() => ((window as any).__reviewVideos as HTMLVideoElement[]).filter(v => v.readyState >= 2).map(v => ({ width: v.videoWidth, height: v.videoHeight, time: v.currentTime })));
  await expect.poll(() => page.evaluate(() => Math.max(...((window as any).__reviewVideos as HTMLVideoElement[]).map(v => v.currentTime))), { timeout: 10_000 }).toBeGreaterThan(Math.max(...before.map(v => v.time)) + .2);
  expect(await page.evaluate(() => (window as any).__VRATA_TEST__.requestSeatClaimById("seat-04"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__VRATA_DEBUG__.currentSeatId), { timeout: 20_000 }).toBe("seat-04");
  await page.locator(".hud > summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".hud")).not.toHaveAttribute("open");
  await page.screenshot({ path: resolve(output, "normal-media-frames.png"), timeout: 60_000 });
  const evidence = await page.evaluate(() => ({
    share: (window as any).__VRATA_DEBUG__.screenShare,
    seatId: (window as any).__VRATA_DEBUG__.currentSeatId,
    camera: (window as any).__VRATA_DEBUG__.sceneDebug.camera,
    surfaces: (window as any).__VRATA_DEBUG__.mediaObjects.surfaces,
    videos: ((window as any).__reviewVideos as HTMLVideoElement[]).filter(v => v.readyState >= 2).map(v => ({ width: v.videoWidth, height: v.videoHeight, time: v.currentTime }))
  }));
  await writeFile(resolve(output, "rendered-media-frames.json"), JSON.stringify({
    captureBinding: JSON.parse(info.annotations.find(a => a.type === "scene-capture-binding")!.description!),
    mode: process.env.SCENE_QUALITY_SHARE_MODE === "real" ? "real-transport-generated-capture-source" : "local-generated-stream-mock-transport",
    before, after: evidence, screenshot: "normal-media-frames.png", humanVisualAcceptance: false
  }, null, 2) + "\n");
  await page.evaluate(() => (window as any).__VRATA_TEST__.stopActiveSurfaceObject());
});
