/*
 * MAVULA Workbench Health Metrics
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
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
    const queues = await Promise.all(worker.queues.map((queue) => this.store.stats(queue)));
    const paymentProcesses = await this.paymentProcesses.metrics().catch(() => undefined);
    const metrics: WorkerHealthMetrics = {
      worker_enabled: worker.enabled,
      worker_running: worker.running,
      processed_total: worker.processed,
      failed_total: worker.failed,
      last_heartbeat: worker.last_heartbeat,
      last_error: worker.last_error,
      queues,
    };

    if (paymentProcesses) {
      metrics.payment_processes = {
        active: paymentProcesses.active,
        failed: paymentProcesses.failed,
        expired: paymentProcesses.expired,
        compensation_required: paymentProcesses.compensationRequired,
        outbox_pending: paymentProcesses.outboxPending,
        outbox_publishing: paymentProcesses.outboxPublishing,
        outbox_published: paymentProcesses.outboxPublished,
        outbox_failed: paymentProcesses.outboxFailed,
      };
    }
    // Legacy batch metrics require a tenantId; omit cross-tenant globalMetrics from platform health.

    return metrics;
  }

  async prometheus(): Promise<string> {
    const metrics = await this.snapshot();
    const lines: string[] = [];
    for (const prefix of ['workbench', 'fwk']) {
      lines.push(
        `# HELP ${prefix}_worker_running Whether the worker loop is running.`,
        `# TYPE ${prefix}_worker_running gauge`,
        `${prefix}_worker_running ${metrics.worker_running ? 1 : 0}`,
        `# HELP ${prefix}_worker_processed_total Processed jobs.`,
        `# TYPE ${prefix}_worker_processed_total counter`,
        `${prefix}_worker_processed_total ${metrics.processed_total}`,
        `# HELP ${prefix}_worker_failed_total Failed jobs.`,
        `# TYPE ${prefix}_worker_failed_total counter`,
        `${prefix}_worker_failed_total ${metrics.failed_total}`,
      );
    }

    if (metrics.payment_processes) {
      for (const prefix of ['workbench', 'fwk']) {
        lines.push(
          `# HELP ${prefix}_payment_process_active Active payment processes.`,
          `# TYPE ${prefix}_payment_process_active gauge`,
          `${prefix}_payment_process_active ${metrics.payment_processes.active}`,
          `# HELP ${prefix}_payment_process_failed Failed payment processes.`,
          `# TYPE ${prefix}_payment_process_failed gauge`,
          `${prefix}_payment_process_failed ${metrics.payment_processes.failed}`,
          `# HELP ${prefix}_payment_process_expired Expired payment processes.`,
          `# TYPE ${prefix}_payment_process_expired gauge`,
          `${prefix}_payment_process_expired ${metrics.payment_processes.expired}`,
          `# HELP ${prefix}_payment_process_compensation_required Payment processes requiring compensation.`,
          `# TYPE ${prefix}_payment_process_compensation_required gauge`,
          `${prefix}_payment_process_compensation_required ${metrics.payment_processes.compensation_required}`,
          `# HELP ${prefix}_payment_outbox_pending Pending payment outbox events.`,
          `# TYPE ${prefix}_payment_outbox_pending gauge`,
          `${prefix}_payment_outbox_pending ${metrics.payment_processes.outbox_pending}`,
          `# HELP ${prefix}_payment_outbox_publishing Leased payment outbox events.`,
          `# TYPE ${prefix}_payment_outbox_publishing gauge`,
          `${prefix}_payment_outbox_publishing ${metrics.payment_processes.outbox_publishing}`,
          `# HELP ${prefix}_payment_outbox_published Published payment outbox events.`,
          `# TYPE ${prefix}_payment_outbox_published gauge`,
          `${prefix}_payment_outbox_published ${metrics.payment_processes.outbox_published}`,
          `# HELP ${prefix}_payment_outbox_failed Failed payment outbox events.`,
          `# TYPE ${prefix}_payment_outbox_failed gauge`,
          `${prefix}_payment_outbox_failed ${metrics.payment_processes.outbox_failed}`,
        );
      }
    }

    for (const queue of metrics.queues) {
      for (const prefix of ['workbench', 'fwk']) {
        lines.push(`${prefix}_queue_queued{queue="${queue.queue}"} ${queue.queued}`);
        lines.push(`${prefix}_queue_processing{queue="${queue.queue}"} ${queue.processing}`);
        lines.push(`${prefix}_queue_delayed{queue="${queue.queue}"} ${queue.delayed}`);
        lines.push(`${prefix}_queue_dead_letter{queue="${queue.queue}"} ${queue.dead_letter}`);
      }
    }

    return `${lines.join('\n')}\n`;
  }
}
