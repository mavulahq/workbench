/*
 * getfluxo.io - Worker Kit Health Metrics
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Injectable } from '@nestjs/common';
import { JobStoreService } from '../queue/job-store.service';
import { WorkerHealthMetrics } from '../types';
import { WorkerService } from './worker.service';

@Injectable()
export class WorkerMetricsService {
  constructor(
    private readonly store: JobStoreService,
    private readonly worker: WorkerService,
  ) {}

  async snapshot(): Promise<WorkerHealthMetrics> {
    const worker = this.worker.status();
    const queues = await Promise.all(worker.queues.map((queue) => this.store.stats(queue)));
    return {
      worker_enabled: worker.enabled,
      worker_running: worker.running,
      processed_total: worker.processed,
      failed_total: worker.failed,
      last_heartbeat: worker.last_heartbeat,
      last_error: worker.last_error,
      queues,
    };
  }

  async prometheus(): Promise<string> {
    const metrics = await this.snapshot();
    const lines = [
      '# HELP fwk_worker_running Whether the worker loop is running.',
      '# TYPE fwk_worker_running gauge',
      `fwk_worker_running ${metrics.worker_running ? 1 : 0}`,
      '# HELP fwk_worker_processed_total Processed jobs.',
      '# TYPE fwk_worker_processed_total counter',
      `fwk_worker_processed_total ${metrics.processed_total}`,
      '# HELP fwk_worker_failed_total Failed jobs.',
      '# TYPE fwk_worker_failed_total counter',
      `fwk_worker_failed_total ${metrics.failed_total}`,
    ];

    for (const queue of metrics.queues) {
      lines.push(`fwk_queue_queued{queue="${queue.queue}"} ${queue.queued}`);
      lines.push(`fwk_queue_processing{queue="${queue.queue}"} ${queue.processing}`);
      lines.push(`fwk_queue_delayed{queue="${queue.queue}"} ${queue.delayed}`);
      lines.push(`fwk_queue_dead_letter{queue="${queue.queue}"} ${queue.dead_letter}`);
    }

    return `${lines.join('\n')}\n`;
  }
}
