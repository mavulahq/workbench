/*
 * getfluxo.io - Worker Kit Job Handlers
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Injectable } from '@nestjs/common';
import { WorkerJob } from '../types';

@Injectable()
export class JobHandlersService {
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
    return {
      accepted: true,
      event_type: job.payload.event_type || 'UNKNOWN',
      processed_at: new Date().toISOString(),
    };
  }
}
