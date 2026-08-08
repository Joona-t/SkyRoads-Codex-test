# NEONDRIFT Performance Trace Procedure

Use this only in the authorized in-app Chromium-family browser surface. Do not
turn Node, HTTP, or source checks into a 55 FPS verdict.

## Fixture

- URL: `http://127.0.0.1:8091/?bench=starter-ion-gauntlet`
- Viewport: `1280x720` CSS pixels
- DPR: `1`
- Quality: `desktop`
- Warmup: 5 seconds after the countdown completes
- Sample: 20 seconds of active play
- Course fixture: `starter-ion-gauntlet`
- Course content hash:
  `774ea1b7285684a34cb27a64d7fdfbcd6cdc0fed90eba7226ffdb34530904f8d`
- Controls fixture: `web/tests/fixtures/perf-ion-gauntlet.trace.json`
- Controls hash:
  `fe489c1ad1ffaa65e12c53b60fe6cf597408be0fc4971410257c4205a68732c1`

The benchmark mode loads controls only from the fixture JSON. Record
`window.__NEONDRIFT_PERF__.fixture()` and
`window.__NEONDRIFT_PERF__.readback()` before and after the sample.
The benchmark course is tracked original content, so `scripts/build-web.sh --tracked-only 8091`
is sufficient unless the validation lane is also exercising BYO source-road discovery.

## Pass Data To Preserve

- Browser name/version, user agent, OS, machine, timestamp, exact URL.
- Raw Performance trace or exported profile.
- Frame-time distribution, especially p95 and worst frame.
- Long tasks over 50 ms.
- `window.__NEONDRIFT__.runtime()` and telemetry counters.
- `window.__NEONDRIFT__.rendererInfo()` plus
  `window.__NEONDRIFT_PERF__.readback()` resource counts.
- Console errors and failed network requests.

## Leak Probe

The named leak sequence is ten repetitions of:

```text
tutorial -> starter-ion-gauntlet
```

That is 20 total loads. Retry each loaded course once before opening the next
course. Preserve the post-warmup baseline and end readbacks. End JS heap must be
within 110% of baseline, and renderer geometries, textures, and programs must
each be no more than baseline + 2.

## Verdict Rule

Only the authorized browser trace can satisfy the FPS and heap parts of
VAL-PERF-GAME-001. The checked-in Node contracts prove the fixture identity,
stall behavior, lifecycle structure, and readback harness only.
