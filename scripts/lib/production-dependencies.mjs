import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

async function workspaceDirectories(root) {
  const rootPackage = await readJson(join(root, 'package.json'));
  const directories = [];
  for (const pattern of rootPackage?.workspaces ?? []) {
    if (!pattern.endsWith('/*')) {
      directories.push(join(root, pattern));
      continue;
    }
    const parent = join(root, pattern.slice(0, -2));
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(parent, entry.name));
    }
  }
  return directories;
}

async function locate(name, fromDirectory, root) {
  let directory = fromDirectory;
  for (;;) {
    const candidate = join(directory, 'node_modules', name);
    const manifest = await readJson(join(candidate, 'package.json'));
    if (manifest !== undefined) return { directory: candidate, manifest };
    if (directory === root) return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function licenseOf(manifest) {
  const license = manifest.license ?? manifest.licenses;
  if (typeof license === 'string') return license;
  if (Array.isArray(license))
    return license.map((item) => item.type ?? item).join(' OR ');
  if (typeof license === 'object' && license?.type) return license.type;
  return 'UNKNOWN';
}

function authorOf(manifest) {
  const author = manifest.author;
  if (typeof author === 'string') return author;
  return author?.name ?? null;
}

/**
 * Walks the installed production dependency graph of every workspace package,
 * skipping workspace-internal packages. Requires a hoisted node_modules layout
 * (see bunfig.toml).
 */
export async function productionDependencies(root) {
  const packages = new Map();
  const queue = [];
  for (const directory of await workspaceDirectories(root)) {
    const manifest = await readJson(join(directory, 'package.json'));
    for (const [name, range] of Object.entries(manifest?.dependencies ?? {})) {
      if (!String(range).startsWith('workspace:'))
        queue.push({ name, from: directory });
    }
  }
  while (queue.length > 0) {
    const { name, from } = queue.shift();
    const found = await locate(name, from, root);
    if (found === undefined)
      throw new Error(`Production dependency ${name} is not installed`);
    const { directory, manifest } = found;
    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) continue;
    packages.set(key, {
      name: manifest.name,
      version: manifest.version,
      license: licenseOf(manifest),
      author: authorOf(manifest),
      homepage: manifest.homepage ?? null,
    });
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      queue.push({ name: dependency, from: directory });
  }
  return [...packages.values()];
}
