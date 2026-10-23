// Regenerates packages/project-core/src/kdenlive-color-effects.generated.ts from
// a local Kdenlive installation's effect definitions. Only interface metadata
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
const CATEGORY = 'Color and Image Correction';
const SKIPPED_TYPES = new Set(['curve', 'readonly', 'filterjob', 'keywords']);

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
  const type = valueType(attrs.type);
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
      output.relativeTo = attrs.factor.replace(/^%/u, '');
    } else {
      if (min !== undefined) output.minimum = round(min / factor);
      if (max !== undefined) output.maximum = round(max / factor);
    }
    const fallback = numeric(attrs.default);
    if (fallback !== undefined) output.default = fallback;
    if (attrs.suffix) output.unit = attrs.suffix;
    if (factor !== 1 && numeric(attrs.factor) !== undefined)
      output.kdenliveFactor = factor;
  } else if (type === 'boolean') {
    output.default = attrs.default === '1' || attrs.default === 'true';
  } else if (attrs.default !== undefined && !attrs.default.startsWith('%')) {
    output.default = attrs.default;
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
        parameters,
      };
    },
  );
}

const categories = await readFile(
  join(dataDir, 'kdenliveeffectscategory.rc'),
  'utf8',
);
const group = [
  ...categories.matchAll(
    /<group list="([^"]*)"[^>]*>\s*<text>([^<]*)<\/text>/gu,
  ),
].find((match) => match[2] === CATEGORY);
if (group === undefined) throw new Error(`Category not found: ${CATEGORY}`);
const wanted = new Set(group[1].split(','));

const byId = new Map();
for (const file of (await readdir(join(dataDir, 'effects'))).sort()) {
  if (!file.endsWith('.xml')) continue;
  const xml = await readFile(join(dataDir, 'effects', file), 'utf8');
  for (const definition of effectDefinitions(xml)) {
    if (!wanted.has(definition.kdenliveId)) continue;
    if (
      definition.mediaType !== 'video' ||
      definition.displayName === undefined
    )
      continue;
    const previous = byId.get(definition.kdenliveId);
    if (previous === undefined || previous.version <= definition.version)
      byId.set(definition.kdenliveId, definition);
  }
}
const entries = [...byId.values()]
  .sort((left, right) => left.kdenliveId.localeCompare(right.kdenliveId))
  .map((definition) => ({
    kdenliveId: definition.kdenliveId,
    service: definition.service,
    displayName: definition.displayName,
    parameters: definition.parameters,
    ...(definition.version === 0
      ? {}
      : { kdenliveVersion: definition.version }),
    category: 'color',
  }));
const missing = [...wanted].filter((id) => !byId.has(id)).sort();
const source = `// Generated by scripts/generate-kdenlive-effect-catalog.mjs. Do not edit.
// Interface metadata derived from Kdenlive's "${CATEGORY}" effect definitions.
import type { KdenliveEffectDefinition } from './effect-catalog.js';

export const KDENLIVE_COLOR_EFFECTS: readonly KdenliveEffectDefinition[] = ${JSON.stringify(entries, null, 2)};
`;
const output = join(
  root,
  'packages/project-core/src/kdenlive-color-effects.generated.ts',
);
await writeFile(output, source, 'utf8');
process.stdout.write(
  `Wrote ${String(entries.length)} effects from ${dataDir} to ${output}\n` +
    (missing.length > 0 ? `Not found: ${missing.join(', ')}\n` : ''),
);
