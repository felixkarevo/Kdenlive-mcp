import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { productionDependencies } from './lib/production-dependencies.mjs';

const root = resolve(import.meta.dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const output = resolve(
  root,
  outputIndex < 0 ? 'artifacts/licenses' : process.argv[outputIndex + 1],
);
const byName = new Map();
for (const item of await productionDependencies(root)) {
  const existing = byName.get(item.name);
  if (existing === undefined)
    byName.set(item.name, { ...item, versions: [item.version] });
  else if (!existing.versions.includes(item.version))
    existing.versions.push(item.version);
}
const rows = [...byName.values()].map((item) => ({
  name: item.name,
  versions: item.versions.sort(),
  license: item.license,
  author: item.author,
  homepage: item.homepage,
}));
rows.sort((a, b) => a.name.localeCompare(b.name));
const markdown = [
  '# Production Node dependency licenses',
  '',
  'Generated from the locked production dependency graph. Package license files in the release archive remain authoritative.',
  '',
  '| Package | Version(s) | License |',
  '| --- | --- | --- |',
  ...rows.map(
    (row) => `| ${row.name} | ${row.versions.join(', ')} | ${row.license} |`,
  ),
  '',
].join('\n');
await mkdir(output, { recursive: true });
await writeFile(
  join(output, 'node-production-licenses.json'),
  `${JSON.stringify(rows, null, 2)}\n`,
  'utf8',
);
await writeFile(join(output, 'node-production-licenses.md'), markdown, 'utf8');
process.stdout.write(`${output}\n`);
