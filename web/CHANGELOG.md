# NEONDRIFT (web) — Changelog

## 0.1.0 — unreleased (in active build)
- P1: asset-extraction pipeline online. `skyroads-cli export-json` decodes all 31 SkyRoads
  levels + 10 world palettes to `web/assets/` (git-ignored). Level JSON schema is the
  bridge contract (grid cells: kind/tile/tunnel/cube/effects + level params + palette).
- Next: P2 — Three.js scaffold renders one level in true 3D.
