/*
 * mavula.io - Worker Kit BullMQ Queue Store
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, JobsOptions, Queue } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';
import { CreateJobInput, QueueStats, WorkerJob } from '../types';
import { createJobId } from '../utils/ids';
import { getRuntimeConfig } from '../utils/runtime-config';

@Injectable()
export class JobStoreService implements OnModuleDestroy {
  private readonly config = getRuntimeConfig();
  private readonly connection = createRedisConnection(this.config.redisUrl);
  private readonly queues = new Map<string, Queue>();
  private readonly memory = new MemoryJobStore();

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

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

    const queue = this.queue(job.queue);
    const options: JobsOptions = {
      jobId: job.id,
      attempts: job.max_attempts,
      backoff: {
        type: 'exponential',
        delay: this.config.workerBackoffMs,
      },
      removeOnComplete: false,
      removeOnFail: false,
    };
    await queue.add(job.type, job, options);
    return job;
  }

  async schedule(input: CreateJobInput & { schedule_id: string; every_ms: number }): Promise<void> {
    if (this.usesMemory()) {
      return;
    }

    const queueName = input.queue || 'platform';
    const queue = this.queue(queueName);
    await queue.add(
      input.type,
      {
        id: input.schedule_id,
        queue: queueName,
        type: input.type,
        tenant_id: input.tenant_id || 'system',
        payload: input.payload || {},
        status: 'QUEUED',
        attempts: 0,
        max_attempts: Number(input.max_attempts || 3),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        jobId: input.schedule_id,
        attempts: Number(input.max_attempts || 3),
        backoff: {
          type: 'exponential',
          delay: this.config.workerBackoffMs,
        },
        repeat: {
          every: input.every_ms,
        },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );
  }

  async removeSchedule(queueName: string, scheduleId: string): Promise<void> {
    if (this.usesMemory()) {
      return;
    }

    const queue = this.queue(queueName);
    const [repeatableJobs, jobSchedulers] = await Promise.all([
      queue.getRepeatableJobs(),
      queue.getJobSchedulers(),
    ]);
    await Promise.all([
      ...repeatableJobs
        .filter((job) => job.id === scheduleId)
        .map((job) => queue.removeRepeatableByKey(job.key)),
      ...jobSchedulers
        .filter((job) => job.id === scheduleId || (job.template?.data as WorkerJob)?.id === scheduleId)
        .map((job) => queue.removeJobScheduler(job.key)),
    ]);
  }

  async claim(queue: string): Promise<WorkerJob | null> {
    if (!this.usesMemory()) {
      return null;
    }
    return this.memory.claim(queue);
  }

  async complete(job: WorkerJob, result: any): Promise<WorkerJob> {
    if (!this.usesMemory()) {
      return { ...job, status: 'COMPLETED', result, completed_at: new Date().toISOString() };
    }
    return this.memory.complete({ ...job, status: 'COMPLETED', result, completed_at: new Date().toISOString() });
  }

  async fail(job: WorkerJob, error: Error): Promise<WorkerJob> {
    if (!this.usesMemory()) {
      return { ...job, status: 'FAILED', last_error: error.message, failed_at: new Date().toISOString() };
    }
    const terminal = job.attempts >= job.max_attempts;
    return this.memory.fail({
      ...job,
      status: terminal ? 'FAILED' : 'QUEUED',
      last_error: error.message,
      failed_at: terminal ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    });
  }

  async moveToDeadLetter(queueName: string, job: WorkerJob, error: Error): Promise<void> {
    if (this.usesMemory()) {
      return;
    }

    await this.queue(this.deadLetterQueueName(queueName)).add(
      job.type,
      {
        ...job,
        status: 'FAILED',
        last_error: error.message,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        jobId: `dead-letter-${job.id}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  }

  async get(jobId: string): Promise<WorkerJob | null> {
    if (this.usesMemory()) {
      return this.memory.get(jobId);
    }

    for (const queueName of this.config.queues) {
      const bullJob = await this.queue(queueName).getJob(jobId);
      if (bullJob) {
        return this.fromBullJob(queueName, bullJob);
      }
    }
    return null;
  }

  async stats(queueName: string): Promise<QueueStats> {
    if (this.usesMemory()) {
      return this.memory.stats(queueName);
    }

    const [counts, deadLetterCounts] = await Promise.all([
      this.queue(queueName).getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      this.queue(this.deadLetterQueueName(queueName)).getJobCounts('waiting', 'delayed', 'failed'),
    ]);
    const queued = Number(counts.waiting || 0);
    const processing = Number(counts.active || 0);
    const delayed = Number(counts.delayed || 0);
    const failed = Number(counts.failed || 0);
    const completed = Number(counts.completed || 0);

    return {
      queue: queueName,
      queued,
      processing,
      delayed,
      dead_letter:
        Number(deadLetterCounts.waiting || 0) +
        Number(deadLetterCounts.delayed || 0) +
        Number(deadLetterCounts.failed || 0),
      total: queued + processing + delayed + failed + completed,
      completed,
      failed,
    };
  }

  async ping(): Promise<boolean> {
    if (this.usesMemory()) {
      return true;
    }

    const redis = new IORedis(this.connection);
    try {
      return (await redis.ping()) === 'PONG';
    } finally {
      redis.disconnect();
    }
  }

  getConnection(): RedisOptions {
    return this.connection;
  }

  usesMemory(): boolean {
    return this.config.queueBackend === 'memory' || process.env.NODE_ENV === 'test';
  }

  private queue(name: string): Queue {
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, { connection: this.connection }));
    }
    return this.queues.get(name)!;
  }

  private deadLetterQueueName(queueName: string): string {
    return `${queueName}-dead-letter`;
  }

  private async fromBullJob(queueName: string, job: Job): Promise<WorkerJob> {
    const state = await job.getState();
    const data = job.data as WorkerJob;
    return {
      ...data,
      id: String(job.id || data.id),
      queue: queueName,
      status: mapBullState(state),
      attempts: job.attemptsMade,
      updated_at: new Date(job.timestamp || Date.now()).toISOString(),
      result: job.returnvalue,
      last_error: job.failedReason,
    };
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
    this.jobs.set(job.id, { ...job, updated_at: new Date().toISOString() });
    return this.jobs.get(job.id)!;
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
      delayed: 0,
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

function createRedisConnection(redisUrl: string): RedisOptions {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname || 'localhost',
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.slice(1) || 0) : 0,
    maxRetriesPerRequest: null,
  };
}

function mapBullState(state: string): WorkerJob['status'] {
  switch (state) {
    case 'completed':
      return 'COMPLETED';
    case 'active':
      return 'PROCESSING';
    case 'failed':
      return 'FAILED';
    default:
      return 'QUEUED';
  }
}
