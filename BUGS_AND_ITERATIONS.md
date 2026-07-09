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
