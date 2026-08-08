# NEONDRIFT (web) — true-3D neon anti-grav racer

A neon-cyberpunk 3D racer built on SkyRoads' anti-grav floating-road gameplay, wrapped in
NFS-Most-Wanted-style deep customization. See [`../MERGER-PLAN.md`](../MERGER-PLAN.md) for the
full architecture and build order.

## Run

```bash
# from the repo root: public tracked-only Starter Cup, no source data export
scripts/build-web.sh --tracked-only 8091

# local BYO source-road export plus serve
scripts/build-web.sh web/assets 8091
```

Open `http://127.0.0.1:8091/` after the server starts. ES modules require `http://` (not
`file://`), so a static server is required. Tracked-only mode clears stale `web/assets/`
and boots only tracked source. BYO mode removes stale generated data before exporting fresh
level and palette JSON to `web/assets/` (git-ignored; see the repo `NOTICE`). The root URL
loads the tracked original NEONDRIFT Starter Cup; `/?byo=1` discovers the optional BYO
source campaign after export; explicit `?level=0..30` selections load the unmodified
exported SkyRoads source roads.

## Status

Version: `1.0.0`.

Implemented for web v1:

- clean tracked-only startup through `scripts/build-web.sh --tracked-only 8091`
- local BYO export/startup through `scripts/build-web.sh web/assets 8091`
- strict exported-data validation for 31 indexed levels and 10 world palettes
- tracked original Starter Cup with training, handling, and jump/effect courses plus
  deterministic launch/hazard/finish/failure/restart probes
- persisted campaign progression, garage cosmetics/tuning, bounded rivals, and own-best ghosts
- chunked Three.js level rendering with bounded structural draw batches
- source-faithful headless 70 Hz JS simulation checked against the Rust oracle
- keyboard/touch controls, procedural craft, chase camera, coached HUD/terminal states, Enter/R/click restart, and victory/failure flow
- original procedural synthwave music and event SFX with gesture activation, persisted
  mute/volume/music settings, and pause/visibility suspension
- read-only `window.__NEONDRIFT__` inspection hooks plus `window.__NEONDRIFT_METRICS__` telemetry reports
- reproducible public artifact staging through `node scripts/stage-public-artifact.mjs`

Evidence status: Rust, Node, syntax, and local HTTP module/asset closure checks are available.
Browser visual/active-play evidence is not claimed because localhost browser automation is
blocked by the current mission policy.

Still out of scope for this v1 delivery: retro/source-audio playback without BYO data and
pixel-perfect DOS visual parity.

MIT © 2026 Joona (our code) — original SkyRoads assets remain © Bluemoon Interactive (see `../NOTICE`).
