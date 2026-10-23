import { listKdenliveEffects } from '@kdenlive-mcp/project-core';
import {
  probeCapabilities,
  SpawnCommandRunner,
} from '@kdenlive-mcp/runtime-probe';

export interface DoctorCheck {
  readonly id: string;
  readonly status: 'pass' | 'warning' | 'fail';
  readonly message: string;
  readonly fix?: string;
}

export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
  readonly capabilities: Awaited<ReturnType<typeof probeCapabilities>>;
}

export async function runDoctor(): Promise<DoctorReport> {
  const capabilities = await probeCapabilities({
    runner: new SpawnCommandRunner(),
  });
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(
    nodeMajor >= 22
      ? {
          id: 'node',
          status: 'pass',
          message: `Node.js ${process.versions.node}`,
        }
      : {
          id: 'node',
          status: 'fail',
          message: `Node.js ${process.versions.node} is unsupported`,
          fix: 'Install Node.js 22 or newer.',
        },
  );
  for (const [id, executable] of [
    ['ffmpeg', capabilities.ffmpeg],
    ['ffprobe', capabilities.ffprobe],
    ['melt', capabilities.mlt],
  ] as const) {
    checks.push(
      executable.available
        ? {
            id,
            status: 'pass',
            message: `${executable.version ?? 'version unknown'} at ${executable.path ?? 'unknown path'}`,
          }
        : {
            id,
            status: 'fail',
            message: `${id} was not discovered or could not run`,
            fix:
              id === 'melt'
                ? 'Install Kdenlive/MLT or set KDENLIVE_ROOT, MLT_ROOT, or MELT_PATH. Snap and Flatpak Kdenlive builds keep melt sandboxed; install the distribution melt package as well.'
                : `Install FFmpeg or set ${id.toUpperCase()}_PATH.`,
          },
    );
  }
  const requiredMlt = [
    ['producer', 'avformat', capabilities.mlt.producers],
    ['consumer', 'avformat', capabilities.mlt.consumers],
    ['filter', 'qtext', capabilities.mlt.filters],
    ['filter', 'avfilter.subtitles', capabilities.mlt.filters],
    ['transition', 'qtblend', capabilities.mlt.transitions],
    ['transition', 'mix', capabilities.mlt.transitions],
  ] as const;
  for (const [kind, service, available] of requiredMlt) {
    if (!capabilities.mlt.available) break;
    checks.push(
      available.includes(service)
        ? {
            id: `mlt-${kind}-${service}`,
            status: 'pass',
            message: `MLT ${kind} ${service} is available`,
          }
        : {
            id: `mlt-${kind}-${service}`,
            status: service === 'qtext' ? 'warning' : 'fail',
            message: `MLT ${kind} ${service} is unavailable`,
            fix: 'Use a complete Kdenlive/MLT installation with Qt and avformat modules.',
          },
    );
  }
  if (capabilities.mlt.available) {
    const colorEffects = listKdenliveEffects({
      availableFilters: capabilities.mlt.filters,
    });
    const missing = colorEffects.filter((effect) => effect.available === false);
    const missingFrei0r = missing.some((effect) =>
      effect.service.startsWith('frei0r.'),
    );
    checks.push(
      missing.length === 0
        ? {
            id: 'color-effects',
            status: 'pass',
            message: `All ${String(colorEffects.length)} Kdenlive color correction effects are available`,
          }
        : {
            id: 'color-effects',
            status: 'warning',
            message: `${String(missing.length)} of ${String(colorEffects.length)} Kdenlive color correction effects are unavailable: ${missing.map((effect) => effect.kdenliveId).join(', ')}`,
            fix: missingFrei0r
              ? 'Install the frei0r plugins for MLT (Debian/Ubuntu: sudo apt install frei0r-plugins; Fedora: frei0r-plugins).'
              : 'Use a complete Kdenlive/MLT installation with avfilter and plus modules.',
          },
    );
  }
  for (const encoder of ['ffv1', 'libx264', 'aac', 'pcm_s16le']) {
    if (!capabilities.ffmpeg.available) break;
    checks.push(
      capabilities.ffmpeg.encoders.includes(encoder)
        ? {
            id: `encoder-${encoder}`,
            status: 'pass',
            message: `FFmpeg encoder ${encoder} is available`,
          }
        : {
            id: `encoder-${encoder}`,
            status:
              encoder === 'ffv1' || encoder === 'pcm_s16le'
                ? 'fail'
                : 'warning',
            message: `FFmpeg encoder ${encoder} is unavailable`,
            fix: 'Install a full FFmpeg build or choose another validated export profile.',
          },
    );
  }
  return {
    schemaVersion: 1,
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
    capabilities,
  };
}
