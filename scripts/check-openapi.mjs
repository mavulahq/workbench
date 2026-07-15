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
console.log(`workbench OpenAPI covers ${paths.size} public routes`);
