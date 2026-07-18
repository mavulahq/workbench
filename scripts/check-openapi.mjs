import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'contracts/openapi/workbench.public.v1.yaml'), 'utf8');
const paths = new Set([...source.matchAll(/^  (\/[^:]+):$/gm)].map((match) => match[1]));
const expected = [
  '/api/jobs', '/api/jobs/{jobId}', '/api/regulatory-exports', '/api/legacy-imports', '/api/legacy-batches',
  '/api/legacy-batches/{batchId}', '/api/legacy-batches/{batchId}/artifact',
  '/api/legacy-batches/{batchId}/rejections', '/api/regulatory-exports/{batchId}/delivery',
  '/api/status', '/api/status/queues', '/api/status/schedules',
];
for (const route of expected) if (!paths.has(route)) throw new Error(`OpenAPI route missing: ${route}`);
for (const route of paths) if (/health|metrics|internal/.test(route)) throw new Error(`Operational or internal route exposed: ${route}`);
const operationIds = [...source.matchAll(/^\s{6}operationId: (\S+)$/gm)].map((match) => match[1]);
const summaries = [...source.matchAll(/^\s{6}summary: .+$/gm)];
const permissions = [...source.matchAll(/^\s{6}x-mavula-permissions:/gm)];
if (operationIds.length !== 12 || new Set(operationIds).size !== operationIds.length) {
  throw new Error('Workbench OpenAPI operationId coverage is incomplete or duplicated');
}
if (summaries.length !== operationIds.length || permissions.length !== operationIds.length) {
  throw new Error('Every Workbench operation must declare summary and permission metadata');
}
for (const schema of ['CreateJob', 'WorkerJob', 'LegacyBatchReceipt', 'LegacyRejectionReport', 'PlatformStatus']) {
  if (!source.includes(`    ${schema}:`)) throw new Error(`OpenAPI schema missing: ${schema}`);
}
const declaredSchemas = new Set(
  [...source.matchAll(/^    ([A-Za-z][A-Za-z0-9]+):$/gm)].map((match) => match[1]),
);
for (const reference of source.matchAll(/\$ref: '#\/components\/schemas\/([A-Za-z][A-Za-z0-9]+)'/g)) {
  if (!declaredSchemas.has(reference[1])) throw new Error(`OpenAPI schema reference missing: ${reference[1]}`);
}
console.log(`workbench OpenAPI covers ${paths.size} public routes`);
