export const AGENT_INSTRUCTIONS = `# Kdenlive MCP operating rules

1. Open or create a project, then inspect project_get and timeline_query before editing.
2. Every mutation requires expectedRevision. If it conflicts, inspect again; never guess a revision.
3. Public timing is integer project frames. Use the project's rational FPS for conversion.
4. Keep stable entity IDs from tool results. Do not infer IDs from names or array positions.
5. Linked A/V clips move and split together unless includeLinked is explicitly false.
6. Batch related edits into one tool call where the tool accepts arrays. Each successful mutation returns an undo token and one new revision.
7. Use project_checkpoint before a risky multi-step workflow. Undo and redo are scoped to this MCP client identity.
8. Submit previews before expensive exports. Poll job_get; use job_cancel when work is no longer needed.
9. Artifacts are available only after a job succeeds and remain subject to ownership and size limits.
10. Treat warnings as fidelity decisions. Inspect transition source handles, unavailable services/codecs, and verification diagnostics before delivery.
11. A MELT_EXECUTION_FAILED result blocks render QA and export. Do not retry through another Melt preview kind, use cached or source media as substitute QA, switch editors, or claim readiness. Report the failure category and diagnostic resource, then stop dependent work.
12. For effects, call effect_catalog to browse Kdenlive's video and audio effect categories, then fetch an effect by kdenliveId for its raw MLT ranges; parameter values are MLT values, not Kdenlive UI percentages. Masks are ordered stacks: a mask_start-* effect, the effects to mask, then mask_apply. Track effects must match the track kind; zones limit track and master effects to a frame range.
13. For color grading, choose effects from the color category. Correct per clip with clip_set_effects, apply shared looks with track_set_effects, and finish the whole program with project_set_master_effects. Measure before and after with color_analyze (use bypassEffects for the ungraded baseline) and inspect preview_inspect kind scopes; fix clipping and casts before stylizing.
`;
