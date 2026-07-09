# Bugs & Iterations

Running log of the NEONDRIFT × SkyRoads merger build (and the underlying RE port).

<!-- Format:
## YYYY-MM-DD: Short Title
**Problem:** What went wrong or needed changing
**Root cause:** Why it happened
**Fix:** What was done to resolve it
-->

## 2026-07-09: P1 — asset-extraction pipeline (`export-json`)

**What:** Added an `export-json` subcommand to `skyroads-cli` that serializes all 31 decoded
levels + 10 world palettes to JSON for the `web/` neon 3D game (MERGER-PLAN.md §3).

**Design:** serde lives ONLY in the leaf `skyroads-cli` binary (added `serde`, `serde_json`);
the library crates (`skyroads-data`, `skyroads-core`) stay 100% untouched and zero-dependency.
Wire structs (`LevelExport`/`CellExport`/`ConstantsExport`/`LevelIndex`) are defined in the CLI
and built from the public `Level`/`LevelCell` fields — no changes to the parsers. World-index
formula inlined (`(i-1)/3`) to avoid touching `skyroads-core`.

**Palette trap handled:** road palettes are raw 6-bit VGA → ×4 to RGB888 (`vga6_to_rgb888`);
world/CMAP palettes are already ×4'd by the image parser → emitted as-is.

**Verified (P1 gate):** `cargo run -p skyroads-cli -- export-json . web/assets` → 31 level files
+ index + 10 world palettes; level_00 = gravity 8 / fuel 130 / oxygen 60 / length 160 (matches
plan); `cargo test -p skyroads-data -p skyroads-core` green (19 + 12 passed); `skyroads-data`
dependency tree still zero external deps (serde isolated to the CLI). Bumped `skyroads-cli`
0.1.0 → 0.2.0 (additive minor). `web/assets/` git-ignored (derivative of Bluemoon data — see NOTICE).

**Gate completion (Fable-5 audit, 2026-07-09):** the plan's cell-count-vs-summary diff — skipped
at the time — was reproduced by the audit: **30436 cells across 31 levels == 30436 summary dispatch
total; per-kind {0:25781, 1:987, 2:2132, 3:268, 4:1079, 5:189} exact**; `kind` provably equals
`flags & 0x07` with 0 mismatches; two independent export runs byte-identical.

## 2026-07-09: Fable-5 adversarial audit of the Opus 4.8 build loop

**Problem:** All prior work (MERGER-PLAN, P1 exporter, web scaffold, neondrift prototype) was
built and self-verified by Opus 4.8 with no independent audit.
**Findings:** 50 raised → 45 confirmed / 0 debunked / 5 severity-downgraded (1 P0, 17 P1, 14 P2,
18 P3). P0: vendored three.module.min.js is the r185 split build importing three.core.min.js,
which was never vendored — the web scaffold was dead on first load. 12 confirmed deviations
between MERGER-PLAN §4 and gameplay.rs (would have failed the P3 golden trace). 7 P1
gameplay/state bugs in the "verified" prototype. Multiple overclaimed-verification records.
**Fix:** All 18 P0/P1 worklist items + the same-session P2/P3 follow-ups applied: three.core
vendored; §4 contract rewritten against source; prototype patched (per-lap pad re-arm, wrap-aware
crossings, music-mute restore, reduced-motion flash gate, rival difficulty formula, minimap
per-lap, rival projection unified with the road camera, rematch rewards, save validation,
Space-on-buttons, dead code removed); exporter hard-fails on 0 palettes; ledger corrected;
plan patched to as-built. Full report: `AUDIT-2026-07-09-fable5.md`.
