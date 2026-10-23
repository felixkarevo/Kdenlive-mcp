# Effects and filters

The server can apply every effect in Kdenlive's
[Effects and Filters](https://docs.kdenlive.org/en/effects_and_filters.html)
catalog: 352 current video and audio effects in Kdenlive's categories (blur and
sharpen, alpha/mask/keying, transform, stylize, grain and noise, generate,
motion, utilities, VR360, color, volume and dynamics, EQ, reverb, pitch, and
more), plus deprecated effects kept for older projects. Effects are written as
native MLT filters, so renders, previews, and exported `.kdenlive` projects all
show them, and Kdenlive can adjust them in its own UI.

## Finding effects

`effect_catalog` works in three steps:

1. With no arguments it returns each category with its effect count and how many
   the installed MLT runtime can run.
2. With `category` (for example `blur-and-sharpen`) or `query` (for example
   `vignette`) it lists matching effects with their Kdenlive ID and MLT service.
   Add `mediaType`, `availableOnly`, or `includeDeprecated` to narrow the list.
3. With `kdenliveId` it returns the full parameter list: raw MLT ranges,
   defaults, list options, and which parameters can be keyframed.

Parameter values are raw MLT values, not the scaled numbers Kdenlive's sliders
show; `kdenliveFactor` gives the scale. Parameters marked `relativeTo: width`
or `height` use a 0-1 fraction of the frame. Unset parameters receive
Kdenlive's defaults unless `fillDefaults` is false.

## Where an effect can live

| Tool                         | Scope                                        | Keyframes and zones |
| ---------------------------- | -------------------------------------------- | ------------------- |
| `clip_set_effects`           | One clip (video or audio effects)            | Clip-relative       |
| `track_set_effects`          | Every clip on a track; must match track kind | Timeline frames     |
| `project_set_master_effects` | The composited program and the audio mix     | Timeline frames     |

Each tool replaces the whole ordered stack; pass an empty array to clear it.
Track and master effects accept `zone: { start, end }` (timeline frames, end
exclusive) to limit them to part of the timeline, like Kdenlive effect zones.

## Masks

Masks are ordered stacks, as in Kdenlive: a `mask_start-*` effect
(`mask_start-shape`, `mask_start-rotoscoping`, `mask_start-frei0r.alphaspot`,
or `mask_start-frei0r.select0r`), then the effects to mask, then `mask_apply`.

```json
[
  {
    "kdenliveId": "mask_start-shape",
    "parameters": { "filter.resource": "/videos/masks/circle.png" }
  },
  { "kdenliveId": "avfilter.gblur", "parameters": { "av.sigma": 10 } },
  { "kdenliveId": "mask_apply" }
]
```

## Files and safety

Parameters that read files (LUTs, mask images, luma wipes) must be absolute
paths inside a configured root or a Kdenlive LUT or luma directory. The same
check applies to any parameter whose name or value looks like a file path on any
service, including raw MLT filters and transitions, and URLs are rejected.

## Runtime limits

- `kdenlive-mcp --doctor` reports how many effects the installed MLT can run.
  frei0r effects need the frei0r plugins (`sudo apt install frei0r-plugins`);
  LADSPA audio effects need LADSPA plugin packs such as `tap-plugins`.
- Movit GPU effects (`movit.*`) only run inside Kdenlive's OpenGL pipeline.
  The catalog reports them as unavailable and validation warns with
  `EFFECT_GPU_ONLY`; use CPU equivalents such as `lift_gamma_gain` or
  `avfilter.gblur`.
- `frei0r.facebl0r` and `frei0r.facedetect` need OpenCV's face models
  (`sudo apt install opencv-data`).
- `loudness` needs an analysis pass, as in Kdenlive; use `avfilter.loudnorm`
  for single-pass normalization.
- Kdenlive's legacy LADSPA wrappers and the `speed` effect are not in the
  catalog; use `timeline_set_speed` for speed changes.

For color work, see the [color grading guide](color-grading.md).
