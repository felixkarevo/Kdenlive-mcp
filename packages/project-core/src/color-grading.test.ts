import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { setEffects, setMasterEffects, setTrackEffects } from './creative.js';
import {
  effectParameterIssues,
  findKdenliveEffect,
  listKdenliveEffects,
  resolveKdenliveEffect,
} from './effect-catalog.js';
import { TimelineEditError } from './editing.js';
import { addClips, addTrack } from './placement.js';
import { createProject, newId } from './project.js';
import type { Asset, Project } from './schema.js';
import { validateProject } from './validator.js';

function videoAsset(): Asset {
  return {
    id: newId(),
    name: 'video.mkv',
    kind: 'video',
    location: { kind: 'external', path: resolve('fixtures', 'video.mkv') },
    sha256: 'a'.repeat(64),
    probe: {
      durationFrames: 300,
      durationSeconds: 10,
      formatName: 'fixture',
      sizeBytes: 1,
      video: {
        codec: 'ffv1',
        width: 1280,
        height: 720,
        frameRate: { numerator: 30, denominator: 1 },
        variableFrameRate: false,
        rotation: 0,
        pixelFormat: 'yuv420p',
        colorPrimaries: null,
        colorTransfer: null,
        colorSpace: null,
      },
      audio: null,
    },
  };
}

async function timeline(): Promise<{ project: Project; clipId: string }> {
  const media = videoAsset();
  const result = await addClips(
    { ...createProject('Grade'), assets: [media] },
    [{ assetId: media.id, sourceOut: 100 }],
    { mode: 'append' },
  );
  const clipId = result.project.tracks[0]?.clips[0]?.id;
  if (clipId === undefined) throw new Error('fixture clip missing');
  return { project: result.project, clipId };
}

describe('Kdenlive color effect catalog', () => {
  it('covers the Color and Image Correction category in raw MLT units', () => {
    const effects = listKdenliveEffects();
    expect(effects.length).toBeGreaterThanOrEqual(55);
    for (const id of [
      'lift_gamma_gain',
      'avfilter.lut3d',
      'frei0r.three_point_balance',
      'frei0r.bezier_curves',
      'frei0r.curves',
      'frei0r.levels',
      'avfilter.colorbalance',
      'avfilter.selectivecolor',
      'avfilter.colortemperature',
      'avfilter.eq',
      'avfilter.exposure',
      'avfilter.vibrance',
      'hslprimaries',
      'hslrange',
      'gradientmap',
      'frei0r.balanc0r',
      'tcolor',
    ])
      expect(findKdenliveEffect(id), id).toBeDefined();
    const lgg = findKdenliveEffect('lift_gamma_gain');
    expect(
      lgg?.parameters.find((parameter) => parameter.name === 'gain_r'),
    ).toMatchObject({
      minimum: 0,
      maximum: 5,
      default: 1,
      kdenliveFactor: 100,
      animatable: true,
    });
    expect(findKdenliveEffect('frei0r.bezier_curves')?.service).toBe(
      'frei0r.curves',
    );
    expect(
      listKdenliveEffects({ availableFilters: ['lift_gamma_gain'] }).find(
        (effect) => effect.kdenliveId === 'lift_gamma_gain',
      )?.available,
    ).toBe(true);
  });

  it('resolves Kdenlive IDs to services and fills Kdenlive defaults', () => {
    const resolved = resolveKdenliveEffect({
      kdenliveId: 'lift_gamma_gain',
      parameters: { gain_r: 1.1 },
      keyframes: { lift_b: [] },
    });
    expect(resolved.service).toBe('lift_gamma_gain');
    expect(resolved.parameters).toMatchObject({
      gain_r: 1.1,
      gain_g: 1,
      gamma_r: 1,
      lift_r: 0,
    });
    expect(resolved.parameters).not.toHaveProperty('lift_b');
    expect(
      resolveKdenliveEffect({
        kdenliveId: 'lift_gamma_gain',
        fillDefaults: false,
      }).parameters,
    ).toEqual({});
    expect(() => resolveKdenliveEffect({ kdenliveId: 'no.such' })).toThrow(
      RangeError,
    );
  });

  it('reports out-of-range, unknown, option, and color parameter mistakes', () => {
    const codes = effectParameterIssues({
      service: 'avfilter.selectivecolor',
      parameters: {
        'av.reds': 3,
        'av.correction_method': 'sideways',
        'av.typo': 1,
      },
      keyframes: {},
    }).map((issue) => issue.code);
    expect(codes.sort()).toEqual([
      'EFFECT_PARAMETER_OPTION',
      'EFFECT_PARAMETER_RANGE',
      'EFFECT_PARAMETER_UNKNOWN',
    ]);
    expect(
      effectParameterIssues({
        service: 'frei0r.three_point_balance',
        parameters: { '0': 'black', '1': '0x808080ff' },
        keyframes: {},
      }).map((issue) => issue.code),
    ).toEqual(['EFFECT_PARAMETER_TYPE']);
  });
});

