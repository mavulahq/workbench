/*
 * getfluxo.io - Worker Kit Job Handlers
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Injectable } from '@nestjs/common';
import { WorkerJob } from '../types';
import { getRuntimeConfig } from '../utils/runtime-config';

@Injectable()
export class JobHandlersService {
  private readonly config = getRuntimeConfig();

  async handle(job: WorkerJob): Promise<any> {
    switch (job.type) {
      case 'PLATFORM_HEALTH_CHECK':
        return this.platformHealthCheck(job);
      case 'PAYMENT_CAPTURE':
      case 'PAYMENT_SETTLEMENT':
      case 'PAYMENT_DISBURSEMENT':
        return this.paymentJob(job);
      case 'FENGINE_EVENT':
        return this.fengineEvent(job);
      default:
        throw new Error(`Unsupported job type: ${job.type}`);
    }
  }

  private async platformHealthCheck(job: WorkerJob) {
    return {
      ok: true,
      tenant_id: job.tenant_id,
      checked_at: new Date().toISOString(),
    };
  }

  private async paymentJob(job: WorkerJob) {
    return {
      accepted: true,
      payment_reference: job.payload.payment_reference || job.id,
      type: job.type,
      processed_at: new Date().toISOString(),
    };
  }

  private async fengineEvent(job: WorkerJob) {
    if (!this.config.internalApiKey) {
      throw new Error('INTERNAL_API_KEY is required to dispatch fengine events');
    }

    if (job.payload.domain_event === true && job.payload.event) {
      return this.fengineDomainEvent(job);
    }

    const response = await fetch(`${this.config.fengineUrl}/api/internal/worker/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': this.config.internalApiKey,
      },
      body: JSON.stringify({
        job_id: job.id,
        tenant_id: job.tenant_id,
        event_type: job.payload.event_type || 'UNKNOWN',
        payload: job.payload,
      }),
      signal: AbortSignal.timeout(this.config.internalRequestTimeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`fengine callback failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }

  private async fengineDomainEvent(job: WorkerJob) {
    const response = await fetch(`${this.config.fengineUrl}/api/internal/worker/domain-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': this.config.internalApiKey,
      },
      body: JSON.stringify({
        job_id: job.id,
        event: job.payload.event,
      }),
      signal: AbortSignal.timeout(this.config.internalRequestTimeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`fengine domain event callback failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }
}
