# MERGER-PLAN.md — SkyRoads × NEONDRIFT → true-3D neon anti-grav racer

> Status: PLAN (no code yet). This document is the contract-of-record for the build loop.
> Additive only — the existing Rust native port is never modified beyond ONE new CLI subcommand.
> Synthesized from 6 study dimensions (assets / rust / gameplay / web3d / merge / repo).

---

## 1. TL;DR

We are merging the deep, faithful SkyRoads reverse-engineering port (Rust, `crates/skyroads-data`) with the NEONDRIFT neon-cyberpunk vision to produce **one true-3D racer that runs in the browser**: you pilot a customizable neon hovercraft down SkyRoads' floating 7-lane space roads — strafing gaps, jumping onto cubes, threading tunnels, managing fuel + oxygen — rendered in WebGL with emissive neon materials and bloom, wrapped in NFS-Most-Wanted-style deep customization, a garage, a rival "Blacklist" ghost ladder, procedural synthwave audio, and strong accessibility. **The recommended architecture is decisive: keep the Rust crate as a build-time ASSET-EXTRACTION PIPELINE (add one `export-json` CLI subcommand that dumps the 31 decoded levels + palettes to JSON), and build the actual 3D game in a new `web/` directory with Three.js/WebGL consuming that JSON.** SkyRoads' grid geometry and physics DNA are the skeleton; NEONDRIFT's aesthetic, customization, meta-progression, audio, and a11y are the skin and soul. The original DOS assets stay Bluemoon Interactive's — we license only our new code (MIT), ship a NOTICE, and never bundle extracted original-level data in the public repo.

---

## 2. Recommended architecture (with rejected alternative)

**Data flow (the spine):**

```
crates/skyroads-data (existing pure parsers, zero-dep)
        │  load_roads_lzs_path → levels_from_roads_archive → Vec<Level> (31)
        │  load_image_archive_path → WORLD0-9.LZS + CARS.LZS palettes
        ▼
crates/skyroads-cli  ── NEW `export-json` arm (one match arm + one fn)
        │  serde-serialize Level/LevelCell/palettes
        ▼
web/assets/levels/level_00..30.json  +  web/assets/palettes/world_0..9.json  (GIT-IGNORED, generated)
        ▼
web/  Three.js/WebGL neon game
        ├─ loader.js   fetch() JSON → in-memory Level
        ├─ sim.js      faithful JS/TS port of gameplay.rs (70 Hz fixed tick)
        ├─ scene.js    InstancedMesh level geometry + neon materials + UnrealBloomPass
        ├─ ship.js     procedural low-poly hovercraft, garage-driven materials
        ├─ garage.js   NFS customization + 4-stat tuning tree → sim constant multipliers
        ├─ audio.js    procedural synthwave AudioEngine (NEONDRIFT, verbatim)
        └─ save.js     unified localStorage schema
```

**Why this wins.** (1) The `Level` model is *already* a decoded 3D tile graph (7×N cells, each one u16 → tile/tunnel/cube-height/effect), so the JSON *is* the geometry — no re-derivation, ~5–40 KB/level. (2) Building geometry + color client-side is exactly what enables live neon recoloring, per-world skins, bloom, and paint customization — baking to glTF would freeze materials and destroy the vision. (3) Purely additive: a new CLI arm next to `summary`/`demo-sim` touches neither the native SDL port nor `demo-sim`, and all existing tests stay green. (4) Web-shippable to a URL; neon+bloom is trivial in WebGL (UnrealBloomPass).

**Rejected alternative — native Rust 3D (bevy/wgpu).** It abandons browser distribution, forks effort away from NEONDRIFT's already-written HTML/garage/save/audio, destroys the current **zero-third-party-dependency** `Cargo.lock` (bevy drags a huge transitive tree), needs a per-platform host like `skyroads-sdl`, and is weaker on the reduced-motion/touch/high-contrast accessibility story NEONDRIFT already specced. It gains nothing since the data is already fully extracted. Keep it only as a possible far-future "native mac app" branch — not the primary path.

**Two conflicts resolved decisively:**

- **Sim: faithful JS/TS port, NOT WASM.** `gameplay.rs` is ~600 lines of pure fixed-point math with zero render deps — a direct transliteration is cleaner than a WASM toolchain *and* is required by the product: our NFS stat multipliers and accessibility assists must inject INTO the constants, and we must be free to tune feel. Fidelity is protected by a **golden-trace regression test** against the existing `demo-sim` (DEMO.REC) output. WASM-compiling `skyroads-core` remains a documented future fidelity option if drift ever becomes a problem, but it does not gate v1.
- **Serde: feature-gated optional on `skyroads-data`, `serde_json` in the CLI.** Add `serde = { version="1.0", features=["derive"], optional=true }` + `[features] serde = ["dep:serde"]` to `skyroads-data`; the CLI depends on it with `features=["serde"]`. The default build stays dependency-free (purity preserved); only `export-json` pulls serde. This beats a hand-rolled JSON writer on maintainability while honoring the repo's zero-dep ethos by default. **Note to owner:** the first `cargo build` of the CLI after this lands will fetch serde from crates.io — a normal *build-time* dependency, not a runtime/LLM/paid API, fully compliant with rule #10.

