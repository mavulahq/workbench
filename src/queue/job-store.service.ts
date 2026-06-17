/*
 * getfluxo.io - Worker Kit Queue Store
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Injectable } from '@nestjs/common';
import { CreateJobInput, QueueStats, WorkerJob } from '../types';
import { createJobId } from '../utils/ids';
import { getRuntimeConfig } from '../utils/runtime-config';
import { SimpleRedisClient } from './simple-redis.client';

@Injectable()
export class JobStoreService {
  private readonly config = getRuntimeConfig();
  private readonly redis = new SimpleRedisClient(this.config.redisUrl);
  private readonly memory = new MemoryJobStore();

  async enqueue(input: CreateJobInput): Promise<WorkerJob> {
    const now = new Date().toISOString();
    const job: WorkerJob = {
      id: createJobId(input.type),
      queue: input.queue || 'payments',
      type: input.type,
      tenant_id: input.tenant_id || 'public',
      payload: input.payload || {},
      status: 'QUEUED',
      attempts: 0,
      max_attempts: Number(input.max_attempts || 3),
      created_at: now,
      updated_at: now,
    };

    if (this.usesMemory()) {
      return this.memory.enqueue(job);
    }

    await this.redis.command('SET', this.jobKey(job.id), JSON.stringify(job));
    await this.redis.command('SADD', this.jobsKey(), job.id);
    await this.redis.command('LPUSH', this.pendingKey(job.queue), job.id);
    return job;
  }

  async claim(queue: string): Promise<WorkerJob | null> {
    if (this.usesMemory()) {
      return this.memory.claim(queue);
    }

    const jobId = await this.redis.command('RPOPLPUSH', this.pendingKey(queue), this.processingKey(queue));
    if (!jobId) {
      return null;
    }

    const job = await this.get(jobId);
    if (!job) {
      await this.redis.command('LREM', this.processingKey(queue), 0, jobId);
      return null;
    }

    const updated: WorkerJob = {
      ...job,
      status: 'PROCESSING',
      attempts: job.attempts + 1,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  async complete(job: WorkerJob, result: any): Promise<WorkerJob> {
    const updated: WorkerJob = {
      ...job,
      status: 'COMPLETED',
      result,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (this.usesMemory()) {
      return this.memory.complete(updated);
    }

    await this.redis.command('LREM', this.processingKey(job.queue), 0, job.id);
    await this.save(updated);
    return updated;
  }

  async fail(job: WorkerJob, error: Error): Promise<WorkerJob> {
    const terminal = job.attempts >= job.max_attempts;
    const updated: WorkerJob = {
      ...job,
      status: terminal ? 'FAILED' : 'QUEUED',
      last_error: error.message,
      failed_at: terminal ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    };

    if (this.usesMemory()) {
      return this.memory.fail(updated);
    }

    await this.redis.command('LREM', this.processingKey(job.queue), 0, job.id);
    await this.save(updated);
    if (terminal) {
      await this.redis.command('LPUSH', this.deadKey(job.queue), job.id);
    } else {
      await this.redis.command('LPUSH', this.pendingKey(job.queue), job.id);
    }
    return updated;
  }

  async get(jobId: string): Promise<WorkerJob | null> {
    if (this.usesMemory()) {
      return this.memory.get(jobId);
    }

    const raw = await this.redis.command('GET', this.jobKey(jobId));
    return raw ? JSON.parse(raw) : null;
  }

  async stats(queue: string): Promise<QueueStats> {
    if (this.usesMemory()) {
      return this.memory.stats(queue);
    }

    const [queued, processing, deadLetter] = await Promise.all([
      this.redis.command('LLEN', this.pendingKey(queue)),
      this.redis.command('LLEN', this.processingKey(queue)),
      this.redis.command('LLEN', this.deadKey(queue)),
    ]);
    const ids = await this.redis.command('SMEMBERS', this.jobsKey());
    const jobs = await Promise.all((ids || []).map((id: string) => this.get(id)));
    const scoped = jobs.filter((job): job is WorkerJob => Boolean(job && job.queue === queue));

    return {
      queue,
      queued,
      processing,
      dead_letter: deadLetter,
      total: scoped.length,
      completed: scoped.filter((job) => job.status === 'COMPLETED').length,
      failed: scoped.filter((job) => job.status === 'FAILED').length,
    };
  }

  async ping(): Promise<boolean> {
    if (this.usesMemory()) {
      return true;
    }

    return (await this.redis.ping()) === 'PONG';
  }

  private async save(job: WorkerJob): Promise<void> {
    await this.redis.command('SET', this.jobKey(job.id), JSON.stringify(job));
  }

  private usesMemory(): boolean {
    return this.config.queueBackend === 'memory' || process.env.NODE_ENV === 'test';
  }

  private jobKey(jobId: string): string {
    return `fwk:jobs:${jobId}`;
  }

  private jobsKey(): string {
    return 'fwk:jobs:index';
  }

  private pendingKey(queue: string): string {
    return `fwk:queue:${queue}:pending`;
  }

  private processingKey(queue: string): string {
    return `fwk:queue:${queue}:processing`;
  }

  private deadKey(queue: string): string {
    return `fwk:queue:${queue}:dead`;
  }
}

class MemoryJobStore {
  private readonly jobs = new Map<string, WorkerJob>();
  private readonly pending = new Map<string, string[]>();
  private readonly processing = new Map<string, string[]>();
  private readonly dead = new Map<string, string[]>();

  enqueue(job: WorkerJob): WorkerJob {
    this.jobs.set(job.id, job);
    this.list(this.pending, job.queue).unshift(job.id);
    return job;
  }

  claim(queue: string): WorkerJob | null {
    const jobId = this.list(this.pending, queue).pop();
    if (!jobId) return null;
    this.list(this.processing, queue).unshift(jobId);
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const updated = {
      ...job,
      status: 'PROCESSING' as const,
      attempts: job.attempts + 1,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.jobs.set(jobId, updated);
    return updated;
  }

  complete(job: WorkerJob): WorkerJob {
    this.remove(this.processing, job.queue, job.id);
    this.jobs.set(job.id, job);
    return job;
  }

  fail(job: WorkerJob): WorkerJob {
    this.remove(this.processing, job.queue, job.id);
    this.jobs.set(job.id, job);
    if (job.status === 'FAILED') {
      this.list(this.dead, job.queue).unshift(job.id);
    } else {
      this.list(this.pending, job.queue).unshift(job.id);
    }
    return job;
  }

  get(jobId: string): WorkerJob | null {
    return this.jobs.get(jobId) || null;
  }

  stats(queue: string): QueueStats {
    const jobs = [...this.jobs.values()].filter((job) => job.queue === queue);
    return {
      queue,
      queued: this.list(this.pending, queue).length,
      processing: this.list(this.processing, queue).length,
      dead_letter: this.list(this.dead, queue).length,
      total: jobs.length,
      completed: jobs.filter((job) => job.status === 'COMPLETED').length,
      failed: jobs.filter((job) => job.status === 'FAILED').length,
    };
  }

  private list(map: Map<string, string[]>, queue: string): string[] {
    if (!map.has(queue)) {
      map.set(queue, []);
    }
    return map.get(queue)!;
  }

  private remove(map: Map<string, string[]>, queue: string, jobId: string): void {
    const items = this.list(map, queue);
    const index = items.indexOf(jobId);
    if (index >= 0) {
      items.splice(index, 1);
    }
  }
}
