/*
 * MAVULA Workbench Runtime Configuration
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function boolEnv(name: string, legacyName: string, defaultValue: boolean): boolean {
  const value = env(name, env(legacyName));
  if (value === undefined) {
    return defaultValue;
  }
  return value !== 'false';
}

function numberEnv(name: string, legacyName: string, defaultValue: number): number {
  return Number(env(name, env(legacyName, String(defaultValue))));
}

export function getRuntimeConfig() {
  const ledgerCoreUrl = env('LEDGER_CORE_URL', env('FENGINE_URL', 'http://localhost:3000'))!.replace(/\/$/, '');
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://mavula:mavula_dev@localhost:15432/mavula?schema=public';
  const queues = env('WORKBENCH_QUEUES', env('FWK_QUEUES', 'payments,platform,legacy'))!
    .split(',')
    .map((queue) => queue.trim())
    .filter(Boolean);

  return {
    serviceName: 'workbench',
    version: process.env.npm_package_version || '0.1.0',
    port: Number(process.env.PORT || 3010),
    redisUrl: process.env.REDIS_URL || 'redis://localhost:16379',
    databaseUrl,
    legacyConnectorsDatabaseUrl: env('LEGACY_CONNECTORS_DATABASE_URL', databaseUrl)!,
    legacyBatchStore: env('WORKBENCH_LEGACY_BATCH_STORE', 'postgres')!,
    ledgerCoreUrl,
    fengineUrl: ledgerCoreUrl,
    oidcIssuer: process.env.OIDC_ISSUER || '',
    oidcAudience: process.env.OIDC_AUDIENCE || '',
    oidcJwksUri: process.env.OIDC_JWKS_URI || '',
    oidcTokenEndpoint: process.env.OIDC_TOKEN_ENDPOINT || '',
    oidcClientId: process.env.WORKBENCH_OIDC_CLIENT_ID || '',
    oidcPrivateJwk: process.env.WORKBENCH_PRIVATE_JWK_JSON || '',
    ledgerCoreAudience: process.env.LEDGER_CORE_AUDIENCE || 'urn:mavula:ledger-core',
    internalRequestTimeoutMs: Number(process.env.INTERNAL_REQUEST_TIMEOUT_MS || 10000),
    paymentProcessStore: env('WORKBENCH_PAYMENT_PROCESS_STORE', env('FWK_PAYMENT_PROCESS_STORE', 'postgres'))!,
    paymentSettlementOutboxEnabled: env('SETTLEMENTS_OUTBOX_ENABLED', env('FPAY_SETTLEMENT_OUTBOX_ENABLED')) === 'true',
    paymentOutboxPublisherEnabled: env('SETTLEMENTS_OUTBOX_PUBLISHER_ENABLED', env('FPAY_OUTBOX_PUBLISHER_ENABLED')) === 'true',
    paymentOutboxPublisherPollMs: numberEnv('SETTLEMENTS_OUTBOX_PUBLISHER_POLL_MS', 'FPAY_OUTBOX_PUBLISHER_POLL_MS', 1000),
    paymentOutboxPublisherBatchSize: numberEnv(
      'SETTLEMENTS_OUTBOX_PUBLISHER_BATCH_SIZE',
      'FPAY_OUTBOX_PUBLISHER_BATCH_SIZE',
      25,
    ),
    paymentOutboxPublisherLeaseMs: numberEnv('SETTLEMENTS_OUTBOX_PUBLISHER_LEASE_MS', 'FPAY_OUTBOX_PUBLISHER_LEASE_MS', 30000),
    paymentReconciliationLimit: numberEnv('SETTLEMENTS_RECONCILIATION_LIMIT', 'FPAY_RECONCILIATION_LIMIT', 100),
    fengineStatusEnabled: boolEnv('LEDGER_CORE_STATUS_ENABLED', 'FENGINE_STATUS_ENABLED', true),
    fengineProjectionStatusEnabled: boolEnv('LEDGER_CORE_PROJECTION_STATUS_ENABLED', 'FENGINE_PROJECTION_STATUS_ENABLED', true),
    queueBackend: env('WORKBENCH_QUEUE_BACKEND', env('FWK_QUEUE_BACKEND', 'redis'))!,
    workerEnabled: boolEnv('WORKBENCH_WORKER_ENABLED', 'FWK_WORKER_ENABLED', true),
    schedulerEnabled: boolEnv('WORKBENCH_SCHEDULER_ENABLED', 'FWK_SCHEDULER_ENABLED', true),
    workerPollMs: numberEnv('WORKBENCH_WORKER_POLL_MS', 'FWK_WORKER_POLL_MS', 1000),
    workerBackoffMs: numberEnv('WORKBENCH_WORKER_BACKOFF_MS', 'FWK_WORKER_BACKOFF_MS', 5000),
    queues,
  };
}
