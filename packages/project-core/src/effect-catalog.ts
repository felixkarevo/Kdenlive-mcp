import { KDENLIVE_COLOR_EFFECTS } from './kdenlive-color-effects.generated.js';

export type EffectParameterType =
  'number' | 'string' | 'boolean' | 'color' | 'list' | 'file';

export interface EffectParameterOption {
  readonly value: string;
  readonly label: string;
}

/**
 * One MLT property of an effect. Ranges and defaults are raw MLT values, the
 * same values written to the filter, not the scaled values Kdenlive displays.
 */
export interface EffectParameterDefinition {
  readonly name: string;
  readonly type: EffectParameterType;
  readonly label?: string;
  readonly kdenliveType?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly default?: number | string | boolean;
  readonly unit?: string;
  /** Kdenlive shows `value * kdenliveFactor` in its UI. */
  readonly kdenliveFactor?: number;
  /** The range scales with the named profile dimension (width or height). */
  readonly relativeTo?: string;
  readonly options?: readonly EffectParameterOption[];
  readonly fileFilter?: string;
  readonly animatable: boolean;
}

export type EffectCategory = 'color';

export interface KdenliveEffectDefinition {
  readonly kdenliveId: string;
  readonly service: string;
  readonly displayName: string;
  readonly category: EffectCategory;
  readonly kdenliveVersion?: number;
  readonly parameters: readonly EffectParameterDefinition[];
}

export interface EffectCatalogEntry {
  readonly service: string;
  readonly kdenliveId?: string;
  readonly kind: 'filter' | 'transition';
  readonly displayName: string;
  readonly category?: EffectCategory;
  readonly parameters: readonly EffectParameterDefinition[];
  readonly rawPropertiesAllowed: true;
}

export interface EffectCatalog {
  readonly schemaVersion: 1;
  readonly mltVersion: string | null;
  readonly entries: readonly EffectCatalogEntry[];
}

const KNOWN_PARAMETERS: Readonly<
  Record<string, readonly EffectParameterDefinition[]>
> = {
  volume: [
    { name: 'level', type: 'number', minimum: 0, default: 1, animatable: true },
  ],
  luma: [
    { name: 'resource', type: 'string', default: '', animatable: false },
    { name: 'reverse', type: 'boolean', default: false, animatable: false },
  ],
  mix: [{ name: 'sum', type: 'boolean', default: true, animatable: false }],
};

const KDENLIVE_EFFECTS: readonly KdenliveEffectDefinition[] =
  KDENLIVE_COLOR_EFFECTS;