---

## 3. Asset pipeline

### CLI command to add

**Crate:** `skyroads-cli`. **File:** `crates/skyroads-cli/src/main.rs`. Add ONE arm at the existing match (currently line 26–27) and update the usage string (line 29):

```rust
// new arm:
(Some("export-json"), Some(source_root)) => export_json(Path::new(&source_root), &extra),
// usage: <summary|demo-sim|export-json>

fn export_json(source_root: &Path, extra: &[String]) -> Result<()> {
    let out_dir = extra.first().map(PathBuf::from).unwrap_or_else(|| PathBuf::from("web/assets"));
    let roads  = load_roads_lzs_path(source_root.join("ROADS.LZS"))?;
    let levels = levels_from_roads_archive(&roads);                 // Vec<Level>, len 31
    // levels
    let mut index = Vec::new();
    for lvl in &levels {
        let world = world_index_for_level(lvl.road_index);         // (i-1)/3, i==0 → 0
        write_json(&out_dir.join(format!("levels/level_{:02}.json", lvl.road_index)),
                   &LevelExport::from(lvl, world))?;
        index.push(IndexEntry { file: format!("level_{:02}.json", lvl.road_index),
                                world, name: lvl.name.clone(), road_index: lvl.road_index });
    }
    write_json(&out_dir.join("levels/index.json"), &LevelIndex { version: 1, generated_from: "ROADS.LZS", levels: index })?;
    // road palettes (RAW 6-bit → MUST ×4 to 8-bit)
    for r in &roads.roads {
        write_json(&out_dir.join(format!("palettes/road_{:02}.json", r.index)), &vga6_to_rgb888(&r.palette_vga))?;
    }
    // world backdrop palettes (CMAP already ×4'd by parse_cmap — DO NOT ×4 again)
    for i in 0..=9 {
        let w = load_image_archive_path(source_root.join(format!("WORLD{i}.LZS")))?;
        write_json(&out_dir.join(format!("palettes/world_{i}.json")), &w.frames[0][0].palette)?;
    }
    Ok(())
}

fn write_json<T: serde::Serialize>(path: &Path, v: &T) -> Result<()> {
    if let Some(p) = path.parent() { fs::create_dir_all(p)?; }     // From<io::Error> exists (error.rs:37)
    let json = serde_json::to_string_pretty(v).map_err(|e| Error::invalid_format(e.to_string()))?;
    fs::write(path, json)?; Ok(())
}
```

**Serde changes:** derive `#[cfg_attr(feature="serde", derive(serde::Serialize))]` on `TouchEffect`, `LevelCell`, `Level`, `RgbColor`, `ImagePalette` in `skyroads-data`. The CLI defines thin `LevelExport`/`IndexEntry` mirror structs (owns the wire shape; keeps effect enums as lowercase strings). **Make `world_index_for_level` public** in `skyroads-core` (currently private, `app.rs:526`) OR inline `if i==0 {0} else {(i-1)/3}` in the CLI.

**Palette trap (must not miss):** `RoadEntry.palette_vga` is RAW 6-bit VGA (`roads.rs:154`) — multiply ×4 (clamp 255) → RGB888. `ImagePalette.colors` from CMAP is ALREADY ×4'd by `parse_cmap` (`image.rs:191-195`) — do NOT scale again.

### Exported level JSON schema (the bridge contract)

`web/assets/levels/level_00.json`:

```jsonc
{
  "version": 1,
  "roadIndex": 0,
  "name": "Demo Level",
  "world": 0,                          // world_index_for_level
  "gravity": 8, "fuel": 130, "oxygen": 60,
  "columns": 7,
  "length": 160,                        // number of rows
  "start": { "x": 256, "y": 80, "z": 3 },
  "constants": {                        // level.rs:3-13, echoed so the web game never hardcodes
    "tileStrideX": 46.0, "groundY": 80.0, "roadColumns": 7,
    "levelMinX": 95.0, "levelMaxX": 417.0, "levelCenterX": 256.0,
    "cubeShortTop": 100, "cubeTallTop": 120, "zPerRow": 1.0
  },
  "palette": [[r,g,b], /* … 72 entries, road_XX.json inlined or referenced */],
  "cells": [                            // length rows × 7 cols, row-major
    [ { "raw":1287, "kind":2, "tile":true, "tunnel":true, "cube":120,
        "tileColor":7, "cubeColor":5, "tileEffect":"none", "cubeEffect":"accelerate" },
      /* …7 cells… */ ],
    /* …length rows… */
  ]
}
```

