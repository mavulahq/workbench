/*
 * MAVULA Workbench Public Platform Status
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { checkTcpUrl } from '../infra/tcp-health';
import { JobStoreService } from '../queue/job-store.service';
import { DependencyStatus, QueueStats } from '../types';
import { getRuntimeConfig } from '../utils/runtime-config';
import { SchedulerService } from '../worker/scheduler.service';
import { WorkerMetricsService } from '../worker/worker-metrics.service';
import { WorkerService } from '../worker/worker.service';

@Injectable()
export class PlatformStatusService {
  private readonly startedAt = new Date();
  private readonly config = getRuntimeConfig();

  constructor(
    private readonly store: JobStoreService,
    private readonly worker: WorkerService,
    private readonly scheduler: SchedulerService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  async health() {
    return {
      status: 'ok',
      service: this.config.serviceName,
      uptime_seconds: Math.floor(process.uptime()),
    };
  }

  async status() {
    const [workbenchPostgres, settlementsPostgres, legacyConnectorsPostgres, redis, ledgerCore, queues] = await Promise.all([
      checkTcpUrl(this.config.workbenchDatabaseUrl, 5432),
      checkTcpUrl(this.config.settlementsDatabaseUrl, 5432),
      checkTcpUrl(this.config.legacyConnectorsDatabaseUrl, 5432),
      this.redisStatus(),
      this.ledgerCoreStatus(),
      this.queueStats(),
    ]);
    const worker = this.worker.status();
    const status = this.overallStatus(
      [workbenchPostgres, settlementsPostgres, legacyConnectorsPostgres],
      redis,
      ledgerCore,
      worker.running || !worker.enabled,
    );

    return {
      status,
      service: this.config.serviceName,
      version: this.config.version,
      environment: process.env.NODE_ENV || 'development',
      started_at: this.startedAt.toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      dependencies: {
        postgres: workbenchPostgres,
        workbench_postgres: workbenchPostgres,
        settlements_postgres: settlementsPostgres,
        legacy_connectors_postgres: legacyConnectorsPostgres,
        redis,
        ledger_core: ledgerCore,
        fengine: ledgerCore,
      },
      worker,
      schedules: this.scheduler.list(),
      queues,
    };
  }

  async queueStats(): Promise<QueueStats[]> {
    return Promise.all(this.config.queues.map((queue) => this.store.stats(queue)));
  }

  schedules() {
    return this.scheduler.list();
  }

  workerMetrics() {
    return this.metrics.snapshot();
  }

  prometheusMetrics() {
    return this.metrics.prometheus();
  }

  private async redisStatus(): Promise<DependencyStatus> {
    const started = Date.now();
    try {
      const ok = await this.store.ping();
      return {
        status: ok ? 'ok' : 'down',
        latency_ms: Date.now() - started,
        message: this.config.queueBackend === 'memory' ? 'memory backend' : undefined,
      };
    } catch (error: any) {
      return {
        status: 'down',
        latency_ms: Date.now() - started,
        message: error?.message || 'redis unavailable',
      };
    }
  }

  private async ledgerCoreStatus(): Promise<DependencyStatus> {
    if (!this.config.fengineStatusEnabled) {
      return { status: 'degraded', message: 'ledger-core status check disabled' };
    }

    const started = Date.now();
    const timeoutBudgetMs = Math.min(this.config.internalRequestTimeoutMs, 3000);
    try {
      const response = await fetch(`${this.config.fengineUrl}/api/health`, {
        signal: AbortSignal.timeout(timeoutBudgetMs),
      });
      if (!response.ok) {
        return {
          status: 'down',
          latency_ms: Date.now() - started,
          message: `HTTP ${response.status}`,
        };
      }

      if (!this.config.fengineProjectionStatusEnabled) {
        return {
          status: 'ok',
          latency_ms: Date.now() - started,
        };
      }

      try {
        const remainingMs = this.remainingTimeoutMs(started, timeoutBudgetMs);
        if (remainingMs <= 0) {
          return {
            status: 'degraded',
            latency_ms: Date.now() - started,
            message: 'projection status unavailable: timeout budget exhausted',
          };
        }
        const projectionResponse = await fetch(`${this.config.fengineUrl}/api/projections/status`, {
          signal: AbortSignal.timeout(remainingMs),
        });
        if (!projectionResponse.ok) {
          return {
            status: 'degraded',
            latency_ms: Date.now() - started,
            message: `projection status unavailable: HTTP ${projectionResponse.status}`,
          };
        }
        let projections: any;
        try {
          projections = await projectionResponse.json();
        } catch {
          return {
            status: 'degraded',
            latency_ms: Date.now() - started,
            message: 'projection status unavailable: invalid JSON',
          };
        }
        if (!projections || !['ok', 'degraded', 'down'].includes(projections.status)) {
          return {
            status: 'degraded',
            latency_ms: Date.now() - started,
            message: 'projection status unavailable: invalid status',
          };
        }
        const status = projections.status === 'ok' ? 'ok' : projections.status;
        return {
          status,
          latency_ms: Date.now() - started,
          message: status === 'ok' ? undefined : `projection status ${status}`,
          details: { projections },
        };
      } catch (error: any) {
        return {
          status: 'degraded',
          latency_ms: Date.now() - started,
          message: `projection status unavailable: ${error?.message || 'request failed'}`,
        };
      }
    } catch (error: any) {
      return {
        status: 'down',
        latency_ms: Date.now() - started,
        message: error?.message || 'ledger-core unavailable',
      };
    }
  }

  private async fengineStatus(): Promise<DependencyStatus> {
    return this.ledgerCoreStatus();
  }

  private remainingTimeoutMs(started: number, timeoutBudgetMs: number): number {
    return Math.max(0, timeoutBudgetMs - (Date.now() - started));
  }

  private overallStatus(
    postgresDependencies: DependencyStatus[],
    redis: DependencyStatus,
    ledgerCore: DependencyStatus,
    workerReady: boolean,
  ): 'ok' | 'degraded' | 'down' {
    if (postgresDependencies.some((dependency) => dependency.status === 'down') || redis.status === 'down' || ledgerCore.status === 'down') {
      return 'down';
    }
    if (!workerReady || postgresDependencies.some((dependency) => dependency.status === 'degraded') || redis.status === 'degraded' || ledgerCore.status === 'degraded') {
      return 'degraded';
    }
    return 'ok';
  }
}
