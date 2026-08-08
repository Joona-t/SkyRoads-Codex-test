# NEONDRIFT Alpha Manual Actor-Flow Checklist

Use this only when the browser-security restriction is explicitly lifted or an authorized user-run browser record is provided. Until then, visual actor-flow evidence is blocked by project policy.

1. Start from the lane under validation:
   - tracked-only public lane: `scripts/build-web.sh --tracked-only 8091`, then open `http://127.0.0.1:8091/`
   - local BYO lane: `scripts/build-web.sh web/assets 8091`, then open `http://127.0.0.1:8091/?byo=1`
   Use `?level=0..30` only when validating explicit exported source roads.
2. Capture environment metadata: browser name/version, viewport, DPR, OS, timestamp, and exact URL.
3. At start, record craft, track, HUD, on-screen controls, the map showing the three Starter Cup routes, the single optional-source-unavailable message in tracked-only mode, `window.__NEONDRIFT__.appState()`, `window.__NEONDRIFT__.campaign()`, `window.__NEONDRIFT__.snapshot()`, `window.__NEONDRIFT__.rendererInfo()`, and console/network status.
4. Accelerate with Up/W or the Go button, steer left, steer right, and jump with Space or the Jump button. Record the HUD speed/progress/input-visible behavior and confirm no page scrolling.
5. At the coached hazard, record the HUD cue before row 39 and verify it names the row 44 red hazard. Capture a screenshot for the luminance-mask procedure in `docs/neondrift-luminance-mask-procedure.md`.
6. Trigger one terminal failure: miss the red hazard for Exploded, leave the road for Fallen, or use a source level for resource depletion. Record the terminal overlay title/detail and a hook snapshot.
7. Restart without reload using R, Enter, the terminal Restart button, or the on-screen restart path. Confirm craft position, HUD state, runtime counters, and renderer geometry/texture/program counts reset or stay bounded as expected.
8. Complete a clean run to the finish tunnel. Record the victory overlay, final hook snapshot, `window.__NEONDRIFT__.lastResult()`, renderer info, console errors, failed module/asset requests, and finish-state luminance-mask screenshot.
9. Restart again without reload and confirm a second clean `playing` snapshot from `window.__NEONDRIFT__.snapshot()`.
10. Use Escape/P and the Pause button to verify exactly one visible pause modal with Resume and Map, then resume to racing. After terminal failure/win, verify exactly one visible results dialog, the legacy HUD terminal hidden, and no Next action after a failed run. Return to the map, visit Garage and Settings at 1280x720 and narrow portrait, then verify `window.__NEONDRIFT__.garage()`, `window.__NEONDRIFT__.craftAppearance()`, keyboard remaps, reduced motion, high contrast, render scale, quality tier, audio controls, `window.__NEONDRIFT__.audio()`, and `window.__NEONDRIFT__.presentationSettings()` with keyboard focus and touch. Confirm no setting hides restart, pause, or the next five race rows.
11. Reload the page and confirm `window.__NEONDRIFT__.save()` still contains the medal, best time, credits, changed cosmetic/audio/accessibility settings, and no corrupt-save warning unless the corrupt-save lane is being tested.
12. For performance evidence, use `docs/neondrift-performance-trace.md`; record `window.__NEONDRIFT_PERF__.fixture()` and `window.__NEONDRIFT_PERF__.readback()` with the browser trace.

Required evidence for VAL-E2E-001 remains one timestamped browser recording or checklist for the full journey; screenshots or video at start, failure, restart, and win; console/network logs with zero uncaught errors and zero failed unexpected module/asset requests; and hook snapshots before/after terminal, restart, settings/garage changes, and reload.