Cell fields decoded from the u16 descriptor (`level.rs:189-213`): `kind` = `high_byte & 0x0F` ∈ 0..5 (0=flat, 1=flat+tunnel, 2=cube100, 3=cube100+tunnel, 4=cube120, 5=cube120+tunnel) is the **geometry primitive selector**; `cube` ∈ {null,100,120}; `tile`/`tunnel` bools; `tileEffect`/`cubeEffect` ∈ {none,accelerate,decelerate,kill,slide,refillOxygen}. A cell with `tile:false && cube:null && tunnel:false` is a **genuine hole** — the ship falls through (`is_empty()`, `level.rs:62`). **Size optimization (P1 acceptable to skip, P2 do it):** for long levels emit parallel typed arrays (`Uint8 kind[]`, `Uint8 cube[]`, `Uint8 fx[]`) instead of object-per-cell to shrink files ~4×; the object form above is the readable canonical spec.

### How the web game loads it

`loader.js`: `const idx = await fetch('assets/levels/index.json').then(r=>r.json());` then fetch the chosen `level_XX.json`. Parse into an in-memory `Level { gravity, fuel, oxygen, length, cells: Cell[][], start, palette }`. Both `sim.js` (collision `getCell`) and `scene.js` (mesh instancing) read the same object. ES-module `fetch()` requires `http://` (not `file://`) — a static server is mandatory (see §7).

---

## 4. Gameplay contract (SkyRoads sim → JS, precise per-tick)

**Non-negotiable:** fixed **70 Hz** tick (`app.rs:5`), decoupled from `requestAnimationFrame` via an accumulator (`dt = 1000/70 ≈ 14.2857 ms`); interpolate the ship transform between ticks for smooth 60/120 fps. The entire *feel* is 70 Hz fixed-point momentum — never bind physics to frame time. There is **no auto-run**: `z_velocity` is conserved (no z-friction), clamped `[0, 0.166656]` tiles/tick; hold accel to build/maintain speed.

**Port the quantizers verbatim** (`gameplay.rs:735-757`): `floor16` = round to 1/128, `floor32` = round to 1/65536, `s_floor` = asymmetric-toward-zero. A naive float port WILL drift from the golden trace.

**Per-tick update order** (`Ship::update`, `gameplay.rs:104-147`) — reimplement in this exact sequence:

1. **sanitize** — quantize x,y to 1/128, z to 1/65536.
2. **cell lookup** — `getCell(x,z)`; `isAboveNothing = cell.isEmpty()`.
3. **touch effect** (only when on ground): if `y==80 && has_tile` → `tileEffect`; if `y>80 && y==cube_height` → `cubeEffect`; else none.
4. **apply effect** — Accelerate `+303/65536`, Decelerate `-303/65536`, Kill → Exploded, RefillOxygen → fuel=oxygen=30000; then clamp z.
5. **y-velocity / landing** — if height changed and `|y_vel| > gravity·0.253906` → BOUNCE (`y_vel *= -0.5`, emit `ShipBounced`); else `y_vel = 0`.
6. **z-velocity** — `z_vel += accelInput · 75/65536` (alive only); clamp `[0, 0.166656]`.
7. **x-velocity** — `x_base = turnInput · 29/128` when controllable (grounded-not-over-gap, OR rising inside a jump window <30 units) and NOT on a slide tile.
8. **jump** — if grounded & !going_up & jump & **gravity < 20 (0x14)** & alive → `y_vel = 9.0`, going_up=true, record origin. **gravity ≥ 20 DISABLES jump** (shipped mechanic, level 20).
9. **Jump-O-Master** (once, when going_up & y≥110) — predictive landing assist that nudges `x_base` ±10–60% and `z_vel` ±10–60% searching a trajectory that lands ON a tile (`will_land_on_tile` simulates the full arc). **Surface as an accessibility/difficulty assist toggle** (off = hardcore original).
10. **gravity** — if y≥40: `y_vel += gravity_accel`; else clamp min fall speed. `gravity_accel(G) = -floor(G·5760/400)/128` → G4=-0.445, G8=-0.898, G12=-1.344, G20=-2.25.
11. **attempt_motion** — `x += floor(x_base·128)·floor(motionVel·65536)/65536 + slide`; `y += y_vel`; `z += z_vel` (alive only). `motionVel = z_vel + 0.023804` forward-creep — **the creep affects ONLY lateral steering rate, NOT z advancement** (do not add it to z).
12. **swept move_to** — 5 coarse substeps then fine z→x→y granular stepping, each stopping just before `isInsideTile()`. This is how cubes/tunnel-ceilings block motion.
13. **handle_bumps** — if z blocked, try x-nudge ±7.25 to slip past a cube edge → `ShipBumpedWall`.
14. **handle_collision** — if z couldn't reach expected: if `z_vel < 0.055552` (= max/3) → stop + bump; ELSE → **EXPLODE**. (Fast frontal ram = death, slow = stop.)
15. **handle_slide_collision** — lateral blocked → cancel x_base, zero slide, z penalty `-0x97/65536`.
16. **handle_bounce** — set on_ground; on landing reset jump/JOM flags, detect tile-edge overhang → `sliding_accel`/`slide_amount` (slide off a ledge).
17. **fuel/oxygen** — `oxygen -= 30000/(36·O_level)` (SPEED-INDEPENDENT); `fuel -= z_vel·30000/F_level` (SPEED-PROPORTIONAL); ≤0 → OutOfOxygen / OutOfFuel. Full tank = 30000.
18. **fall** — `y<80` while Alive → Fallen (freeze all velocities).

