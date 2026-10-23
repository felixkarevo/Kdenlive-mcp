// Regenerates packages/project-core/src/kdenlive-effects.generated.ts from a
// local Kdenlive installation's video and audio effect definitions. Only interface metadata
// (service IDs, parameter names, labels, ranges, defaults) is extracted; the
// values are converted from Kdenlive's UI domain to raw MLT property values.
//
// Usage: node scripts/generate-kdenlive-effect-catalog.mjs [kdenlive-data-dir]
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const candidates = [
  process.argv[2],
  '/usr/share/kdenlive',
  '/snap/kdenlive/current/usr/share/kdenlive',
  '/var/lib/flatpak/app/org.kde.kdenlive/current/active/files/share/kdenlive',
].filter(Boolean);
const dataDir = candidates.find((path) => existsSync(join(path, 'effects')));
if (dataDir === undefined) {
  process.stderr.write('No Kdenlive data directory with effects/ was found.\n');
  process.exit(1);
}
// Kdenlive-only widgets or values the editor derives from the clip itself.
const SKIPPED_TYPES = new Set([
  'curve',
  'readonly',
  'filterjob',
  'keywords',
  'position',
]);
// Grouping helpers in Kdenlive's category file that are not user categories.
const INTERNAL_GROUPS = new Set(['More Checks', 'To be completed']);
const SHORT_CATEGORIES = { 'Color and Image Correction': 'color' };

