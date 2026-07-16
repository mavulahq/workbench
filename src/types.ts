/*
 * MAVULA Workbench Shared Types
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export const JOB_TYPES = [
  'PAYMENT_CAPTURE',
  'PAYMENT_SETTLEMENT',
  'PAYMENT_DISBURSEMENT',
  'PAYMENT_RECONCILIATION',
  'LEGACY_EXPORT',
  'LEGACY_IMPORT',
  'LEDGER_CORE_EVENT',
  'FENGINE_EVENT',
  'PLATFORM_HEALTH_CHECK',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export interface WorkerJob {
  id: string;
  queue: string;
  type: JobType;
  tenant_id: string;
  payload: Record<string, any>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  last_error?: string;
  result?: any;
}

export interface CreateJobInput {
  job_id?: string;
  queue?: string;
  type: JobType;
  tenant_id?: string;
  payload?: Record<string, any>;
  max_attempts?: number;
}

export interface QueueStats {
  queue: string;
  queued: number;
  processing: number;
  delayed: number;
  dead_letter: number;
  total: number;
  completed: number;
  failed: number;
}

export interface DependencyStatus {
  status: 'ok' | 'degraded' | 'down';
  latency_ms?: number;
  message?: string;
  details?: Record<string, any>;
}

export interface WorkerRuntimeStatus {
  enabled: boolean;
  running: boolean;
  backend: string;
  queues: string[];
  processed: number;
  failed: number;
  last_heartbeat?: string;
  last_error?: string;
}

export interface ScheduledJobDefinition {
  id: string;
  queue: string;
  type: JobType;
  every_ms: number;
  payload: Record<string, any>;
}

export interface WorkerHealthMetrics {
  worker_enabled: boolean;
  worker_running: boolean;
  processed_total: number;
  failed_total: number;
  queues: QueueStats[];
  payment_processes?: {
    active: number;
    failed: number;
    expired: number;
    compensation_required: number;
    outbox_pending: number;
    outbox_publishing: number;
    outbox_published: number;
    outbox_failed: number;
  };
  legacy_batches?: {
    queued: number;
    processing: number;
    generated: number;
    validated: number;
    rejected: number;
    failed: number;
    delivered: number;
    rejection_records: number;
  };
  last_heartbeat?: string;
  last_error?: string;
}
