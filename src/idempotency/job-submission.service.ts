import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { WorkerJob } from '../types';
import { getRuntimeConfig } from '../utils/runtime-config';

interface SubmissionInput {
  tenantId: string;
  actorId: string;
  correlationId: unknown;
  idempotencyKey: unknown;
  request: unknown;
}

interface ReceiptRow {
  requestHash: string;
  jobId: string;
  state: 'PENDING' | 'COMPLETED';
  responseBody: WorkerJob | null;
}

export interface SubmissionResult {
  job: WorkerJob;
  replayed: boolean;
}

@Injectable()
export class JobSubmissionService implements OnModuleInit, OnModuleDestroy {
  private readonly config = getRuntimeConfig();
  private readonly memory = new Map<string, ReceiptRow>();
  private readonly pool?: Pool;
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    if (!this.usesMemory()) {
      this.pool = new Pool(postgresPoolConfig(this.config.workbenchDatabaseUrl));
    }
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && !this.pool) {
      throw new Error('WORKBENCH_DATABASE_URL is required for durable job submission receipts');
    }
    if (this.pool) {
      await this.pool.query('SELECT 1');
      this.cleanupTimer = setInterval(() => void this.cleanup(), 3_600_000);
      this.cleanupTimer.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.pool?.end();
  }

  async submit(input: SubmissionInput, enqueue: (jobId: string) => Promise<WorkerJob>): Promise<SubmissionResult> {
    const idempotencyKey = this.requiredHeader(input.idempotencyKey, 'Idempotency-Key', 16, 128);
    const correlationId = this.requiredHeader(input.correlationId, 'X-Correlation-ID', 1, 128);
    const keyDigest = digest(idempotencyKey);
    const requestHash = digest(canonicalJson({
      actor_id: input.actorId,
      correlation_id: correlationId,
      request: input.request,
    }));
    const jobId = `job_${digest(`${input.tenantId}:create-job:${keyDigest}`).slice(0, 48)}`;

    const receipt = this.pool
      ? await this.reservePostgres(input.tenantId, keyDigest, requestHash, jobId, correlationId, input.actorId)
      : this.reserveMemory(input.tenantId, keyDigest, requestHash, jobId);

    if (receipt.requestHash !== requestHash) {
      throw new ConflictException({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency-Key was already used with a different request',
      });
    }
    if (receipt.state === 'COMPLETED' && receipt.responseBody) {
      return { job: receipt.responseBody, replayed: true };
    }

    let job: WorkerJob;
    try {
      job = await enqueue(receipt.jobId);
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'JOB_QUEUE_UNAVAILABLE',
        message: 'The job queue is temporarily unavailable; retry with the same Idempotency-Key',
      });
    }

    if (this.pool) {
      await this.completePostgres(input.tenantId, keyDigest, requestHash, job);
    } else {
      this.memory.set(this.memoryKey(input.tenantId, keyDigest), {
        requestHash,
        jobId: receipt.jobId,
        state: 'COMPLETED',
        responseBody: job,
      });
    }
    return { job, replayed: false };
  }

  private async reservePostgres(
    tenantId: string,
    keyDigest: string,
    requestHash: string,
    jobId: string,
    correlationId: string,
    actorId: string,
  ): Promise<ReceiptRow> {
    return this.withTenant(tenantId, async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${tenantId}:create-job:${keyDigest}`],
      );
      await client.query('SELECT workbench.delete_expired_job_submission_receipt($1,$2,$3)', [
        tenantId,
        'create-job',
        keyDigest,
      ]);
      const existing = await client.query<ReceiptRow>(
        `SELECT "requestHash", "jobId", state, "responseBody"
           FROM workbench.job_submission_receipts
          WHERE "tenantId"=$1 AND operation='create-job' AND "keyDigest"=$2`,
        [tenantId, keyDigest],
      );
      if (existing.rows[0]) return existing.rows[0];

      const expiresAt = new Date(Date.now() + this.config.jobReceiptRetentionDays * 86_400_000);
      const inserted = await client.query<ReceiptRow>(
        `INSERT INTO workbench.job_submission_receipts
          (id, "tenantId", operation, "keyDigest", "requestHash", "jobId", "correlationId", "actorId", state, "expiresAt")
         VALUES ($1,$2,'create-job',$3,$4,$5,$6,$7,'PENDING',$8)
         RETURNING "requestHash", "jobId", state, "responseBody"`,
        [`receipt_${jobId.slice(4)}`, tenantId, keyDigest, requestHash, jobId, correlationId, actorId, expiresAt],
      );
      return inserted.rows[0];
    });
  }

  private async completePostgres(
    tenantId: string,
    keyDigest: string,
    requestHash: string,
    job: WorkerJob,
  ): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE workbench.job_submission_receipts
            SET state='COMPLETED', "httpStatus"=201, "responseBody"=$4::jsonb,
                "completedAt"=now(), "updatedAt"=now()
          WHERE "tenantId"=$1 AND operation='create-job' AND "keyDigest"=$2 AND "requestHash"=$3`,
        [tenantId, keyDigest, requestHash, JSON.stringify(job)],
      );
      if (result.rowCount !== 1) throw new Error('Job submission receipt disappeared before completion');
    });
  }

  private reserveMemory(tenantId: string, keyDigest: string, requestHash: string, jobId: string): ReceiptRow {
    const key = this.memoryKey(tenantId, keyDigest);
    const existing = this.memory.get(key);
    if (existing) return existing;
    const receipt: ReceiptRow = { requestHash, jobId, state: 'PENDING', responseBody: null };
    this.memory.set(key, receipt);
    return receipt;
  }

  private async withTenant<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id',$1,true)", [tenantId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async cleanup(): Promise<void> {
    try {
      await this.pool?.query('SELECT workbench.cleanup_expired_job_submission_receipts($1)', [500]);
    } catch {
      // Cleanup is retried on the next bounded interval; request handling remains fail closed.
    }
  }

  private requiredHeader(value: unknown, name: string, minimum: number, maximum: number): string {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(value)) {
      throw new BadRequestException(`${name} must contain ${minimum}-${maximum} supported characters`);
    }
    return value;
  }

  private usesMemory(): boolean {
    return this.config.jobReceiptStore === 'memory' || process.env.NODE_ENV === 'test';
  }

  private memoryKey(tenantId: string, keyDigest: string): string {
    return `${tenantId}:create-job:${keyDigest}`;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function postgresPoolConfig(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('schema');
  url.searchParams.delete('schema');
  return {
    connectionString: url.toString(),
    options: schema ? `-c search_path=${schema},public` : undefined,
  };
}
