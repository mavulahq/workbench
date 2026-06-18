/*
 * getfluxo.io - Worker Kit Runtime Configuration
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

export function getRuntimeConfig() {
  return {
    serviceName: 'fwk',
    version: process.env.npm_package_version || '0.1.0',
    port: Number(process.env.PORT || 3010),
    redisUrl: process.env.REDIS_URL || 'redis://localhost:16379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://getfluxo:getfluxo_dev@localhost:15432/getfluxo?schema=public',
    queueBackend: process.env.FWK_QUEUE_BACKEND || 'redis',
    workerEnabled: process.env.FWK_WORKER_ENABLED !== 'false',
    schedulerEnabled: process.env.FWK_SCHEDULER_ENABLED !== 'false',
    workerPollMs: Number(process.env.FWK_WORKER_POLL_MS || 1000),
    workerBackoffMs: Number(process.env.FWK_WORKER_BACKOFF_MS || 5000),
    queues: (process.env.FWK_QUEUES || 'payments,platform').split(',').map((queue) => queue.trim()).filter(Boolean),
  };
}
