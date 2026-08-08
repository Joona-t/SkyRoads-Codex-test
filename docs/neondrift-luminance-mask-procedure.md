# NEONDRIFT Luminance Mask Procedure

Use this procedure only with authorized user-run screenshots. Do not use HTTP,
Node, or static source checks as visual evidence.

## Capture States

- `start`: root URL with no `level` query, before input.
- `coached-hazard`: tutorial row 30-41, while the HUD cue names the row 44 red hazard.
- `finish`: tutorial row 78-91, while the finish ring is visible.

Record `window.__NEONDRIFT__.snapshot()` beside every screenshot and preserve the
reported row and tick/counter values with the image.

## Viewport

Primary desktop mask set targets a 1474x695 CSS viewport at DPR 1. If the browser
captures at a different pixel size, scale each normalized rectangle by the actual
image width and height before sampling.

## Normalized Masks

All masks are normalized as `[x0, y0, x1, y1]` in viewport coordinates.

| name | normalized rectangle | purpose |
| --- | --- | --- |
| `road-top-near` | `[0.28, 0.60, 0.72, 0.86]` | road rows 1-5 in front of the craft |
| `road-top-mid` | `[0.34, 0.38, 0.66, 0.58]` | road rows 6-10 |
| `adjacent-void-near-left` | `[0.04, 0.62, 0.20, 0.86]` | near-field void beside the road |
| `adjacent-void-near-right` | `[0.80, 0.62, 0.96, 0.86]` | near-field void beside the road |
| `adjacent-void-mid-left` | `[0.12, 0.38, 0.28, 0.58]` | mid-field void beside the road |
| `adjacent-void-mid-right` | `[0.72, 0.38, 0.88, 0.58]` | mid-field void beside the road |
| `craft` | `[0.44, 0.69, 0.56, 0.88]` | craft silhouette and terminal fall animation exclusion |
| `hazard` | `[0.38, 0.34, 0.62, 0.52]` | coached red hazard or its rim |
| `ui` | `[0.00, 0.00, 0.40, 0.26]` and `[0.70, 0.00, 1.00, 0.32]` | HUD and terminal/control exclusion checks |

## Measurement

For every sampled pixel, convert sRGB to relative luminance:

```text
c = channel / 255
linear = c / 12.92 when c <= 0.03928, otherwise ((c + 0.055) / 1.055) ^ 2.4
luminance = 0.2126 * linear_r + 0.7152 * linear_g + 0.0722 * linear_b
```

Compute median luminance for each mask. For near rows, use median
`road-top-near` and the lower median of `adjacent-void-near-left/right`. For mid
rows, use `road-top-mid` and the lower median of `adjacent-void-mid-left/right`.

The readability floor is:

```text
(road + 0.001) / (void + 0.001) >= 3.0
```

This must pass independently for `road-top-near` and `road-top-mid`.

## UI Exclusion

The `ui` masks must not intersect the `craft` mask or the projected next five
road rows in the screenshot. If an overlay appears, record whether it belongs to
the HUD, controls, terminal, or browser chrome and mark the state failed until a
new screenshot proves separation.
