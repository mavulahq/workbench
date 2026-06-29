/*
 * getfluxo.io - Worker Kit Shared Types
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export const JOB_TYPES = [
  'PAYMENT_CAPTURE',
  'PAYMENT_SETTLEMENT',
  'PAYMENT_DISBURSEMENT',
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
  last_heartbeat?: string;
  last_error?: string;
}