**Win** (`gameplay.rs:679`): `z ≥ length − 0.5` **AND** `isInsideTunnel(x,y,z)` — must exit through the END TUNNEL GATE, not merely reach the last row. Hand-authored neon levels MUST set the tunnel flag on final rows or they're unwinnable.

**States** (5): Alive / Exploded / Fallen / OutOfFuel / OutOfOxygen. **Events** (4): ShipBumpedWall, ShipExploded, ShipBounced, ShipRefilled → drive SFX + neon FX.

**Function signatures (headless `sim.js`, no Three.js deps):**

```ts
type Controls = { turn:-1|0|1, accel:-1|0|1, jump:boolean };
class Sim {
  constructor(level: Level, stats: StatMultipliers, assists: Assists);
  tick(c: Controls): FrameResult;                 // one 70 Hz step
}
interface FrameResult {
  x:number; y:number; z:number; zVel:number;      // reported zVel = z_vel + jomDelta
  state: ShipState; o2Pct:number; fuelPct:number;
  events: Event[]; row:number; didWin:boolean;
}
// port these 3 from level.rs: getCell(x,z), isInsideTile(x,y,z), isInsideTunnel(x,y,z)
```

**Stat multipliers inject here** (see §6): `topSpeedMult` scales the 0.166656 clamp; `accelMult` scales `75/65536`; `handlingMult` scales `29/128`; `liftMult` scales jump `9.0` and effective `level.fuel`.

**Golden-trace gate:** before any reskin, the JS `tick()` must match the Rust `demo-sim` output to ~1e-4 for N frames on DEMO.REC (Rust test asserts e.g. `z=3.0011444091796875` at frame 1, `gameplay.rs:785-802`). This is the P3 done-criterion.

---

## 5. 3D render plan (Three.js neon cyberpunk)

**Coordinate transform (single source of truth):** keep sim in original SkyRoads units; convert only at the render boundary. `TILE = 4` render units per row; `S = TILE/46 ≈ 0.087` for X/Y.

```js
const TILE = 4, S = TILE/46;
const gameToWorld = (gx,gy,gz) => new THREE.Vector3((gx-256)*S, (gy-80)*S, -gz*TILE);
// column i center gameX = 95 + i*46 + 23 → worldX = (i-3)*TILE (7 lanes, ±3·TILE)
// ground worldY = 0; short cube top +20 → +0.43·TILE; tall cube +40 → +0.87·TILE; one row = TILE deep
```

**Renderer:** `WebGLRenderer({antialias:true, powerPreference:'high-performance'})`; `setPixelRatio(min(dpr,2))`; `toneMapping = ACESFilmicToneMapping`; `toneMappingExposure = 1.1`; `outputColorSpace = SRGBColorSpace` (default). Post: `EffectComposer → RenderPass → UnrealBloomPass(Vector2(w,h), 0.9, 0.5, 0.8) → OutputPass()`. **Neon comes from `emissiveIntensity > 1` crossing the 0.8 bloom threshold — NOT from many lights.** OutputPass MUST be the final pass (linear→sRGB); missing it = wrong gamma.

**Scene graph:**

- **backdropGroup** (parented to camera, `depthWrite:false`): sky = large BackSide sphere / fullscreen gradient quad (NEONDRIFT PAL stops `#05010d→#1a0a38→#3a1a5e`); synthwave sun = emissive banded-gradient plane (`MeshBasicMaterial`, blooms hard); skyline = `InstancedMesh` of dark boxes with emissive window rows, slow parallax; starfield = `THREE.Points` (1 draw call). The per-world backdrop PNG/palette selects the sky tint.
- **groundGrid:** one big `PlaneGeometry` with a neon-gridline shader/texture; scroll `texture.offset` by ship z for an infinite floor — no per-frame geometry.
- **trackGroup** via `buildLevelMeshes(level)`: **CHUNK cells into `CHUNK_ROWS = 16`**. Per chunk, one `InstancedMesh` per geometry class:
  - `flatTile` — BoxGeometry 46w × ~4 thick × 1 deep (dark deck, emissive edge)
  - `shortCube` — Box, top at y=100 (spans y 80→100)
  - `tallCube` — Box, top at y=120 (spans y 80→120)
  - `tunnelArch` — `ExtrudeGeometry` built once from `TUNNEL_CEILS[38]`/`TUNNEL_LOWS[30]` (`level.rs:16-24`), swept 1 unit in Z, emissive rim
  - iterate rows×7, skip empty cells, `setMatrixAt()` from `gameToWorld`, `matrixAutoUpdate=false`.