describe('color grading edits', () => {
  it('sets a clip grade by Kdenlive ID with generated keyframe IDs', async () => {
    const { project, clipId } = await timeline();
    const result = await setEffects(project, clipId, [
      {
        kdenliveId: 'lift_gamma_gain',
        parameters: { gain_r: 9 },
        keyframes: {
          lift_b: [
            { frame: 0, value: 0 },
            { frame: 50, value: 0.1, interpolation: 'smooth' },
          ],
        },
      },
    ]);
    const effect = result.project.tracks[0]?.clips[0]?.effects[0];
    expect(effect).toMatchObject({
      service: 'lift_gamma_gain',
      kdenliveId: 'lift_gamma_gain',
      enabled: true,
    });
    expect(effect?.parameters.gamma_g).toBe(1);
    expect(effect?.keyframes.lift_b?.map((key) => key.interpolation)).toEqual([
      'linear',
      'smooth',
    ]);
    expect(effect?.keyframes.lift_b?.every((key) => key.id.length === 36)).toBe(
      true,
    );
    expect(result.warnings).toContain(
      "EFFECT_PARAMETER_RANGE: gain_r=9 is outside Kdenlive's range 0..5",
    );
  });

  it('sets video track and master grades and rejects audio-track grading', async () => {
    const { project } = await timeline();
    const trackId = project.tracks[0]?.id ?? '';
    const graded = await setTrackEffects(project, trackId, [
      {
        kdenliveId: 'avfilter.colortemperature',
        parameters: { 'av.temperature': 5200 },
      },
    ]);
    expect(graded.project.tracks[0]?.effects[0]).toMatchObject({
      service: 'avfilter.colortemperature',
      parameters: { 'av.temperature': 5200, 'av.mix': 1 },
    });
    const mastered = await setMasterEffects(graded.project, [
      { kdenliveId: 'avfilter.vibrance', parameters: { 'av.intensity': 0.3 } },
    ]);
    expect(mastered.project.masterEffects).toHaveLength(1);
    expect(await validateProject(mastered.project)).toEqual([]);

    const withAudio = await addTrack(mastered.project, 'audio');
    const audioTrack = withAudio.project.tracks.find(
      (track) => track.kind === 'audio',
    );
    await expect(
      setTrackEffects(withAudio.project, audioTrack?.id ?? '', [
        { kdenliveId: 'avfilter.eq' },
      ]),
    ).rejects.toBeInstanceOf(TimelineEditError);
  });

  it('requires absolute LUT paths and reports missing LUT files', async () => {
    const { project, clipId } = await timeline();
    await expect(
      setEffects(project, clipId, [
        {
          kdenliveId: 'avfilter.lut3d',
          parameters: { 'av.file': 'look.cube' },
        },
      ]),
    ).rejects.toThrow('validation error');
    const result = await setEffects(project, clipId, [
      {
        kdenliveId: 'avfilter.lut3d',
        parameters: { 'av.file': resolve('missing-look.cube') },
      },
    ]);
    const diagnostics = await validateProject(result.project, {
      checkMedia: true,
      projectRoot: resolve('.'),
    });
    expect(diagnostics.map((item) => item.code)).toContain(
      'EFFECT_FILE_MISSING',
    );
  });

  it('flags frei0r effects missing from the runtime with an install hint', async () => {
    const { project, clipId } = await timeline();
    const result = await setEffects(project, clipId, [
      { kdenliveId: 'frei0r.three_point_balance' },
    ]);
    const diagnostics = await validateProject(result.project, {
      capabilities: { effects: ['lift_gamma_gain'] },
    });
    expect(diagnostics[0]).toMatchObject({
      code: 'EFFECT_UNAVAILABLE',
      severity: 'error',
    });
    expect(diagnostics[0]?.hint).toContain('frei0r');
  });

  it('keeps older projects without track or master effects loadable', async () => {
    const { project } = await timeline();
    const legacy = JSON.parse(JSON.stringify(project)) as Record<
      string,
      unknown
    > & { tracks: Record<string, unknown>[] };
    Reflect.deleteProperty(legacy, 'masterEffects');
    for (const track of legacy.tracks) Reflect.deleteProperty(track, 'effects');
    expect(await validateProject(legacy)).toEqual([]);
  });
});
