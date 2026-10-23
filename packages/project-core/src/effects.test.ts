import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { setEffects, setMasterEffects, setTrackEffects } from './creative.js';
import {
  effectMediaType,
  findKdenliveEffect,
  listKdenliveEffects,
} from './effect-catalog.js';
import { InvalidTimelineEditError, TimelineEditError } from './editing.js';
import { addClips, addTrack } from './placement.js';
import { createProject, newId } from './project.js';
import type { Asset, Project } from './schema.js';
import { validateProject } from './validator.js';

function asset(kind: Asset['kind']): Asset {
  return {
    id: newId(),
    name: `${kind}.mkv`,
    kind,
    location: { kind: 'external', path: resolve('fixtures', `${kind}.mkv`) },
    sha256: (kind === 'audio' ? 'b' : 'c').repeat(64),
    probe: {
      durationFrames: 300,
      durationSeconds: 10,
      formatName: 'fixture',
      sizeBytes: 1,
      video:
        kind === 'audio'
          ? null
          : {
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
      audio:
        kind === 'video'
          ? null
          : {
              codec: 'pcm_s16le',
              sampleRate: 48_000,
              channels: 2,
              channelLayout: 'stereo',
            },
    },
  };
}

async function timeline(): Promise<{
  project: Project;
  videoTrackId: string;
  audioTrackId: string;
  clipId: string;
}> {
  const video = asset('video');
  const audio = asset('audio');
  let project: Project = {
    ...createProject('Effects'),
    assets: [video, audio],
  };
  project = (
    await addClips(project, [{ assetId: video.id, sourceOut: 100 }], {
      mode: 'append',
    })
  ).project;
  project = (await addTrack(project, 'audio')).project;
  const audioTrackId =
    project.tracks.find((track) => track.kind === 'audio')?.id ?? '';
  project = (
    await addClips(
      project,
      [{ assetId: audio.id, sourceOut: 100, trackId: audioTrackId }],
      { mode: 'append' },
    )
  ).project;
  const videoTrack = project.tracks.find((track) => track.kind === 'video');
  return {
    project,
    videoTrackId: videoTrack?.id ?? '',
    audioTrackId,
    clipId: videoTrack?.clips[0]?.id ?? '',
  };
}

describe('Kdenlive effect catalog', () => {
  it('covers video and audio categories beyond color', () => {
    const effects = listKdenliveEffects();
    expect(effects.length).toBeGreaterThan(300);
    const categories = new Set(effects.map((effect) => effect.category));
    for (const category of [
      'alpha-mask-and-keying',
      'blur-and-sharpen',
      'color',
      'generate',
      'grain-and-noise',
      'image-adjustment',
      'motion',
      'stylize',
      'transform-distort-and-perspective',
      'utilities',
      'vr360-and-3d',
      'volume-and-dynamics',
      'eq-and-filters',
      'reverb-echo-and-delays',
      'pitch-and-time',
    ])
      expect(categories, category).toContain(category);
    expect(findKdenliveEffect('avfilter.gblur')?.category).toBe(
      'blur-and-sharpen',
    );
    expect(findKdenliveEffect('volume')?.mediaType).toBe('audio');
    expect(effectMediaType('avfilter.gblur')).toBe('video');
    expect(findKdenliveEffect('speed')).toBeUndefined();
    expect(
      listKdenliveEffects({ includeDeprecated: false }).some(
        (effect) => effect.deprecated === true,
      ),
    ).toBe(false);
    expect(effects.some((effect) => effect.deprecated === true)).toBe(true);
    expect(
      effects.flatMap((effect) =>
        effect.parameters.filter(
          (parameter) =>
            typeof parameter.default === 'string' &&
            parameter.default.includes('%'),
        ),
      ),
    ).toEqual([]);
  });

  it('keeps fixed service values and dependency availability', () => {
    const shape = findKdenliveEffect('mask_start-shape');
    expect(shape?.service).toBe('mask_start');
    expect(shape?.dependencies).toEqual(['shape']);
    expect(
      shape?.parameters.find((parameter) => parameter.name === 'filter'),
    ).toMatchObject({ type: 'string', default: 'shape' });
    const maskApply = (transitions: string[]) =>
      listKdenliveEffects({
        availableFilters: ['mask_apply'],
        availableTransitions: transitions,
        category: 'alpha-mask-and-keying',
      }).find((effect) => effect.kdenliveId === 'mask_apply')?.available;
    expect(maskApply(['frei0r.composition'])).toBe(true);
    const glow = listKdenliveEffects({
      availableFilters: ['movit.glow'],
      category: 'gpu-effects',
    }).find((effect) => effect.kdenliveId === 'movit.glow');
    expect(glow).toMatchObject({ available: false, gpuOnly: true });
    expect(maskApply([])).toBe(false);
  });
});

describe('effect stacks across media types', () => {
  it('applies a masked blur stack to a clip with Kdenlive defaults', async () => {
    const { project, clipId } = await timeline();
    const result = await setEffects(project, clipId, [
      // An empty file parameter means "unset", not a relative path.
      { kdenliveId: 'mask_start-shape', parameters: { 'filter.resource': '' } },
      { kdenliveId: 'avfilter.gblur', parameters: { 'av.sigma': 8 } },
      { kdenliveId: 'mask_apply' },
    ]);
    const stack = result.project.tracks[0]?.clips[0]?.effects ?? [];
    expect(stack.map((effect) => effect.service)).toEqual([
      'mask_start',
      'avfilter.gblur',
      'mask_apply',
    ]);
    expect(stack[0]?.parameters.filter).toBe('shape');
    expect(stack[2]?.parameters.transition).toBe('qtblend');
  });

  it('matches track effects to the track kind', async () => {
    const { project, videoTrackId, audioTrackId } = await timeline();
    const audio = await setTrackEffects(project, audioTrackId, [
      { kdenliveId: 'volume', parameters: { level: -6 } },
      { kdenliveId: 'avfilter.equalizer' },
    ]);
    expect(
      audio.project.tracks.find((track) => track.id === audioTrackId)?.effects,
    ).toHaveLength(2);
    await expect(
      setTrackEffects(project, audioTrackId, [
        { kdenliveId: 'avfilter.gblur' },
      ]),
    ).rejects.toBeInstanceOf(TimelineEditError);
    await expect(
      setTrackEffects(project, videoTrackId, [{ kdenliveId: 'volume' }]),
    ).rejects.toBeInstanceOf(TimelineEditError);
    // Raw services without catalog metadata are allowed on either kind.
    await expect(
      setTrackEffects(project, audioTrackId, [{ service: 'sox.reverb' }]),
    ).resolves.toBeDefined();
  });

  it('limits track and master effects to zones but not clip effects', async () => {
    const { project, videoTrackId, clipId } = await timeline();
    const zoned = await setTrackEffects(project, videoTrackId, [
      { kdenliveId: 'avfilter.gblur', zone: { start: 10, end: 40 } },
    ]);
    expect(zoned.project.tracks[0]?.effects[0]?.zone).toEqual({
      start: 10,
      end: 40,
    });
    const master = await setMasterEffects(zoned.project, [
      { kdenliveId: 'avfilter.negate', zone: { start: 0, end: 5 } },
    ]);
    expect(await validateProject(master.project)).toEqual([]);
    await expect(
      setMasterEffects(project, [
        { kdenliveId: 'avfilter.negate', zone: { start: 9, end: 9 } },
      ]),
    ).rejects.toBeInstanceOf(InvalidTimelineEditError);
    await expect(
      setEffects(project, clipId, [
        { kdenliveId: 'avfilter.negate', zone: { start: 0, end: 5 } },
      ]),
    ).rejects.toMatchObject({ code: 'EFFECT_ZONE_UNSUPPORTED' });
  });
});
