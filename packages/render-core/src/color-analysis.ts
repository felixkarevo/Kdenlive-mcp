export interface ChannelTriplet {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface ToneZone {
  /** Fraction of analyzed pixels that fall in this luma zone. */
  readonly coverage: number;
  /** Mean gamma-encoded RGB (0..1) of the pixels in the zone. */
  readonly mean: ChannelTriplet;
}

export interface ColorStatistics {
  readonly width: number;
  readonly height: number;
  /** Rec. 709 luma of the gamma-encoded RGB values, 0..1. */
  readonly luma: {
    readonly min: number;
    readonly p1: number;
    readonly p5: number;
    readonly median: number;
    readonly mean: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
    /** 16 equal-width bins from black to white; fractions sum to 1. */
    readonly histogram: readonly number[];
  };
  readonly channelMean: ChannelTriplet;
  /** Fractions of pixels at or below 2/255 (crushed) or at or above 253/255 (clipped). */
  readonly clipping: {
    readonly shadows: ChannelTriplet;
    readonly highlights: ChannelTriplet;
    readonly anyShadow: number;
    readonly anyHighlight: number;
  };
  /** Chroma (max - min of RGB), 0..1. */
  readonly saturation: { readonly mean: number; readonly p95: number };
  readonly zones: {
    readonly shadows: ToneZone;
    readonly midtones: ToneZone;
    readonly highlights: ToneZone;
  };
  /**
   * Average channel offset from green over low-saturation pixels. Positive
   * redMinusGreen with negative blueMinusGreen reads as warm; the reverse as
   * cool. Values near 0 mean neutrals are neutral.
   */
  readonly neutralCast: {
    readonly sampleFraction: number;
    readonly redMinusGreen: number;
    readonly blueMinusGreen: number;
  };
  readonly notes: readonly string[];
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function percentile(sorted: Float64Array, fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[index] ?? 0;
}

function triplet(r: number, g: number, b: number): ChannelTriplet {
  return { r: round(r), g: round(g), b: round(b) };
}

/** Computes grading-oriented statistics from packed 8-bit RGB pixels. */
export function colorStatistics(
  rgb: Uint8Array,
  width: number,
  height: number,
): ColorStatistics {
  const count = width * height;
  if (count <= 0 || rgb.length < count * 3)
    throw new RangeError('RGB buffer does not match the frame size');
  const lumas = new Float64Array(count);
  const histogram = new Array<number>(16).fill(0);
  const sums = [0, 0, 0];
  const crushed = [0, 0, 0];
  const clipped = [0, 0, 0];
  let anyCrushed = 0;
  let anyClipped = 0;
  const chroma = new Float64Array(count);
  let chromaSum = 0;
  const zoneSums = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  let neutralCount = 0;
  let neutralRed = 0;
  let neutralBlue = 0;
  for (let index = 0; index < count; index += 1) {
    const r8 = rgb[index * 3] ?? 0;
    const g8 = rgb[index * 3 + 1] ?? 0;
    const b8 = rgb[index * 3 + 2] ?? 0;
    const r = r8 / 255;
    const g = g8 / 255;
    const b = b8 / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumas[index] = y;
    histogram[Math.min(15, Math.floor(y * 16))] =
      (histogram[Math.min(15, Math.floor(y * 16))] ?? 0) + 1;
    sums[0] = (sums[0] ?? 0) + r;
    sums[1] = (sums[1] ?? 0) + g;
    sums[2] = (sums[2] ?? 0) + b;
    let pixelCrushed = false;
    let pixelClipped = false;
    for (const [channel, value] of [r8, g8, b8].entries()) {
      if (value <= 2) {
        crushed[channel] = (crushed[channel] ?? 0) + 1;
        pixelCrushed = true;
      }
      if (value >= 253) {
        clipped[channel] = (clipped[channel] ?? 0) + 1;
        pixelClipped = true;
      }
    }
    if (pixelCrushed) anyCrushed += 1;
    if (pixelClipped) anyClipped += 1;
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    chroma[index] = c;
    chromaSum += c;
    const zone = y < 0.25 ? 0 : y > 0.75 ? 2 : 1;
    const target = zoneSums[zone];
    if (target !== undefined) {
      target[0] = (target[0] ?? 0) + r;
      target[1] = (target[1] ?? 0) + g;
      target[2] = (target[2] ?? 0) + b;
      target[3] = (target[3] ?? 0) + 1;
    }
    // Generous chroma limit so neutrals under a strong white-balance error
    // still count as neutral surfaces.
    if (c < 0.2 && y > 0.08 && y < 0.95) {
      neutralCount += 1;
      neutralRed += r - g;
      neutralBlue += b - g;
    }
  }
  lumas.sort();
  chroma.sort();
  const lumaMean = lumas.reduce((total, value) => total + value, 0) / count;
  const zone = (index: number): ToneZone => {
    const [r = 0, g = 0, b = 0, n = 0] = zoneSums[index] ?? [];
    return {
      coverage: round(n / count),
      mean: n === 0 ? triplet(0, 0, 0) : triplet(r / n, g / n, b / n),
    };
  };
  const stats = {
    width,
    height,
    luma: {
      min: round(lumas[0] ?? 0),
      p1: round(percentile(lumas, 0.01)),
      p5: round(percentile(lumas, 0.05)),
      median: round(percentile(lumas, 0.5)),
      mean: round(lumaMean),
      p95: round(percentile(lumas, 0.95)),
      p99: round(percentile(lumas, 0.99)),
      max: round(lumas[count - 1] ?? 0),
      histogram: histogram.map((value) => round(value / count)),
    },
    channelMean: triplet(
      (sums[0] ?? 0) / count,
      (sums[1] ?? 0) / count,
      (sums[2] ?? 0) / count,
    ),
    clipping: {
      shadows: triplet(
        (crushed[0] ?? 0) / count,
        (crushed[1] ?? 0) / count,
        (crushed[2] ?? 0) / count,
      ),
      highlights: triplet(
        (clipped[0] ?? 0) / count,
        (clipped[1] ?? 0) / count,
        (clipped[2] ?? 0) / count,
      ),
      anyShadow: round(anyCrushed / count),
      anyHighlight: round(anyClipped / count),
    },
    saturation: {
      mean: round(chromaSum / count),
      p95: round(percentile(chroma, 0.95)),
    },
    zones: { shadows: zone(0), midtones: zone(1), highlights: zone(2) },
    neutralCast: {
      sampleFraction: round(neutralCount / count),
      redMinusGreen: round(neutralCount === 0 ? 0 : neutralRed / neutralCount),
      blueMinusGreen: round(
        neutralCount === 0 ? 0 : neutralBlue / neutralCount,
      ),
    },
  };
  return { ...stats, notes: colorNotes(stats) };
}

function colorNotes(stats: Omit<ColorStatistics, 'notes'>): string[] {
  const notes: string[] = [];
  if (stats.clipping.anyHighlight > 0.02)
    notes.push(
      `${String(Math.round(stats.clipping.anyHighlight * 100))}% of pixels have a clipped channel; consider lowering gain or highlights.`,
    );
  if (stats.clipping.anyShadow > 0.05)
    notes.push(
      `${String(Math.round(stats.clipping.anyShadow * 100))}% of pixels have a crushed channel; consider raising lift or black level.`,
    );
  if (stats.luma.p99 < 0.7)
    notes.push(
      'Brightest highlights stay below 70% luma; the image may look dull or underexposed.',
    );
  if (stats.luma.p1 > 0.15)
    notes.push(
      'Darkest shadows stay above 15% luma; blacks may look lifted or washed out.',
    );
  if (stats.luma.mean < 0.25) notes.push('Average luma is low (dark image).');
  if (stats.luma.mean > 0.7) notes.push('Average luma is high (bright image).');
  const { redMinusGreen: rg, blueMinusGreen: bg } = stats.neutralCast;
  if (stats.neutralCast.sampleFraction > 0.02) {
    if (rg > 0.02 && bg < -0.01)
      notes.push('Neutral areas lean warm (red/yellow).');
    else if (bg > 0.02 && rg < 0.01)
      notes.push('Neutral areas lean cool (blue).');
    else if (rg < -0.015 && bg < -0.015)
      notes.push('Neutral areas lean green.');
    else if (rg > 0.015 && bg > 0.015)
      notes.push('Neutral areas lean magenta.');
  }
  if (stats.saturation.mean < 0.05)
    notes.push('Very low saturation (near monochrome).');
  else if (stats.saturation.p95 > 0.9)
    notes.push(
      'Some colors are near full saturation; watch for oversaturation.',
    );
  return notes;
}
