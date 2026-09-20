export const release040 = Object.freeze({
  sceneId: "presentation-room-v1",
  version: "0.4.0",
  baseVersion: "0.3.0",
  releaseKind: "shared-quality-rework-review",
  status: "review",
  qualityOutcome: "REWORK_REQUIRED",
  humanAcceptance: "pending-human-acceptance",
  rightsStatus: "pending-human-rights-approval",
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  renderMode: "clean",
  renderProfile: "baked-pbr-v1",
  platformValidatorCommit: "c6343de81b038b7937addac44c24fa7c46adf341",
  sharedQualityContractCommit: "8ba49739d44518a3e877bc93432be591ce2e72da",
  benchmarkCommit: "5580a7b080cf6195e28ebc77b654fd71111b0cd1",
  buildInputPath: "build/redesign-0.4.0",
  sourcePath: "source/releases/0.4.0",
  releasePath: "assets/scenes/presentation-room-v1/0.4.0",
  provenancePath: "provenance/releases/0.4.0",
  runtimeEvidencePath: "provenance/runtime-capture-0.4.0",
  acceptanceIndexPath: "source/release-acceptance-index.json",
  acceptanceLockPath: "source/releases/0.4.0/accepted-source-lock.json",
  visualConfigPath: "source/releases/0.4.0/visual-parity-config.json",
  authoredSourceEntries: Object.freeze([
    "author-scene.py",
    "authoring-task.md",
    "denoise-atlas.py",
    "export-scene.py",
    "finalize-glb.mjs",
    "measure-geometry.py",
    "measure-support-contacts.py",
    "render-review.py",
    "support_graph.py",
    "textures"
  ]),
  sourceArtifacts: Object.freeze({
    authoredBlend: Object.freeze({ target: "accepted-scene.blend", input: "draft-scene.blend", sha256: "aea9f7c159bea1b5de9634885918c5240b7786a3cdab9b90fd3830a3c2668a90", sizeBytes: 23055915 }),
    bakedSource: Object.freeze({ target: "accepted-baked-source.blend", input: "baked-source-0.4.0.blend", sha256: "4961d87b1ec254f5e07835c13b9b6e81fe42ac9a767101376a6f2f5cc7740965", sizeBytes: 28377420 }),
    lightmap: Object.freeze({ target: "lightmap-0.4.0-median5.png", input: "lightmap-0.4.0-median5.png", sha256: "1d88c89cae8a841caa1413a314d928f402b2e7cb5f66be0341a3e2c303138ff3", sizeBytes: 1914828 }),
    exportLightmap: Object.freeze({ target: "lightmap-0.4.0-pipeline-median5.png", input: "lightmap-0.4.0-pipeline-median5.png", sha256: "1d88c89cae8a841caa1413a314d928f402b2e7cb5f66be0341a3e2c303138ff3", sizeBytes: 1914828 }),
    lightmapStats: Object.freeze({ target: "accepted-lightmap-raw.stats.json", input: "lightmap-0.4.0-raw.stats.json", sha256: "80d9ed9f165fe532cfa6bfb54fa317c254dd4b1e3d5b7b65723da903eeba3aa8" }),
    rawGlb: Object.freeze({ target: "accepted-export.raw.glb", input: "scene-0.4.0.raw.glb", sha256: "54478ecd3caee0e1c470ec7849e873f0c48f923ab99b919abc20a6efd631356c", sizeBytes: 9657740 }),
    sceneManifest: Object.freeze({ target: "accepted-scene.json", input: "scene.json", sha256: "434cb300a90bc8dce025eaed1becc161bec4bc1292e4d14e1cf721259782ca98", sizeBytes: 6587 }),
    objectRegistry: Object.freeze({ target: "object-registry.json", input: "object-registry.json", sha256: "fa77cea7413cc4b1986b1cf69599bde793b6e26ff9140b9c8d63746081f23bc1" }),
    captureConfig: Object.freeze({ target: "capture-config.json", input: "capture-config.json", sha256: "acba6a525974914f2ff76e6b9c8f819c2c4e301f6ccc100b530bf51494e37e9f" }),
    reviewViews: Object.freeze({ target: "review-views.json", input: "review-views.json", sha256: "0695ca7e9db86e7ec0956b0b218ce428480e03f2955ec276de673c955dd43a40" }),
    geometryMeasurements: Object.freeze({ target: "geometry-measurements.json", input: "geometry-measurements-0.4.0.json", sha256: "3501736ae3463f81e19655f7abea5d88d2557598f861f700eb0b235b061922b2" }),
    supportMeasurements: Object.freeze({ target: "declared-supports.json", input: "declared-supports-0.4.0.json", sha256: "5d0b72796331ba629a80160984ccb10f17a4febb2fe4b8e3069e7e985534b403" })
  }),
  finalGlbInput: "scene-0.4.0.glb",
  finalGlb: Object.freeze({ sha256: "5ee399fb07864ea84f1003c6ec87b9f06cfeaf6553b2312085f09e5f385c4eb6", sizeBytes: 5087708 }),
  preview: Object.freeze({ input: "preview.webp", sha256: "3edc4aa3292681f69df22452b48a92c033da604f8012fc2e76c5e6a5ce7606f4" }),
  captureHarness: Object.freeze({
    inputPath: "../vrata-baked-environment-fix/tests/e2e/scene-quality-0.4-local.spec.ts",
    target: "capture-harness.spec.ts",
    sha256: "9c8be84d37b692edfa766d4edc945c662c816ee1c6e3f83a46e7f9cc235428c5"
  }),
  captureRunnerConfig: Object.freeze({
    inputPath: "../vrata-baked-environment-fix/playwright.config.ts",
    target: "capture-playwright.config.ts",
    sha256: "36582c2c228194cadaedd4d504cee297989fa130a25270e231a0887af8545476"
  }),
  reviewViews: Object.freeze([
    "seat-01-display", "seat-02-display", "seat-03-display", "seat-04-display",
    "seat-05-display", "seat-06-display", "seat-07-display", "seat-08-display",
    "entry", "diagonal-overview", "presenter", "chair-detail", "chair-underneath",
    "lectern-detail", "acoustic-detail", "door-detail"
  ]),
  cleanCapture: Object.freeze({ input: "runtime-040-final", evidenceSubpath: "clean", capturedOn: "2026-09-20" }),
  normalCapture: Object.freeze({ input: "runtime-040-normal-final", evidenceSubpath: "normal-product", capturedOn: "2026-09-20" }),
  sourceReviewInput: "source-0.4.0-current",
  stats: Object.freeze({ triangles: 117619, objects: 225, meshes: 225, primitives: 225, materials: 14, textures: 12, animations: 0 }),
  budget: Object.freeze({ trianglesMax: 90000, trianglesActual: 117619, status: "failed-unresolved-exception" }),
  bake: Object.freeze({
    resolution: 2048,
    samples: 96,
    device: "CUDA",
    encodingScale: 0.12820254356586316,
    lightMapIntensity: 24.504916721685962,
    medianFilter: "deterministic 5x5 median",
    imageMagickVersion: "6.9.12-98 Q16"
  }),
  blender: Object.freeze({
    version: "4.5.12 LTS",
    buildHash: "84afd5f785f7",
    archiveUrl: "https://download.blender.org/release/Blender4.5/blender-4.5.12-linux-x64.tar.xz",
    archiveSha256: "95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25",
    binarySha256: "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
  }),
  unresolvedDefects: Object.freeze([
    "chair fabric weave and wood response differ visibly between source and runtime",
    "chair cushion corners remain visibly faceted",
    "wall and ceiling join seams are more pronounced in runtime than in the paired source views",
    "rendered screen-share media frames are not evidenced",
    "triangle budget is exceeded: 117619 actual versus 90000 maximum"
  ])
});
