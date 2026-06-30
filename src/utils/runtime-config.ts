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
    fengineUrl: (process.env.FENGINE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    internalApiKey: process.env.INTERNAL_API_KEY || '',
    internalRequestTimeoutMs: Number(process.env.INTERNAL_REQUEST_TIMEOUT_MS || 10000),
    paymentProcessStore: process.env.FWK_PAYMENT_PROCESS_STORE || 'postgres',
    paymentSettlementOutboxEnabled: process.env.FPAY_SETTLEMENT_OUTBOX_ENABLED === 'true',
    paymentReconciliationLimit: Number(process.env.FPAY_RECONCILIATION_LIMIT || 100),
    fengineStatusEnabled: process.env.FENGINE_STATUS_ENABLED !== 'false',
    fengineProjectionStatusEnabled: process.env.FENGINE_PROJECTION_STATUS_ENABLED !== 'false',
    queueBackend: process.env.FWK_QUEUE_BACKEND || 'redis',
    workerEnabled: process.env.FWK_WORKER_ENABLED !== 'false',
    schedulerEnabled: process.env.FWK_SCHEDULER_ENABLED !== 'false',
    workerPollMs: Number(process.env.FWK_WORKER_POLL_MS || 1000),
    workerBackoffMs: Number(process.env.FWK_WORKER_BACKOFF_MS || 5000),
    queues: (process.env.FWK_QUEUES || 'payments,platform').split(',').map((queue) => queue.trim()).filter(Boolean),
  };
}
