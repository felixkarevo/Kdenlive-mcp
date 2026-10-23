export interface EditingRecipe {
  readonly id: string;
  readonly version: 1;
  readonly title: string;
  readonly prerequisites: readonly string[];
  readonly safetyNotes: readonly string[];
  readonly steps: readonly string[];
}

const COLOR_STEPS = [
  'Inspect the timeline and pick representative frames for each shot.',
  'Measure the ungraded frames with color_analyze using bypassEffects.',
  'Look up effects and raw MLT ranges with effect_catalog.',
  'Correct exposure, white balance, and clipping per clip with clip_set_effects (for example avfilter.exposure, avfilter.colortemperature, lift_gamma_gain, frei0r.three_point_balance).',
  'Apply the shared look with track_set_effects or project_set_master_effects (for example avfilter.lut3d, avfilter.colorbalance, avfilter.vibrance).',
  'Re-measure with color_analyze and preview_inspect kind scopes; compare shots for matching luma and neutral cast.',
  'Render only after the review is satisfactory.',
] as const;

const definitions: readonly [
  string,
  string,
  readonly string[],
  (readonly string[])?,
][] = [
  ['rough-cut', 'Rough cut', ['timeline_query', 'timeline_add_clips']],
  ['dialogue-cleanup', 'Dialogue cleanup', ['timeline_diagnostics_submit']],
  [
    'silence-filler',
    'Silence and filler review',
    ['timeline_diagnostics_submit'],
  ],
  ['pacing', 'Pacing review', ['timeline_diagnostics_submit']],
  ['jl-cut', 'J/L cut', ['timeline_add_clips', 'timeline_trim_clip']],
  ['b-roll', 'B-roll insertion', ['timeline_add_clips']],
  ['transitions', 'Transition review', ['transition_edit']],
  ['continuity', 'Continuity review', ['timeline_diagnostics_submit']],
  ['music-ducking', 'Music ducking', ['clip_set_keyframes']],
  ['captions', 'Captions', ['caption_edit', 'caption_export']],
  ['lower-third', 'Lower third', ['text_edit']],
  [
    'color-continuity',
    'Color continuity',
    ['effect_catalog', 'clip_set_effects', 'color_analyze'],
    COLOR_STEPS,
  ],
  [
    'color-grading',
    'Color correction and grading',
    [
      'effect_catalog',
      'clip_set_effects',
      'track_set_effects',
      'project_set_master_effects',
      'color_analyze',
      'preview_inspect',
    ],
    COLOR_STEPS,
  ],
  [
    'youtube-long-form',
    'YouTube long-form delivery',
    ['marker_edit', 'render_submit'],
  ],
  ['shorts', 'Short-form delivery', ['project_get', 'render_submit']],
  ['chapters', 'Chapter markers', ['marker_edit']],
  [
    'delivery',
    'Final delivery',
    ['timeline_diagnostics_submit', 'render_submit', 'job_verify'],
  ],
];

export const EDITING_RECIPES: readonly EditingRecipe[] = definitions.map(
  ([id, title, prerequisites, steps]) => ({
    id,
    version: 1,
    title,
    prerequisites,
    safetyNotes: [
      'Create a checkpoint before destructive edits.',
      'Inspect previews and diagnostics before export.',
      'Apply mutations with the current expectedRevision.',
    ],
    steps: steps ?? [
      'Inspect the current timeline.',
      'Run the listed MCP tools in sequence.',
      'Review the resulting timeline and diagnostics.',
      'Render only after the review is satisfactory.',
    ],
  }),
);

export function recipe(id: string): EditingRecipe {
  const value = EDITING_RECIPES.find((item) => item.id === id);
  if (value === undefined) throw new Error(`Recipe not found: ${id}`);
  return value;
}
