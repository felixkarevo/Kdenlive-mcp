import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
const platformIndex = process.argv.indexOf('--platform');
const platform =
  platformIndex < 0
    ? process.platform === 'win32'
      ? 'windows'
      : 'linux'
    : process.argv[platformIndex + 1];
if (platform !== 'windows' && platform !== 'linux')
  throw new Error('Unsupported platform');
const bunCli =
  process.versions.bun !== undefined
    ? process.execPath
    : (process.env.BUN_PATH ??
      (process.platform === 'win32' ? 'bun.exe' : 'bun'));

async function bun(args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(bunCli, ['run', ...args], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`bun run ${args[0]} failed`)),
    );
  });
}

await bun(['check']);
await bun(['docs:check']);
await bun(['render:acceptance']);
await bun(['mcp:acceptance']);
await bun(['sbom']);
await bun(['package:release', '--platform', platform]);
const stage = `artifacts/release/kdenlive-mcp-${packageJson.version}-${platform}-x64`;
await bun(['release:verify', '--path', stage]);
const archive = resolve(
  root,
  `${stage}.${platform === 'windows' ? 'zip' : 'tar.gz'}`,
);
const bytes = await readFile(archive);
const report = {
  schemaVersion: 1,
  version: packageJson.version,
  platform,
  generatedAt: new Date().toISOString(),
  deferredMilestones: [5, 6],
  archive: {
    name: basename(archive),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  renderAcceptance: JSON.parse(
    await readFile(
      join(root, 'artifacts/milestone-3-acceptance/acceptance-report.json'),
      'utf8',
    ),
  ),
  mcpAcceptance: JSON.parse(
    await readFile(
      join(root, 'artifacts/milestone-4-acceptance/acceptance-report.json'),
      'utf8',
    ),
  ),
};
const output = join(root, 'artifacts', 'milestone-7-acceptance');
await mkdir(output, { recursive: true });
await writeFile(
  join(output, 'acceptance-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`${join(output, 'acceptance-report.json')}\n`);
