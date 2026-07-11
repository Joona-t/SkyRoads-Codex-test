# NEONDRIFT (web) — true-3D neon anti-grav racer

A neon-cyberpunk 3D racer built on SkyRoads' anti-grav floating-road gameplay, wrapped in
NFS-Most-Wanted-style deep customization. See [`../MERGER-PLAN.md`](../MERGER-PLAN.md) for the
full architecture and build order.

## Run

```bash
# from the repo root — exports level data from your SkyRoads files, then serves the game:
scripts/build-web.sh          # http://127.0.0.1:8080
```

ES modules require `http://` (not `file://`), so a static server is required. The exporter
writes level JSON to `web/assets/` (git-ignored — see the repo `NOTICE`); an original neon
demo level under `web/demo/` (planned, P8) will make the game playable with zero original
SkyRoads data.

## Status

In active autonomous build (`/goal` under `/loop`).
- **P1 ✅** asset-extraction pipeline (`skyroads-cli export-json` → `web/assets/*.json`)
- **P2 implemented; browser gate pending** — chunked Three.js instancing builds one level in true 3D; geometry counts are
  checked against exported JSON and a 600-frame runtime probe is exposed at `window.__NEONDRIFT_METRICS__`
- **P3** faithful 70 Hz gameplay sim (golden-trace-verified) · **P4** neon materials + bloom
- **P5** NFS customization + garage · **P6** worlds/progression/ghost-Blacklist · **P7** audio · **P8** a11y + polish

MIT © 2026 Joona (our code) — original SkyRoads assets remain © Bluemoon Interactive (see `../NOTICE`).
