/*
 * getfluxo.io - Worker Kit Runtime
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobStoreService } from '../queue/job-store.service';
import { WorkerRuntimeStatus } from '../types';
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

  constructor(
    private readonly store: JobStoreService,
    private readonly handlers: JobHandlersService,
  ) {}

  onModuleInit(): void {
    if (this.config.workerEnabled) {
      this.start();
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => void this.processOnce(), this.config.workerPollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
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
      queues: this.config.queues,
      processed: this.processed,
      failed: this.failed,
      last_heartbeat: this.lastHeartbeat,
      last_error: this.lastError,
    };
  }
}