- **Effect → neon emissive material LUT** (self-documenting art language): Kill→`#ff2b4e` red, Accelerate→`#00ffa3` green, Decelerate→`#ff9f2d` amber, Slide→`#9d4bff` violet, RefillOxygen→`#16f0e6` cyan, None→world/customization base paint. Special pads use `MeshBasicMaterial` (unlit, cheapest, blooms perfectly).
- **shipGroup** = PROCEDURAL low-poly hovercraft (~2.2×1.4×0.7) from Box/Cone/Lathe primitives: hull = `MeshStandardMaterial` (paint hex from save), underglow = emissive plane + one `PointLight` (underglow hex), engine trail = additive `Points`, optional Sparky decal. `updateShip()`: position = `gameToWorld(frame)`; `rotation.z` bank from lateral Δx between frames (bank angle is NOT in the snapshot — derive it); thrust glow from zVel; explode/fall swap material + particles.
- **lights:** `HemisphereLight (~0.3)` + one `DirectionalLight` from the sun azimuth. That is ALL.
- **fog:** `FogExp2(0x160a30, ~0.012)` tuned so the cutoff hides the draw-window edge.

**Camera:** `PerspectiveCamera(72, aspect, 0.1, far)`. Chase (no heading rotation — the ship only strafes): target lerps to ship world pos; `camera.position` lerps to `ship + (0, 2.6, +11)`; `lookAt(ship + (0,1.2,-7))`. Boost → FOV 72→84 that frame, restore. Damping lerp α≈0.12. Cull window = rows `[z-3, z+7]` (`app.rs:11-12`).

**Perf tactics (target ≥55 fps mid-device):** (1) **CHUNK the level** — a whole-level `InstancedMesh` has a level-spanning bounding sphere that never frustum-culls; 16-row chunks each cull independently. (2) `MeshBasicMaterial` for pure-glow. (3) Cap DPR≤2; expose `settings.renderScale` + a half-res-bloom quality tier for mobile. (4) Reuse geometries/materials; dispose old level meshes on level change.

**Dependency delivery:** **vendor Three under `web/vendor/three/`** (`three.module.min.js` + postprocessing addons `EffectComposer`/`RenderPass`/`UnrealBloomPass`/`OutputPass` + `CopyShader`/`LuminosityHighPassShader`), loaded via importmap:
```html
<script type="importmap">{"imports":{"three":"./vendor/three/three.module.min.js","three/addons/":"./vendor/three/addons/"}}</script>
```
Pin ~r170+ (confirm exact API via context7 at implement time; the postprocessing API churns). Serve via the existing `python3 -m http.server` pattern.

---

## 6. NEONDRIFT merge (features, save schema, solo-vs-rival)

**The load-bearing conflict, resolved: SkyRoads grid geometry WINS; NEONDRIFT's curve/hill/centrifugal/lap model is DROPPED.** NEONDRIFT was an OutRun-style curving ribbon with `segments[]`/`curve`/`y`/3-laps/centrifugal drift. SkyRoads is a dead-straight 7-lane grid sprint, point-to-point, win-at-end-tunnel. The owner directive ("built on SkyRoads' rich data + gameplay DNA") makes this non-negotiable. This deletes ~40% of BUILD-SPEC's physics/track math but keeps **100% of its aesthetic / meta / customization / audio / a11y** — exactly the intended split. **Any plan that keeps NEONDRIFT's segment renderer is wrong.**

### Solo vs rivals — DECIDED: solo runs + Blacklist TIME-ATTACK GHOST ladder

