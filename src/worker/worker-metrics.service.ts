/*
 * getfluxo.io - Worker Kit Health Metrics
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Injectable } from '@nestjs/common';
import { JobStoreService } from '../queue/job-store.service';
import { WorkerHealthMetrics } from '../types';
import { PaymentProcessRuntimeService } from './payment-process-runtime.service';
import { WorkerService } from './worker.service';

@Injectable()
export class WorkerMetricsService {
  constructor(
    private readonly store: JobStoreService,
    private readonly worker: WorkerService,
    private readonly paymentProcesses: PaymentProcessRuntimeService,
  ) {}

  async snapshot(): Promise<WorkerHealthMetrics> {
    const worker = this.worker.status();
    const [queues, paymentProcesses] = await Promise.all([
      Promise.all(worker.queues.map((queue) => this.store.stats(queue))),
      this.paymentProcesses.metrics(),
    ]);
    return {
      worker_enabled: worker.enabled,
      worker_running: worker.running,
      processed_total: worker.processed,
      failed_total: worker.failed,
      last_heartbeat: worker.last_heartbeat,
      last_error: worker.last_error,
      queues,
      payment_processes: {
        active: paymentProcesses.active,
        failed: paymentProcesses.failed,
        expired: paymentProcesses.expired,
        compensation_required: paymentProcesses.compensationRequired,
        outbox_pending: paymentProcesses.outboxPending,
      },
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
      '# HELP fwk_payment_process_active Active payment processes.',
      '# TYPE fwk_payment_process_active gauge',
      `fwk_payment_process_active ${metrics.payment_processes?.active ?? 0}`,
      '# HELP fwk_payment_process_failed Failed payment processes.',
      '# TYPE fwk_payment_process_failed gauge',
      `fwk_payment_process_failed ${metrics.payment_processes?.failed ?? 0}`,
      '# HELP fwk_payment_process_expired Expired payment processes.',
      '# TYPE fwk_payment_process_expired gauge',
      `fwk_payment_process_expired ${metrics.payment_processes?.expired ?? 0}`,
      '# HELP fwk_payment_process_compensation_required Payment processes requiring compensation.',
      '# TYPE fwk_payment_process_compensation_required gauge',
      `fwk_payment_process_compensation_required ${metrics.payment_processes?.compensation_required ?? 0}`,
      '# HELP fwk_payment_outbox_pending Pending payment outbox events.',
      '# TYPE fwk_payment_outbox_pending gauge',
      `fwk_payment_outbox_pending ${metrics.payment_processes?.outbox_pending ?? 0}`,
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