function displayName(service: string): string {
  return service
    .replace(/^avfilter\./u, '')
    .split(/[_.-]/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

/** Looks up a Kdenlive effect by its Kdenlive ID, falling back to the MLT service. */
export function findKdenliveEffect(
  idOrService: string,
): KdenliveEffectDefinition | undefined {
  return (
    KDENLIVE_EFFECTS.find((effect) => effect.kdenliveId === idOrService) ??
    KDENLIVE_EFFECTS.find((effect) => effect.service === idOrService)
  );
}

/**
 * Names of file-path parameters for an MLT service, across every Kdenlive
 * effect built on it. Keyed by service so a mismatched kdenliveId cannot hide
 * a file parameter.
 */
export function fileParameterNames(service: string): string[] {
  return [
    ...new Set(
      KDENLIVE_EFFECTS.filter((effect) => effect.service === service).flatMap(
        (effect) =>
          effect.parameters
            .filter((parameter) => parameter.type === 'file')
            .map((parameter) => parameter.name),
      ),
    ),
  ].sort();
}

export interface KdenliveEffectListing extends KdenliveEffectDefinition {
  /** Null when no runtime capability snapshot was supplied. */
  readonly available: boolean | null;
}

export function listKdenliveEffects(
  options: {
    readonly availableFilters?: readonly string[];
  } = {},
): KdenliveEffectListing[] {
  const available =
    options.availableFilters === undefined
      ? null
      : new Set(options.availableFilters);
  return KDENLIVE_EFFECTS.map((effect) => ({
    ...effect,
    available: available === null ? null : available.has(effect.service),
  }));
}

export function buildEffectCatalog(input: {
  readonly mltVersion?: string | null;
  readonly filters: readonly string[];
  readonly transitions: readonly string[];
}): EffectCatalog {
  const filterEntries = input.filters.flatMap(
    (service): EffectCatalogEntry[] => {
      const definitions = KDENLIVE_EFFECTS.filter(
        (effect) => effect.service === service,
      );
      if (definitions.length === 0)
        return [
          {
            service,
            kind: 'filter' as const,
            displayName: displayName(service),
            parameters: KNOWN_PARAMETERS[service] ?? [],
            rawPropertiesAllowed: true as const,
          },
        ];
      return definitions.map((definition) => ({
        service,
        kdenliveId: definition.kdenliveId,
        kind: 'filter' as const,
        displayName: definition.displayName,
        category: definition.category,
        parameters: definition.parameters,
        rawPropertiesAllowed: true as const,
      }));
    },
  );
  const entries: EffectCatalogEntry[] = [
    ...filterEntries,
    ...input.transitions.map((service): EffectCatalogEntry => ({
      service,
      kind: 'transition' as const,
      displayName: displayName(service),
      parameters: KNOWN_PARAMETERS[service] ?? [],
      rawPropertiesAllowed: true as const,
    })),
  ].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.service.localeCompare(right.service) ||
      (left.kdenliveId ?? '').localeCompare(right.kdenliveId ?? ''),
  );
  return { schemaVersion: 1, mltVersion: input.mltVersion ?? null, entries };
}

export interface EffectParameterIssue {
  readonly code:
    | 'EFFECT_PARAMETER_UNKNOWN'
    | 'EFFECT_PARAMETER_TYPE'
    | 'EFFECT_PARAMETER_RANGE'
    | 'EFFECT_PARAMETER_OPTION'
    | 'EFFECT_PARAMETER_NOT_ANIMATABLE';
  readonly parameter: string;
  readonly message: string;
}

const COLOR_VALUE =
  /^(?:#[0-9a-f]{6}(?:[0-9a-f]{2})?|0x[0-9a-f]{6}(?:[0-9a-f]{2})?)(?:\s+[0-9.]+)?$/iu;

function valueIssue(
  definition: EffectParameterDefinition,
  value: number | string | boolean,
): Omit<EffectParameterIssue, 'parameter'> | null {
  const name = definition.name;
  if (definition.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (typeof value === 'boolean' || !Number.isFinite(numeric))
      return {
        code: 'EFFECT_PARAMETER_TYPE',
        message: `${name} expects a number`,
      };
    if (
      (definition.minimum !== undefined && numeric < definition.minimum) ||
      (definition.maximum !== undefined && numeric > definition.maximum)
    )
      return {
        code: 'EFFECT_PARAMETER_RANGE',
        message: `${name}=${String(numeric)} is outside Kdenlive's range ${String(definition.minimum ?? '-inf')}..${String(definition.maximum ?? 'inf')}`,
      };
  }
  if (definition.type === 'boolean' && typeof value === 'string') {
    if (!['0', '1', 'true', 'false'].includes(value))
      return {
        code: 'EFFECT_PARAMETER_TYPE',
        message: `${name} expects a boolean`,
      };
  }
  if (
    definition.type === 'color' &&
    (typeof value !== 'string' || !COLOR_VALUE.test(value.trim()))
  )
    return {
      code: 'EFFECT_PARAMETER_TYPE',
      message: `${name} expects a color such as 0xrrggbbaa or #aarrggbb`,
    };
  if (
    definition.type === 'list' &&
    definition.options !== undefined &&
    !definition.options.some(
      (option) =>
        option.value === String(value) ||
        (typeof value === 'number' && Number(option.value) === value),
    )
  )
    return {
      code: 'EFFECT_PARAMETER_OPTION',
      message: `${name} must be one of ${definition.options.map((option) => option.value).join(', ')}`,
    };
  return null;
}

/** Checks parameters against Kdenlive's definition; unknown effects pass. */
export function effectParameterIssues(effect: {
  readonly service: string;
  readonly kdenliveId?: string | undefined;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly keyframes: Readonly<
    Record<string, readonly { readonly value: number | string | boolean }[]>
  >;
}): EffectParameterIssue[] {
  const definition = findKdenliveEffect(effect.kdenliveId ?? effect.service);
  if (definition?.service !== effect.service) return [];
  const parameters = new Map(
    definition.parameters.map((parameter) => [parameter.name, parameter]),
  );
  const issues: EffectParameterIssue[] = [];
  const check = (name: string, value: number | string | boolean): void => {
    const parameter = parameters.get(name);
    if (parameter === undefined) {
      if (!name.startsWith('kdenlive:'))
        issues.push({
          code: 'EFFECT_PARAMETER_UNKNOWN',
          parameter: name,
          message: `${definition.kdenliveId} has no Kdenlive parameter named ${name}`,
        });
      return;
    }
    const issue = valueIssue(parameter, value);
    if (issue !== null) issues.push({ ...issue, parameter: name });
  };
  for (const [name, value] of Object.entries(effect.parameters))
    check(name, value);
  for (const [name, keyframes] of Object.entries(effect.keyframes)) {
    if (parameters.get(name)?.animatable === false)
      issues.push({
        code: 'EFFECT_PARAMETER_NOT_ANIMATABLE',
        parameter: name,
        message: `Kdenlive does not keyframe ${definition.kdenliveId}.${name}`,
      });
    for (const keyframe of keyframes) check(name, keyframe.value);
  }
  return issues;
}

/**
 * Resolves the MLT service for a Kdenlive effect ID and fills the defaults
 * Kdenlive would write for parameters that are neither set nor keyframed.
 */
export function resolveKdenliveEffect(input: {
  readonly service?: string | undefined;
  readonly kdenliveId?: string | undefined;
  readonly parameters?: Readonly<Record<string, number | string | boolean>>;
  readonly keyframes?: Readonly<Record<string, unknown>>;
  readonly fillDefaults?: boolean;
}): {
  service: string;
  kdenliveId?: string;
  parameters: Record<string, number | string | boolean>;
} {
  const parameters = { ...(input.parameters ?? {}) };
  const definition =
    input.kdenliveId === undefined
      ? input.service === undefined
        ? undefined
        : findKdenliveEffect(input.service)
      : findKdenliveEffect(input.kdenliveId);
  if (input.kdenliveId !== undefined && definition === undefined) {
    if (input.service === undefined)
      throw new RangeError(
        `Unknown Kdenlive effect ID: ${input.kdenliveId}. Pass service as well to use a raw MLT filter.`,
      );
    return { service: input.service, kdenliveId: input.kdenliveId, parameters };
  }
  if (
    definition === undefined ||
    (input.service !== undefined && definition.service !== input.service)
  ) {
    if (input.service === undefined)
      throw new RangeError('Effect requires service or kdenliveId');
    return { service: input.service, parameters };
  }
  if (input.fillDefaults !== false) {
    const keyframed = new Set(Object.keys(input.keyframes ?? {}));
    for (const parameter of definition.parameters) {
      if (
        parameter.default === undefined ||
        parameter.name in parameters ||
        keyframed.has(parameter.name) ||
        parameter.name.startsWith('kdenlive:')
      )
        continue;
      parameters[parameter.name] =
        parameter.type === 'boolean'
          ? parameter.default === true
            ? 1
            : 0
          : parameter.default;
    }
  }
  return {
    service: definition.service,
    kdenliveId: definition.kdenliveId,
    parameters,
  };
}