A 7-wide lethal corridor (Kill tiles, deadly frontal collisions, void gaps) cannot host wheel-to-wheel pack racing — rivals would body-block a death corridor. Resolution: **6 rival personas** (reuse NEONDRIFT's `GLITCH→NOVA` roster) each own a **par time** on a specific world/level. Beat their time to defeat them, take their rank (#6→#1), collect credits + a cosmetic unlock. Render each rival as a **translucent NON-COLLIDING neon GHOST craft** — free in-engine via the repo's input-recording + replay machinery (`DemoRecording`, `run_demo_frame`, `sample_demo_input_for_ship`, `gameplay.rs:711-733`): a ghost = a recorded `Controls` stream re-run through the *same* deterministic JS sim. **#1 boss NOVA on World 9 drops the Sparky (neon wolf) livery** — the earned cameo, our own original MIT asset. The timer runs start-tunnel → end-tunnel. No laps.

### 4 NFS stats → SkyRoads constants (the tuning tree with real trade-offs)

| Stat | SkyRoads constant | Location | Range |
|---|---|---|---|
| **TOP SPEED** | z-velocity clamp ceiling `0.166656` | `gameplay.rs:611` | ×1.00 → ×1.35 |
| **ACCEL** | throttle force `75/65536 = 0.0011444` | `gameplay.rs:214` | ×1.00 → ×1.50 |
| **HANDLING** | lateral strafe base `29/128 = 0.22656` | `gameplay.rs:233` | ×1.00 → ×1.60 |
| **LIFT** (was BOOST) | jump velocity `9.0` + effective `level.fuel` efficiency | `gameplay.rs:254, 491` | ×1.00 → ×1.60 |

**The felt trade-off (re-anchored, no curves):** high TOP SPEED + ACCEL means obstacles/gaps arrive faster with less reaction time; HANDLING + LIFT are what let you survive that speed. NEONDRIFT's stability readout survives, relabeled **REACTION MARGIN** = (handling + lift authority) vs (topSpeed arrival rate). A maxed-speed / stock-handling craft screams into a gap it can't strafe out of — same NFS "buy handling or you die" depth. **LIFT is world-dependent** (jump disabled when `gravity ≥ 20`, level 20) — surface this in the garage so a maxed-LIFT build on a high-gravity world doesn't read as a broken purchase. There is NO ship-stat table in the assets — this whole tree is NEW MIT code layered on top (clean to author).

### Progression / meta / economy

10 worlds (WORLD0-9.LZS = visual/palette themes) × 3 levels = 30 campaign levels + 1 demo (ROADS.LZS → 31 roads; `world = (i-1)/3` for i≥1). Unlock worlds sequentially (clear all 3 → next). Per-level best-time + bronze/silver/gold medals vs par-time table (shipped with each level's JSON). Credits = completion + time bonus + clean-run bonus (NEONDRIFT economy shape). Sparky livery + pilot emblem for defeating NOVA / all-gold.

### Audio & a11y (NEONDRIFT, verbatim)

**Procedural synthwave `AudioEngine`** (self-contained IIFE, no asset licensing) is the DEFAULT. MUZAX (parsed by `muzax.rs` → `MuzaxSong`) becomes an OPTIONAL unlockable "retro" mode via the pipeline — but it's original Bluemoon music, so **attribution-flagged and OFF by default**. **Accessibility carries over WHOLESALE** (renderer-agnostic): `prefers-reduced-motion` gate on bloom strength + camera bob/shake, full keyboard + touch, high-contrast HUD with text/icon backups (never color-only), ARIA on menus, gesture-gated autoplay audio. Bloom pulse + camera bob MUST honor `settings.reducedMotionForce` (photosensitivity concern).

### Unified localStorage save schema

New key `skyroads-neon.save.v1` (single object; garage owns load/save/migrate/validate/deepDefaults, reuse NEONDRIFT's scaffold verbatim):

```jsonc
{
  "v": 1,
  "credits": 0,
  "tiers": { "topSpeed":0, "accel":0, "handling":0, "lift":0 },   // 0..4 each
  "cosmetics": { "paint":"<id>", "underglow":"<id>", "livery": { "pattern":"<id>", "accent":"<hex>" } },
  "shipName": "NEONDRIFT",
  "worlds": { "unlockedMax": 0 },
  "levels": { "<world>-<lvl>": { "bestMs": 0, "medal": 0 } },      // medal 0..3
  "blacklist": { "defeated": [], "mostWanted": false },            // targetRank = 6 - defeated.length
  "unlocks": { "paints": [], "underglows": [], "liveries": [] },
  "ghosts": { "<levelId>": "<RLE input stream, capped>" },         // own-best self-race; omit if too large
  "audio": { "muted": false, "volume": 0.8, "music": true, "retroMuzax": false },
  "settings": { "reducedMotionForce": false, "highContrast": false, "renderScale": 1.0, "jomAssist": false }
}
```

Rival ghosts ship as static extracted data files (not in save). Cosmetics map to 3D: **paint** → hull `MeshStandardMaterial` base/emissive; **underglow** → ground-projected additive light + trail particle color; **livery** → decal texture UV-mapped on hull. All resolve to hex/pattern ids in NEONDRIFT's existing catalogs — the 3D layer consumes them as material params.

---

## 7. Repo structure + build/ship + README + .gitignore + versioning

**Merged layout (nothing existing moves or is deleted):**

```
SkyRoads-Codex-test/
  crates/…                       ← untouched Rust port (+ 1 CLI arm, + optional serde feature)
  WORLD*.LZS, ROADS.LZS, …       ← untouched original assets (already committed)
  web/                           ← NEW: the neon 3D game
    index.html                   ← Three.js importmap + game bootstrap
    src/{loader,sim,scene,ship,garage,audio,save}.js
    vendor/three/…               ← vendored Three r170+ + postprocessing addons
    assets/                      ← GENERATED, GIT-IGNORED (levels/*.json, palettes/*.json)
    demo/neon_demo_01.json       ← ORIGINAL neon level (ships in git, zero copyright) — playable w/o Bluemoon data
    VERSION                      ← web game semver, start 0.1.0
    CHANGELOG.md
    .claude/launch.json          ← python3 -m http.server 8080 -d web
  scripts/build-web.sh           ← NEW: export-json then serve
  LICENSE                        ← NEW: MIT (OUR code only) — repo currently has NONE
  NOTICE                         ← NEW: Bluemoon attribution
  README.md                      ← add "NEONDRIFT (neon 3D remake)" + "Attribution & IP" sections
```

**`scripts/build-web.sh`:** `cargo run -p skyroads-cli --release -- export-json . web/assets` → then `python3 -m http.server 8080 -d web`. ES modules need `http://` (unlike NEONDRIFT's `file://` single-file) — **call this out in README as an accepted UX change**; the optional escape hatch is an esbuild single-bundle for `file://`, not required for v1.

**`.gitignore` additions:** `web/assets/` (regenerated; also a second published copy of Bluemoon's level designs — keep it out of git), `web/vendor/` is committed (vendored dep), `web/node_modules/` ignored if tooling creeps in.

**Versioning:** bump `skyroads-cli` 0.1.0 → 0.2.0 when `export-json` lands (additive = minor). Web game has its own semver in `web/VERSION` (start 0.1.0) + `web/CHANGELOG.md`. Do not entangle crate and web versions.

**GitHub Pages (optional):** `.github/workflows/pages.yml` (actions/deploy-pages) that runs the exporter in CI and publishes `web/` — but this republishes Bluemoon's level layouts, so **gate it on the owner's public/private decision** (§8). Default: local-only serve until decided. Do NOT repoint Pages at `/docs` (that's the RE-notes dir).

---

## 8. Legal / attribution (stated plainly, not hidden)

**Reality:** SkyRoads is © **Bluemoon Interactive** (1993). This repo already publicly commits `SKYROADS.EXE` (30,472 bytes) and all original `.LZS` assets to a **public** remote (`github.com/Joona-t/SkyRoads-Codex-test`) and has **NO LICENSE file**. The level geometry (ROADS.LZS), 72/114/20-color palettes, WORLD*.LZS backdrops, CARS.LZS ship art, and MUZAX music are original copyrighted assets. A neon remake that ships DERIVED level JSON / recolored palettes / MUZAX is a **derivative work** — recoloring does NOT clear copyright, and MIT cannot relicense Bluemoon's data.

**Recommended posture:**
- **LICENSE = MIT** covering ONLY our new code (the `export-json` exporter, the `web/` Three.js engine, garage, meta-progression, neon materials, Sparky cameo). Matches NEONDRIFT's existing MIT.
- **NOTICE file:** "SkyRoads, the SKYROADS.EXE binary, and all original level data, art, music, and sound remain © Bluemoon Interactive and are NOT licensed by this repository. They are parsed/re-skinned for preservation, research, and interoperability. The MIT grant covers only the reverse-engineering code and the NEONDRIFT remake code. Sparky (neon wolf) is an original LoveSpark asset, MIT."
- **Do NOT bundle extracted original-asset JSON/PNG in the public build.** `web/assets/` is git-ignored and generated locally from the user's OWN SkyRoads files (extends the "BYO data files" model the Rust port already assumes).
- **Ship an ORIGINAL neon demo level** (`web/demo/neon_demo_01.json`, hand-authored, tunnel gate on final rows) so the game is fully playable with ZERO copyrighted data.
- **MUZAX/retro audio OFF by default, attribution-flagged.**

**FLAGGED OWNER DECISIONS (genuine owner-taste, not engineering — surface, do not auto-decide):**
1. **Public vs private repo.** The original binary + assets are ALREADY public on origin/main. Recommend flipping to **PRIVATE** until (2) is resolved.
2. **Ship original assets vs extract-only (BYO).** Recommend **extract-only**: git-ignore generated assets, ship code + original neon demo level; user runs the exporter against files they own.
3. **Attribution copy final wording** for NOTICE + README.

The honest one-liner for the owner: *"The engine and neon skin are ours (MIT). The roads, worlds, sound, and DOS binary are Bluemoon's — we parse and re-skin them for preservation, we don't own or relicense them. Decide public-vs-private and ship-assets-vs-BYO before this goes public."*

---

## 9. Phased build order (each phase = one loop iteration, additive)

Each phase ends with a **verifiable done-criterion** and an **adversarial-audit gate** (a skeptic re-runs the check and reports verified-vs-debunked before the phase counts as done).

- **P1 — Asset export.** Add serde feature + `export-json` CLI arm; make `world_index_for_level` pub; emit `levels/level_00..30.json` + `index.json` + `palettes/road_*.json` + `world_*.json` (road palettes ×4, world palettes not). **Done:** `cargo run -p skyroads-cli -- export-json . web/assets` writes 31 level files + index + palettes; `cargo test -p skyroads-data -p skyroads-core` still green; level_00 shows gravity 8 / fuel 130 / oxygen 60 / length 160. **Gate:** re-run export, diff a level JSON's cell count against `summary` dispatch-kind totals; confirm no serde leaked into a default build (`cargo build -p skyroads-data` has zero external deps).
- **P2 — 3D scaffold loads one level.** `web/` skeleton, vendored Three, importmap, static server; `loader.js` + `scene.js` instance the 3 solid geometries + tunnel arch from `level_00.json` with placeholder materials; static chase cam. **Done:** browser renders level 0's full grid at true scale, holes visible as gaps, cubes at correct heights; no console errors. **Gate:** count rendered instances == non-empty cells in JSON.
- **P3 — Gameplay sim.** Port `gameplay.rs` to `sim.js` (quantizers verbatim, 70 Hz accumulator, all 18 steps, win-at-tunnel). Wire keyboard/touch input. **Done:** JS `tick()` matches Rust `demo-sim` golden trace to ~1e-4 for ≥300 frames on DEMO.REC; ship strafes/jumps/dies/wins correctly on level 0. **Gate:** skeptic re-runs the golden trace and confirms the tolerance; verifies forward-creep does NOT touch z and jump is gated at gravity≥20.
- **P4 — Neon materials + bloom + backdrop.** Effect→neon LUT, emissive materials, `EffectComposer`+`UnrealBloomPass`+`OutputPass`, ACES tone-mapping, synthwave sky/sun/skyline/starfield backdrop, FogExp2, per-world palette tint. **Done:** level 0 renders in full neon with bloom at ≥55 fps desktop, ≥55 fps mid-device with half-res-bloom tier; special tiles legible by color. **Gate:** verify OutputPass is final (no gamma bug); measure fps on longest road with 16-row chunk culling.
- **P5 — NFS customization + garage.** Procedural hovercraft; paint/underglow/livery → material params; 4-stat tuning tree → sim constant multipliers; garage UI; REACTION MARGIN readout; Sparky livery slot. **Done:** buying HANDLING visibly widens strafe authority; paint/underglow/livery change the 3D ship; save persists. **Gate:** confirm each stat multiplier hits the correct constant and the trade-off is felt (max-speed/stock-handling build dies on a gap that a handling build clears).
- **P6 — Progression / worlds / economy.** 10 worlds × 3 levels, sequential unlock, medals vs par times, credit economy, Blacklist 6-rival ghost ladder (recorded-input replay as non-colliding ghost), NOVA → Sparky reward. **Done:** clearing a world unlocks the next; beating a rival par time advances rank; ghosts render and replay deterministically. **Gate:** verify ghost replay reproduces the recorded run bit-for-bit through the shared sim.
- **P7 — Audio.** Procedural synthwave `AudioEngine` (default), event-driven SFX (bump/explode/bounce/refill), optional attribution-flagged MUZAX retro mode (off by default), gesture-gated autoplay. **Done:** music + reactive SFX play; retro mode toggle works and is off by default. **Gate:** confirm no audio autoplay before user gesture; MUZAX flagged + default-off.
- **P8 — A11y + polish.** `prefers-reduced-motion` gate on bloom/bob/shake, high-contrast HUD with text/icon backups, full keyboard + touch, ARIA, JOM assist toggle, render-scale setting; README + NOTICE + LICENSE + CHANGELOG; the original neon demo level. **Done:** `ls-check`-style a11y pass green; playable with zero Bluemoon data via demo level; reduced-motion visibly tames bloom/shake. **Gate:** WCAG contrast on HUD ≥4.5:1; verify photosensitivity guardrail; confirm demo level is winnable (tunnel gate present).

---

## 10. Definition of done (merged v1) + metric stack

**Merged v1 is done when:** a player opens the served `web/` game, plays the original neon demo level end-to-end in true 3D neon (bloom, chase cam, procedural ship) with zero Bluemoon data; with their own SkyRoads files exported, plays all 10 worlds × 3 levels; customizes the ship (paint/underglow/livery) and tunes the 4-stat tree with a felt trade-off; beats the 6-rival Blacklist ghost ladder to earn the Sparky livery; hears procedural synthwave audio; and can play fully via keyboard or touch with reduced-motion and high-contrast honored. LICENSE (MIT, our code) + NOTICE (Bluemoon attribution) present; `web/assets` git-ignored; the two flagged owner decisions (public/private, ship-vs-BYO) recorded.

**Metric stack:**
- **Perf:** ≥55 fps on a mid device (NEONDRIFT M3 gate) on the longest road with bloom on; ≥55 fps desktop with all effects; chunk-culling verified.
- **Fidelity:** JS sim matches Rust `demo-sim` golden trace to ~1e-4 over ≥300 frames.
- **Defects:** each phase's adversarial-audit gate passes (verified-vs-debunked reported); `cargo test` green throughout; zero console errors.
- **Aesthetic judge:** neon legibility of special tiles (color LUT self-documents mechanics); a design-review pass on the neon look.
- **Completeness:** 31 levels export cleanly; 30-level campaign + demo playable; 4 stats + full cosmetics wired; audio + a11y + save all present.

---

*End of MERGER-PLAN.md — hand to the build loop; implement P1 first.*
