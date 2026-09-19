export const release030 = Object.freeze({
  sceneId: "presentation-room-v1",
  version: "0.3.0",
  baseVersion: "0.2.0",
  releaseKind: "warm-modern-visual-review",
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  rightsStatus: "pending-human-rights-approval",
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  renderMode: "clean",
  renderProfile: "baked-pbr-v1",
  historicalBlendPath: "source/review-candidate.blend",
  historicalGlbPath: "assets/scenes/presentation-room-v1/0.2.0/scene.glb",
  authorScriptPath: "source/releases/0.3.0/author-release.py",
  sourceBlendPath: "source/releases/0.3.0/accepted-scene.blend",
  exportScriptPath: "source/releases/0.3.0/export-release.py",
  lightmapPath: "source/releases/0.3.0/accepted-lightmap.png",
  realityPath: "source/releases/0.3.0/scene-reality.json",
  scenariosPath: "source/releases/0.3.0/user-scenarios.json",
  sourceReviewPath: "source/releases/0.3.0/review",
  releasePath: "assets/scenes/presentation-room-v1/0.3.0",
  provenancePath: "provenance/releases/0.3.0",
  acceptanceLockPath: "source/releases/0.3.0/accepted-source-lock.json",
  acceptanceIndexPath: "source/release-acceptance-index.json",
  visualConfigPath: "source/releases/0.3.0/visual-parity-config.json",
  capturePlanPath: "source/releases/0.3.0/runtime-capture-plan.json",
  captureHarnessPatchPath: "source/releases/0.3.0/capture-harness.patch",
  runtimeEvidencePath: "provenance/runtime-capture-0.3.0",
  runtimeCaptureBuildPath: "build/runtime-capture-0.3.0",
  buildOutputPath: "build/releases/0.3.0/scene.glb",
  accepted: Object.freeze({
    sourceBlendSha256: "d573807e6ede9ad58f6afc3e3db32395aaf3adb3be9e87132861f1775e5e5afb",
    authorScriptSha256: "52649e14c4fbed497c5ba9bb72edd3ee8c005a3e08a85ca52a9562309e282d0b",
    exportScriptSha256: "eb769140c5a44aec54625e0e642321df8578d0208f756b5c15ef7832f6cbafc5",
    lightmapSha256: "ea3864fe09b111827563329e7c543459bc4508701060d67ca4a27ccfc7ffad0a",
    realitySha256: "1c4794a5ba2d1bf9d18f17366c04a3e5deb117f7235212b9df2d68487e1272fe",
    releaseGlbSha256: "56078fd9cf298424ef5f219abd19e5a5fa8e1c5e0cd96224eddfe8e5bd937b30",
    releaseGlbSizeBytes: 13333276,
    geometryFingerprintSha256: "5e8ee9dc8a11563453f3bec6d7ff54da28364256cba6e620f88524aead277b09"
  }),
  reviewViews: Object.freeze([
    "entry",
    "audience",
    "presenter",
    "diagonal-overview",
    "screen-detail",
    "aisle-seat-detail",
    "lighting-detail"
  ]),
  blender: Object.freeze({
    version: "4.5.12 LTS",
    buildHash: "84afd5f785f7",
    archiveUrl: "https://download.blender.org/release/Blender4.5/blender-4.5.12-linux-x64.tar.xz",
    archiveSha256: "95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25",
    binarySha256: "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
  }),
  reviewImages: Object.freeze({
    width: 960,
    height: 540,
    format: "webp",
    converter: "cwebp 1.6.0",
    quality: 90
  }),
  runtimeCapture: Object.freeze({
    capturedOn: "2026-09-05",
    capturePlanSha256: "b805bbdf34d0c6586be292e02ab872cdf8a4d528a4fe98a9362d242823f071bb",
    harnessSourcePath: "tests/e2e/scene-visual.spec.ts",
    harnessSourceSha256: "245fc21b8c82a904db9eb5f037235fcabda7eb7bd7022b8d386c1b1b3b9e4b78",
    harnessPatchSha256: "73b3aa74ad47b18265056e6451b8d0ac4aa536748153827b2cfa669e37aef5ce",
    patchedHarnessSha256: "ee0196ac3acb9ec01c828d9a9fd6a2e3a3cb34db681550571dd6e2a985f6473a",
    runs: Object.freeze(["run-1", "run-2", "run-3"]),
    canonicalRunId: "run-1",
    stability: Object.freeze({
      requiredRuns: 3,
      requiredResult: "byte-identical-images-across-three-full-view-runs",
      maxUniqueImagesPerView: 1
    }),
    captureSettings: Object.freeze({ environmentIntensity: 0.35, exposure: 1.2 }),
    quality: Object.freeze({
      diagnosticsDarkPixelRatioMax: 0.3,
      entryDarkPixelRatioMax: 0.3,
      screenDarkPixelRatioMax: 0.3,
      screenMeanLuminanceMin: 0.2,
      screenMeanLuminanceMax: 0.35
    }),
    normalization: Object.freeze({
      localUrls: true,
      hudHidden: true,
      mediaSurfacesHidden: true,
      avatarFallbackCapsulesEnabled: false,
      avatarSeatsEnabled: false
    }),
    acceptedViews: Object.freeze({
      entry: Object.freeze({ sha256: "f11df1de16b2f69e59dfeb95d6edbea91e8dd813ab5672ebb1d35b21741cc7c4", sizeBytes: 391131 }),
      audience: Object.freeze({ sha256: "330f924b8066be59944c7828a713df233e98abb255afebab01f952b0228652b0", sizeBytes: 344333 }),
      presenter: Object.freeze({ sha256: "e077c172cbda06d33247e8a1211cea3d1ed6f8ce32213afbb9c6e2bf56cd9c20", sizeBytes: 403575 }),
      "diagonal-overview": Object.freeze({ sha256: "4f9066f0b64f352edea1946300690e9c2cfa6fb99f5647fa3c4c02e2c03d1a81", sizeBytes: 462027 }),
      "screen-detail": Object.freeze({ sha256: "4dc9d5285965cf8b89cb867d53f53ea21a4bd5c66dbadc656ff81584084d4dbc", sizeBytes: 227224 }),
      "aisle-seat-detail": Object.freeze({ sha256: "526ed8cfe87c885e8661375674e7f006c397dd8a00dc875de26cedbe441484ac", sizeBytes: 342041 }),
      "lighting-detail": Object.freeze({ sha256: "b2d7239bdcfb073ff29deb7979e479ad5e70e62e3013a59ebf760b130ac7f242", sizeBytes: 343924 })
    }),
    visualParity: Object.freeze({
      thresholdState: "candidate-calibrated-technical-regression-from-three-repeatable-full-view-runs",
      derivation: Object.freeze({
        basis: "worst-observed-across-three-byte-identical-full-view-runs",
        perViewPhashAbsoluteMargin: 10,
        perViewPhashRoundUpTo: 5,
        perViewNccAbsoluteMargin: 0.03,
        perViewNccRoundDownTo: 0.01,
        aggregatePhashAbsoluteMargin: 50,
        aggregatePhashRoundUpTo: 10,
        aggregateNccAbsoluteMargin: 0.04,
        aggregateNccRoundDownTo: 0.01
      }),
      perView: Object.freeze({
        entry: Object.freeze({ phashMax: 60, nccMin: 0.79 }),
        audience: Object.freeze({ phashMax: 100, nccMin: 0.68 }),
        presenter: Object.freeze({ phashMax: 170, nccMin: 0.43 }),
        "diagonal-overview": Object.freeze({ phashMax: 75, nccMin: 0.3 }),
        "screen-detail": Object.freeze({ phashMax: 65, nccMin: 0.52 }),
        "aisle-seat-detail": Object.freeze({ phashMax: 30, nccMin: 0.65 }),
        "lighting-detail": Object.freeze({ phashMax: 110, nccMin: 0.25 })
      }),
      aggregate: Object.freeze({ phashTotalMax: 580, nccMeanMin: 0.51 }),
      metricTolerance: Object.freeze({
        perViewPhashAbsolute: 0.001,
        perViewNccAbsolute: 0.000001,
        aggregatePhashAbsolute: 0.007,
        aggregateNccAbsolute: 0.000001
      })
    })
  }),
  bake: Object.freeze({
    resolution: 2048,
    samples: 128,
    scale: 0.25,
    device: "CUDA",
    lightMapIntensity: 5.2,
    linearMaxBeforeScale: 39.2507438659668,
    linearMeanBeforeScale: 0.9581694006919861,
    transport: "emissiveTexture TEXCOORD_1 with baked-pbr-v1 metadata"
  }),
  budgets: Object.freeze({
    glbBytesMax: 15728640,
    trianglesMax: 90000,
    objectsMax: 500,
    meshesMax: 250,
    materialsMax: 96,
    texturesMax: 48
  }),
  platformValidatorCommit: "c54edb2239d225a71e9b934316f70792b3faafb6"
});