function attributes(text) {
  return Object.fromEntries(
    [...text.matchAll(/([\w:.-]+)="([^"]*)"/gu)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

function decode(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

function childText(body, tag) {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    'u',
  ).exec(body);
  return match === null
    ? undefined
    : decode(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1'));
}

function numeric(value) {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round(value) {
  return Number.parseFloat(value.toPrecision(12));
}

function valueType(kdenliveType) {
  switch (kdenliveType) {
    case 'bool':
    case 'switch':
      return 'boolean';
    case 'color':
    case 'fixedcolor':
      return 'color';
    case 'list':
    case 'listdependency':
      return 'list';
    case 'url':
    case 'urllist':
      return 'file';
    case 'bezier_spline':
    case 'geometry':
    case 'rect':
    case 'animatedrect':
    case 'text':
      return 'string';
    default:
      return 'number';
  }
}

function parameter(head, body) {
  const attrs = attributes(head);
  if (attrs.name === undefined || SKIPPED_TYPES.has(attrs.type)) return null;
  const rawDefault = attrs.default ?? attrs.value;
  // Fixed or hidden values may be service names such as "shape" or "qtblend".
  const textual =
    ['fixed', 'hidden'].includes(attrs.type) &&
    rawDefault !== undefined &&
    numeric(rawDefault) === undefined;
  const type = textual ? 'string' : valueType(attrs.type);
  const factor = numeric(attrs.factor) ?? 1;
  const output = {
    name: attrs.name,
    label: childText(body, 'name') ?? attrs.name,
    type,
    kdenliveType: attrs.type ?? 'constant',
    animatable: [
      'animated',
      'simplekeyframe',
      'keyframe',
      'animatedrect',
      'colorwheel',
    ].includes(attrs.type),
  };
  if (type === 'number') {
    const min = numeric(attrs.min);
    const max = numeric(attrs.max);
    // Kdenlive stores UI-domain bounds and MLT-domain defaults.
    if (attrs.factor !== undefined && numeric(attrs.factor) === undefined) {
      // A profile-relative factor such as %width maps pixels to 0..1.
      const dimension = attrs.factor.replace(/^%/u, '');
      output.relativeTo = dimension;
      const relativeBound = (value) =>
        value === `%${dimension}` ? 1 : value === `-%${dimension}` ? -1 : null;
      const low = min ?? relativeBound(attrs.min);
      const high = max ?? relativeBound(attrs.max);
      if (typeof low === 'number' && min === undefined) output.minimum = low;
      if (typeof high === 'number' && max === undefined) output.maximum = high;
    } else {
      if (min !== undefined) output.minimum = round(min / factor);
      if (max !== undefined) output.maximum = round(max / factor);
      if (min === undefined && attrs.min?.startsWith('%'))
        output.relativeTo = attrs.min.replace(/^-?%/u, '');
      if (max === undefined && attrs.max?.startsWith('%'))
        output.relativeTo = attrs.max.replace(/^-?%/u, '');
    }
    const fallback = numeric(rawDefault);
    if (fallback !== undefined) output.default = fallback;
    if (attrs.suffix) output.unit = attrs.suffix;
    if (factor !== 1 && numeric(attrs.factor) !== undefined)
      output.kdenliveFactor = factor;
  } else if (type === 'boolean') {
    output.default = attrs.default === '1' || attrs.default === 'true';
  } else if (rawDefault !== undefined && !rawDefault.includes('%')) {
    // Placeholders such as %width are expanded by Kdenlive at runtime.
    output.default = rawDefault;
  }
  if (type === 'list' && attrs.paramlist !== undefined) {
    const values = attrs.paramlist.split(';');
    const labels = (childText(body, 'paramlistdisplay') ?? '').split(',');
    output.options = values.map((value, index) => ({
      value,
      label: labels[index]?.trim() || value,
    }));
  }
  if (type === 'file' && attrs.filter !== undefined)
    output.fileFilter = decode(attrs.filter);
  return output;
}

function effectDefinitions(xml) {
  return [...xml.matchAll(/<effect\b([^>]*)>([\s\S]*?)<\/effect>/gu)].map(
    (match) => {
      const attrs = attributes(match[1]);
      const body = match[2];
      const parameters = [
        ...body.matchAll(
          /<parameter\b([^>]*?)(?:\/>|>([\s\S]*?)<\/parameter>)/gu,
        ),
      ]
        .map((item) => parameter(item[1], item[2] ?? ''))
        .filter((item) => item !== null);
      return {
        kdenliveId: attrs.id ?? attrs.tag,
        service: attrs.tag,
        displayName: childText(body.replace(/<parameter[\s\S]*/u, ''), 'name'),
        version: numeric(attrs.version) ?? 0,
        mediaType: attrs.type ?? 'video',
        dependencies:
          attrs.dependency === undefined ? [] : attrs.dependency.split(','),
        // Legacy LADSPA wrappers need a Kdenlive-generated rack file.
        legacyLadspa: attrs.tag === 'ladspa',
        parameters,
      };
    },
  );
}

const categories = await readFile(
  join(dataDir, 'kdenliveeffectscategory.rc'),
  'utf8',
);
const groups = [
  ...categories.matchAll(
    /<group list="([^"]*)"[^>]*>\s*<text>([^<]*)<\/text>/gu,
  ),
].map((match) => ({
  label: match[2].replace(/\s+/gu, ' ').trim(),
  ids: new Set(match[1].split(',')),
}));

function slug(label) {
  return (
    SHORT_CATEGORIES[label] ??
    label
      .toLowerCase()
      .replace(/'/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '')
  );
}

function categorize(id, mediaType) {
  const matches = groups.filter((group) => group.ids.has(id));
  const deprecated = matches.some((group) => group.label === 'Deprecated');
  const primary = matches.find(
    (group) =>
      group.label !== 'Deprecated' && !INTERNAL_GROUPS.has(group.label),
  );
  return {
    category:
      primary === undefined
        ? mediaType === 'audio'
          ? 'audio-misc'
          : 'misc'
        : slug(primary.label),
    deprecated,
  };
}

const byId = new Map();
const skipped = [];
for (const file of (await readdir(join(dataDir, 'effects'))).sort()) {
  if (!file.endsWith('.xml')) continue;
  const xml = await readFile(join(dataDir, 'effects', file), 'utf8');
  for (const definition of effectDefinitions(xml)) {
    if (
      !['video', 'audio', 'av'].includes(definition.mediaType) ||
      definition.displayName === undefined
    )
      continue;
    // Speed changes use the timewarp producer; timeline_set_speed covers them.
    if (definition.service === 'timewarp') {
      skipped.push(definition.kdenliveId);
      continue;
    }
    if (definition.legacyLadspa) {
      skipped.push(definition.kdenliveId);
      continue;
    }
    const previous = byId.get(definition.kdenliveId);
    if (previous === undefined || previous.version <= definition.version)
      byId.set(definition.kdenliveId, definition);
  }
}
const entries = [...byId.values()]
  .sort((left, right) => left.kdenliveId.localeCompare(right.kdenliveId))
  .map((definition) => {
    const mediaType = definition.mediaType === 'audio' ? 'audio' : 'video';
    const { category, deprecated } = categorize(
      definition.kdenliveId,
      mediaType,
    );
    return {
      kdenliveId: definition.kdenliveId,
      service: definition.service,
      displayName: definition.displayName,
      category,
      mediaType,
      ...(deprecated ? { deprecated: true } : {}),
      ...(definition.dependencies.length === 0
        ? {}
        : { dependencies: definition.dependencies }),
      ...(definition.version === 0
        ? {}
        : { kdenliveVersion: definition.version }),
      parameters: definition.parameters,
    };
  });
const source = `// Generated by scripts/generate-kdenlive-effect-catalog.mjs. Do not edit.
// Interface metadata derived from Kdenlive's video and audio effect definitions.
import type { KdenliveEffectDefinition } from './effect-catalog.js';

export const KDENLIVE_EFFECTS: readonly KdenliveEffectDefinition[] = ${JSON.stringify(entries, null, 2)};
`;
const output = join(
  root,
  'packages/project-core/src/kdenlive-effects.generated.ts',
);
await writeFile(output, source, 'utf8');
const counts = Object.entries(
  Object.groupBy(entries, (entry) => entry.category),
)
  .map(([category, items]) => `${category} ${String(items.length)}`)
  .join(', ');
process.stdout.write(
  `Wrote ${String(entries.length)} effects from ${dataDir} to ${output}\n${counts}\n` +
    (skipped.length > 0
      ? `Skipped (legacy LADSPA wrappers, timewarp): ${skipped.join(', ')}\n`
      : ''),
);
