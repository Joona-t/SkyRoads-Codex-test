# NEONDRIFT Delivery Boundary

## Serve Modes

Tracked-only mode proves the public web game boots without generated SkyRoads source data:

```bash
scripts/build-web.sh --tracked-only 8091
```

Open `http://127.0.0.1:8091/`. This mode clears stale `web/assets/`, serves the tracked
web runtime, and leaves the optional BYO source campaign disabled in the map.

BYO mode is a local preservation workflow for users who already have the SkyRoads source
data files in this checkout:

```bash
scripts/build-web.sh web/assets 8091
```

Open `http://127.0.0.1:8091/?byo=1` to discover the optional 30-course source campaign,
or use `?level=0..30` for explicit exported source-road inspection. `web/assets/` remains
generated, ignored, and untracked.

## Public Artifact

Use the allowlist staging command for an IP-safe web artifact:

```bash
node scripts/stage-public-artifact.mjs --out /tmp/neondrift-public-artifact
```

The staged artifact contains the web runtime, tracked original Starter Cup content,
browser validation fixture, Three.js runtime dependency files with license, and delivery
docs. It excludes original SkyRoads files (`SKYROADS.EXE`, `*.LZS`, `*.SND`, `*.DAT`,
`DEMO.REC`), generated `web/assets/`, caches, local runtime folders, and developer evidence.

The script writes `artifact-manifest.json` in the output directory with per-file SHA-256
hashes, file sizes, dependency provenance, forbidden-path scan metadata, and secret-scan
results.

## Validation Matrix

- Tracked-only clean copy: exclude original source files and `web/assets/`, run
  `scripts/build-web.sh --tracked-only 8091`, then run
  `node scripts/check-web-closure.mjs --tracked-only http://127.0.0.1:8091/`.
- BYO clean copy: include source files, run `scripts/build-web.sh web/assets 8091`, then run
  `node scripts/check-web-closure.mjs http://127.0.0.1:8091/`.
- Headless journey: run `node web/tests/e2e-contract.mjs`.
- Browser evidence: use `docs/neondrift-alpha-manual-checklist.md`; do not substitute
  Node, HTTP, or source checks for visual, console/network, or performance verdicts.
