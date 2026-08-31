export const canonicalRightsScope = Object.freeze({
  status: "approved-for-public-staging-review",
  rightsApproved: true,
  rightsApprovalDate: "2026-08-29",
  licenseRef: "LicenseRef-Vrata-Public-Staging-Review-2026-08-29",
  decisionMaker: "human-rights-owner",
  ownershipBasis: "entirely-project-authored",
  allowedUses: Object.freeze([
    "staging",
    "public-web-runtime",
    "screenshots",
    "optimization",
    "derivative-builds",
    "redistribution-in-publicly-downloadable-scene-bundle"
  ]),
  notGrantedByThisVerdict: Object.freeze(["production-activation", "human-visual-acceptance"]),
  externalAssetsUsed: false,
  downloadedAssetsUsed: false,
  privateSenseTowerMaterialsUsed: false,
  imageTo3dOutputUsed: false,
  brandingUsed: false,
  publicationReady: false
});

export const reviewRelease = Object.freeze({
  sceneId: "presentation-room-v1",
  version: "0.2.0",
  releaseKind: "baked-lightmap-review",
  status: "review",
  humanAcceptance: "pending-human-acceptance",
  isCurrent: false,
  publicationReady: false,
  renderMode: "clean",
  renderProfile: "baked-pbr-v1",
  sourceBlendPath: "source/review-candidate.blend",
  exportScriptPath: "source/export_baked_review.py",
  acceptedLightmapPath: "source/baked-review-lightmap-0.2.0.png",
  acceptedLightmapSha256: "cdeb7e52d539c17408acf6eaf39ac3a598ee06e731283f4d5b867ad45eb5fb66",
  bakeOutputPath: "build/baked-review-0.2.0/lightmap.png",
  buildOutputPath: "build/baked-review-0.2.0/scene.glb",
  releaseGlbSha256: "25dc4d0dad2039b7c533448c163490760ec8378187d82ed0b7a98214fc6acaec",
  releasePath: "assets/scenes/presentation-room-v1/0.2.0",
  provenancePath: "provenance/baked-lightmap-0.2.0.json",
  runtimeEvidencePath: "provenance/runtime-capture-0.2.0",
  captureBindingPath: "provenance/runtime-capture-0.2.0/capture-binding.json",
  platformCaptureImplementationCommit: "c54edb2239d225a71e9b934316f70792b3faafb6",
  blender: {
    version: "4.5.12 LTS",
    buildHash: "84afd5f785f7",
    archiveUrl: "https://download.blender.org/release/Blender4.5/blender-4.5.12-linux-x64.tar.xz",
    archiveSha256: "95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25",
    binarySha256: "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
  },
  bake: {
    resolution: 2048,
    samples: 128,
    scale: 0.25,
    device: "CUDA",
    defaultIntensity: 4
  },
  reviewViews: ["entry", "audience", "presenter", "diagonal-overview"],
  visualParity: {
    thresholdState: "final-technical-regression",
    finalThresholdsDefined: true,
    rationale: "Technical regression bounds from final local runtime captures; not human visual acceptance.",
    perView: {
      entry: { phashMax: 95, nccMin: 0.3 },
      audience: { phashMax: 66, nccMin: 0.29 },
      presenter: { phashMax: 175, nccMin: 0.35 },
      "diagonal-overview": { phashMax: 105, nccMin: 0.25 }
    },
    aggregate: { phashTotalMax: 430, nccMeanMin: 0.31 },
    metricTolerance: {
      perViewPhashAbsolute: 0.001,
      perViewNccAbsolute: 0.000001,
      aggregatePhashAbsolute: 0.004,
      aggregateNccAbsolute: 0.000001
    }
  }
});
