/*
 * getfluxo.io - Worker Kit Public Platform Status
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
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
    const [postgres, redis, fengine, queues] = await Promise.all([
      checkTcpUrl(this.config.databaseUrl, 5432),
      this.redisStatus(),
      this.fengineStatus(),
      this.queueStats(),
    ]);
    const worker = this.worker.status();
    const status = this.overallStatus(postgres, redis, fengine, worker.running || !worker.enabled);

    return {
      status,
      service: this.config.serviceName,
      version: this.config.version,
      environment: process.env.NODE_ENV || 'development',
      started_at: this.startedAt.toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      dependencies: {
        postgres,
        redis,
        fengine,
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

  private async fengineStatus(): Promise<DependencyStatus> {
    if (!this.config.fengineStatusEnabled) {
      return { status: 'degraded', message: 'fengine status check disabled' };
    }

    const started = Date.now();
    try {
      const response = await fetch(`${this.config.fengineUrl}/api/health`, {
        signal: AbortSignal.timeout(Math.min(this.config.internalRequestTimeoutMs, 3000)),
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
        const projectionResponse = await fetch(`${this.config.fengineUrl}/api/projections/status`, {
          signal: AbortSignal.timeout(Math.min(this.config.internalRequestTimeoutMs, 3000)),
        });
        if (!projectionResponse.ok) {
          return {
            status: 'degraded',
            latency_ms: Date.now() - started,
            message: `projection status unavailable: HTTP ${projectionResponse.status}`,
          };
        }
        const projections = await projectionResponse.json().catch(() => ({}));
        return {
          status: 'ok',
          latency_ms: Date.now() - started,
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
        message: error?.message || 'fengine unavailable',
      };
    }
  }

  private overallStatus(
    postgres: DependencyStatus,
    redis: DependencyStatus,
    fengine: DependencyStatus,
    workerReady: boolean,
  ): 'ok' | 'degraded' | 'down' {
    if (postgres.status === 'down' || redis.status === 'down' || fengine.status === 'down') {
      return 'down';
    }
    if (!workerReady || postgres.status === 'degraded' || redis.status === 'degraded' || fengine.status === 'degraded') {
      return 'degraded';
    }
    return 'ok';
  }
}
