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
    const [postgres, redis, queues] = await Promise.all([
      checkTcpUrl(this.config.databaseUrl, 5432),
      this.redisStatus(),
      this.queueStats(),
    ]);
    const worker = this.worker.status();
    const status = this.overallStatus(postgres, redis, worker.running || !worker.enabled);

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

  private overallStatus(postgres: DependencyStatus, redis: DependencyStatus, workerReady: boolean): 'ok' | 'degraded' | 'down' {
    if (postgres.status === 'down' || redis.status === 'down') {
      return 'down';
    }
    if (!workerReady || postgres.status === 'degraded' || redis.status === 'degraded') {
      return 'degraded';
    }
    return 'ok';
  }
}
