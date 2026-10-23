import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { productionDependencies } from './lib/production-dependencies.mjs';

const root = resolve(import.meta.dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const output = resolve(
  root,
  outputIndex < 0 ? 'artifacts/sbom' : process.argv[outputIndex + 1],
);
const packageJson = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);

const components = new Map();
for (const item of await productionDependencies(root)) {
  const purl = `pkg:npm/${encodeURIComponent(item.name)}@${item.version}`;
  components.set(`${item.name}@${item.version}`, {
    type: 'library',
    'bom-ref': purl,
    name: item.name,
    version: item.version,
    purl,
  });
}
const sorted = [...components.values()].sort((a, b) =>
  a['bom-ref'].localeCompare(b['bom-ref']),
);
const timestamp = new Date().toISOString();
const cyclonedx = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp,
    component: {
      type: 'application',
      name: packageJson.name,
      version: packageJson.version,
      'bom-ref': `pkg:npm/${packageJson.name}@${packageJson.version}`,
    },
  },
  components: sorted,
};
const spdxPackages = sorted.map((component, index) => ({
  SPDXID: `SPDXRef-Package-${String(index + 1)}`,
  name: component.name,
  versionInfo: component.version,
  downloadLocation: 'NOASSERTION',
  filesAnalyzed: false,
  licenseConcluded: 'NOASSERTION',
  licenseDeclared: 'NOASSERTION',
  externalRefs: [
    {
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: component.purl,
    },
  ],
}));
const spdx = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${packageJson.name}-${packageJson.version}`,
  documentNamespace: `https://github.com/felixkarevo/kdenlive-mcp/sbom/${createHash('sha256').update(timestamp).digest('hex')}`,
  creationInfo: {
    created: timestamp,
    creators: ['Tool: scripts/generate-sbom.mjs'],
  },
  packages: [
    {
      SPDXID: 'SPDXRef-Application',
      name: packageJson.name,
      versionInfo: packageJson.version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'Apache-2.0',
      licenseDeclared: 'Apache-2.0',
    },
    ...spdxPackages,
  ],
  relationships: spdxPackages.map((item) => ({
    spdxElementId: 'SPDXRef-Application',
    relationshipType: 'DEPENDS_ON',
    relatedSpdxElement: item.SPDXID,
  })),
};
await mkdir(output, { recursive: true });
await writeFile(
  join(output, 'bom.cdx.json'),
  `${JSON.stringify(cyclonedx, null, 2)}\n`,
  'utf8',
);
await writeFile(
  join(output, 'bom.spdx.json'),
  `${JSON.stringify(spdx, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`${output}\n`);
