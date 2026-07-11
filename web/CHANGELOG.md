# NEONDRIFT (web) — Changelog

## 0.2.0 — 2026-07-11
- P1: asset-extraction pipeline online. `skyroads-cli export-json` decodes all 31 SkyRoads
  levels + 10 world palettes to `web/assets/` (git-ignored). Level JSON schema is the
  bridge contract (grid cells: kind/tile/tunnel/cube/effects + level params + palette).
- P2: chunked Three.js instancing renders exported level geometry in true 3D.
- Added per-class geometry-count invariants, strict level-contract validation, and an
  all-level headless contract test.
- Added a 600-frame runtime probe for FPS, frame-time distribution, draw calls, triangles,
  load time, and scene-build time.
- Reduced build-time churn by storing integer cell indexes and reusing temporary colors.
