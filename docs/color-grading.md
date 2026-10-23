# Color grading

The server supports every effect in Kdenlive's
[Color and Image Correction](https://docs.kdenlive.org/en/effects_and_filters/video_effects/color_image_correction.html)
category. Effects are written as native MLT filters, so renders, previews, and
exported `.kdenlive` projects all show the same grade, and Kdenlive can open
and adjust the effects in its own UI.

## Where a grade can live

| Tool                         | Scope                                       | Keyframe frames |
| ---------------------------- | ------------------------------------------- | --------------- |
| `clip_set_effects`           | One clip (shot matching, per-shot fixes)    | Clip-relative   |
| `track_set_effects`          | Every clip on a video track (shared looks)  | Timeline        |
| `project_set_master_effects` | The composited program, titles and captions | Timeline        |

Each tool replaces the whole ordered stack. Pass an empty array to clear it.

## Choosing effects and values

`effect_catalog` lists the 59 effects with their Kdenlive ID, MLT service, and
whether the installed MLT runtime provides them. Pass `kdenliveId` to get the
full parameter list:

- Values are raw MLT property values. Kdenlive's UI often scales them: for
  `lift_gamma_gain`, Kdenlive shows `gain_r` as 0-500 while MLT stores 0-5.
  The catalog reports `kdenliveFactor` where scaling applies.
- `minimum` and `maximum` are Kdenlive's slider bounds. Out-of-range values are
  allowed but return an `EFFECT_PARAMETER_RANGE` warning.
- Unset parameters receive Kdenlive's defaults unless `fillDefaults` is false.
- Color parameters accept `0xrrggbbaa` (or Kdenlive's `#aarrggbb` gradient
  stops for `gradientmap`).
- `animatable: true` parameters can be keyframed.

LUT files for `avfilter.lut3d` (`av.file`) must be absolute paths inside a
configured root or a Kdenlive LUT directory. The catalog lists the `.cube`,
`.3dl`, `.dat`, and `.m3d` files it finds in Kdenlive's LUT directories.

```json
{
  "projectId": "…",
  "expectedRevision": 7,
  "clipId": "…",
  "effects": [
    {
      "kdenliveId": "avfilter.colortemperature",
      "parameters": { "av.temperature": 5200 }
    },
    {
      "kdenliveId": "lift_gamma_gain",
      "parameters": { "lift_b": 0.02, "gain_r": 1.05 },
      "keyframes": {
        "gain_b": [
          { "frame": 0, "value": 1 },
          { "frame": 48, "value": 0.94, "interpolation": "smooth" }
        ]
      }
    }
  ]
}
```

## Measuring the result

- `color_analyze` renders up to 12 frames and reports luma percentiles and a
  16-bin histogram, clipped and crushed pixel fractions per channel, channel
  means, shadow/midtone/highlight balance, saturation, and the color cast of
  neutral areas, with short notes. `bypassEffects: true` measures the
  ungraded image for comparison.
- `preview_inspect` with `kind: "scopes"` renders the frame beside an RGB
  parade, vectorscope, and histogram.

## Runtime requirements

22 of the effects (3-Point Balance, Curves, Bézier Curves, Levels, RGB
Adjustment, SOP/Sat, White Balance, and others) come from the frei0r plugin
collection. `kdenlive-mcp --doctor` reports a `color-effects` warning when MLT
cannot load them. On Debian or Ubuntu install them with
`sudo apt install frei0r-plugins`. The other effects need MLT's avfilter and
plus modules, which ship with standard MLT builds.

## Catalog maintenance

`packages/project-core/src/kdenlive-color-effects.generated.ts` is generated from
a local Kdenlive installation's effect definitions:

```shell
bun run effects:generate
```
