# NEONDRIFT (web) — Changelog

## 1.0.0 — 2026-08-08
- Repaired browser-surfaced shell defects: pause key/touch now rerenders the pause modal,
  results hide the legacy HUD terminal, failed runs hide Next, and tracked-only maps compact
  optional source roads to one unavailable explanation.
- Added an executable headless full-journey contract for fresh-save and corrupt-save
  boot, map, preview, countdown, race, pause, failure, retry, win, results, rewards,
  garage/settings changes, reload persistence, tracked-only fallback, and BYO discovery.
- Split delivery into tracked-only public serve (`scripts/build-web.sh --tracked-only 8091`)
  and local BYO export plus serve (`scripts/build-web.sh web/assets 8091`, then `/?byo=1`).
- Added reproducible public artifact staging with manifest, dependency provenance,
  forbidden-file exclusions, and secret scan.
- Updated browser checklist and delivery docs so downstream validators can collect real
  screenshots, console/network status, hook snapshots, and performance traces without
  treating Node or HTTP checks as visual evidence.

## 0.5.0-alpha — 2026-08-08
- Added original procedural Web Audio music and bounded reusable event SFX voices for
  bump, bounce, pad, refill, victory, and failure cues.
- Added trusted-gesture audio activation, persisted mute/volume/music settings, and
  pause/visibility suspension.
- Kept retro/MUZAX playback unavailable without user-provided data, labelled as BYO, and
  disabled by default; no source music or sound recordings are bundled into the web build.

## 0.4.0-alpha — 2026-07-13
- Added the tracked original NEONDRIFT Starter Cup: training, handling, and jump/effect
  courses with stable manifest IDs, distinct palettes/layouts, finish tunnels, hazard
  cues, deterministic win traces, and representative failure traces.
- Updated the route map and loader so all three built-in courses work without `web/assets`;
  exported SkyRoads source roads remain additive and opt-in through `?level=0..30`.
- Added in-memory Starter Cup unlock/completion hooks plus content contract tests for schema,
  originality/layout distance, source-corpus non-copying, trace determinism, preview coverage,
  tracked-only loading, and restart behavior.

## 0.3.1-alpha — 2026-07-11
- Replaced the root URL's exported Demo Level 0 default with a tracked original
  NEONDRIFT training run while keeping `?level=0..30` mapped to the unmodified
  exported source corpus.
- Added deterministic playability probes for safe launch, early/missed/successful
  hazard, finish, failure, and restart.
- Reworked readability and feedback: brighter track presentation, tutorial rails/rims
  and effect shape cues, aspect-aware camera, larger craft, vertical finish ring,
  player-facing coached HUD, Enter/R/click restart, and view-only Fallen animation.
- Added the normalized luminance-mask procedure for authorized user-run screenshots.

## 0.3.0-alpha — 2026-07-11
- Hardened `scripts/build-web.sh web/assets 8091` as the canonical clean-start path:
  stale generated `web/assets/` is removed before export, then `web/` is served locally.
- Added complete local delivery validation: HTTP module graph closure, exported index/level/
  palette HTTP checks, stricter level schema validation, negative fixtures, and exact source
  corpus totals.
- Integrated the playable alpha loop: fixed 70 Hz headless simulation, keyboard/touch input,
  craft/camera presentation, HUD/terminal state, restart, victory/failure latching, telemetry,
  and read-only inspection hooks.
- Documentation now states the evidence boundary explicitly: Rust/Node/HTTP checks are valid;
  browser visual automation remains blocked by mission policy and is not claimed as passing.

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
