import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { assert } from "./lib.mjs";
import { measureVisualParity } from "./review-evidence.mjs";
import { reviewRelease } from "./review-release-config.mjs";

const root = resolve(import.meta.dirname, "..");
const evidenceInput = process.env.SCENE_VISUAL_OUTPUT_DIR ?? reviewRelease.runtimeEvidencePath;
const evidencePath = isAbsolute(evidenceInput) ? evidenceInput : resolve(root, evidenceInput);
const reportInput = process.env.SCENE_VISUAL_REPORT_PATH ?? "build/visual-parity-0.2.0.json";
const reportPath = isAbsolute(reportInput) ? reportInput : resolve(root, reportInput);
const parity = reviewRelease.visualParity;

assert(parity.finalThresholdsDefined === true, "visual_parity_final_thresholds_missing");
assert(reviewRelease.status === "review" && reviewRelease.humanAcceptance === "pending-human-acceptance", "visual_parity_review_gate_mismatch");
assert(reviewRelease.isCurrent === false && reviewRelease.publicationReady === false, "visual_parity_activation_claim");
assert(JSON.stringify(Object.keys(parity.perView)) === JSON.stringify(reviewRelease.reviewViews), "visual_parity_view_config_mismatch");

const measurement = await measureVisualParity(root, reviewRelease, evidencePath);
const report = {
  schemaVersion: 1,
  sceneId: reviewRelease.sceneId,
  version: reviewRelease.version,
  status: reviewRelease.status,
  humanAcceptance: reviewRelease.humanAcceptance,
  isCurrent: false,
  publicationReady: false,
  metricTool: "ImageMagick compare",
  metricToolVersion: measurement.imageMagickVersion,
  metricTolerance: parity.metricTolerance,
  evidencePath: isAbsolute(evidenceInput) ? relative(root, evidenceInput) : evidenceInput,
  thresholdState: parity.thresholdState,
  finalThresholdsDefined: true,
  rationale: parity.rationale,
  aggregateThresholds: parity.aggregate,
  aggregate: { phashTotal: measurement.phashTotal, nccMean: measurement.nccMean },
  views: measurement.views,
  technicalResult: measurement.result,
  humanAcceptanceRecorded: false
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (measurement.result !== "passed") throw new Error(`visual_parity_technical_regression_failed:${reportPath}`);
process.stdout.write(`Visual parity technical regression passed: PHASH total ${measurement.phashTotal.toFixed(4)}, NCC mean ${measurement.nccMean.toFixed(7)}\n`);
