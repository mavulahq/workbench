/*
 * getfluxo.io - Worker Kit Runtime
 * Copyright (c) 2026 getfluxo.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { JobStoreService } from '../queue/job-store.service';
import { WorkerJob, WorkerRuntimeStatus } from '../types';
import { getRuntimeConfig } from '../utils/runtime-config';
import { JobHandlersService } from './job-handlers.service';

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly config = getRuntimeConfig();
  private timer?: NodeJS.Timeout;
  private running = false;
  private processing = false;
  private processed = 0;
  private failed = 0;
  private lastHeartbeat?: string;
  private lastError?: string;
  private readonly bullWorkers: Worker[] = [];

  constructor(
    private readonly store: JobStoreService,
    private readonly handlers: JobHandlersService,
  ) {}

  onModuleInit(): void {
    if (this.config.workerEnabled) {
      this.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    if (this.store.usesMemory()) {
      this.timer = setInterval(() => void this.processOnce(), this.config.workerPollMs);
      return;
    }

    for (const queue of this.config.queues) {
      const worker = new Worker(
        queue,
        async (job) => {
          this.lastHeartbeat = new Date().toISOString();
          const result = await this.handlers.handle(this.fromBullJob(queue, job));
          this.processed += 1;
          return result;
        },
        {
          connection: this.store.getConnection(),
        },
      );
      worker.on('failed', (job, error) => {
        this.failed += 1;
        this.lastError = error.message;
        const maxAttempts = Number(job?.opts.attempts || 1);
        if (job && job.attemptsMade >= maxAttempts) {
          void this.store.moveToDeadLetter(queue, this.fromBullJob(queue, job), error).catch((deadLetterError) => {
            this.lastError = `Dead-letter enqueue failed: ${deadLetterError.message}`;
          });
        }
      });
      this.bullWorkers.push(worker);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await Promise.all(this.bullWorkers.splice(0).map((worker) => worker.close()));
    this.running = false;
  }

  async processOnce(): Promise<number> {
    if (this.processing) {
      return 0;
    }

    this.processing = true;
    let handled = 0;
    this.lastHeartbeat = new Date().toISOString();

    try {
      for (const queue of this.config.queues) {
        const job = await this.store.claim(queue);
        if (!job) {
          continue;
        }

        try {
          const result = await this.handlers.handle(job);
          await this.store.complete(job, result);
          this.processed += 1;
        } catch (error: any) {
          await this.store.fail(job, error);
          this.failed += 1;
          this.lastError = error?.message || 'job failed';
        }
        handled += 1;
      }
    } finally {
      this.processing = false;
    }

    return handled;
  }

  status(): WorkerRuntimeStatus {
    return {
      enabled: this.config.workerEnabled,
      running: this.running,
      backend: this.store.usesMemory() ? 'memory' : 'bullmq',
      queues: this.config.queues,
      processed: this.processed,
      failed: this.failed,
      last_heartbeat: this.lastHeartbeat,
      last_error: this.lastError,
    };
  }

  private fromBullJob(queue: string, job: any): WorkerJob {
    const data = job.data as WorkerJob;
    return {
      ...data,
      id: String(job.id || data.id),
      queue,
      status: 'PROCESSING',
      attempts: job.attemptsMade + 1,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}
