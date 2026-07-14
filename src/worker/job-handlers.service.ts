/*
 * MAVULA Workbench Job Handlers
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { WorkerJob } from '../types';
import { getRuntimeConfig } from '../utils/runtime-config';
import { PaymentProcessRuntimeService } from './payment-process-runtime.service';
import { ServiceTokenService } from '../auth/service-token.service';

@Injectable()
export class JobHandlersService {
  private readonly config = getRuntimeConfig();

  constructor(
    private readonly payments: PaymentProcessRuntimeService,
    private readonly serviceTokens: ServiceTokenService,
  ) {}

  async handle(job: WorkerJob): Promise<any> {
    switch (job.type) {
      case 'PLATFORM_HEALTH_CHECK':
        return this.platformHealthCheck(job);
      case 'PAYMENT_CAPTURE':
      case 'PAYMENT_DISBURSEMENT':
        return this.startPaymentProcess(job);
      case 'PAYMENT_SETTLEMENT':
        return this.recordPaymentSettlement(job);
      case 'PAYMENT_RECONCILIATION':
        return this.reconcilePayments(job);
      case 'LEDGER_CORE_EVENT':
      case 'FENGINE_EVENT':
        return this.ledgerCoreEvent(job);
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

  private async startPaymentProcess(job: WorkerJob) {
    const payload = job.payload;
    const process = await this.payments.getManager().start({
      tenantId: job.tenant_id,
      idempotencyKey: this.requiredString(payload.idempotency_key || payload.idempotencyKey || job.id, 'idempotency_key'),
      correlationId: this.requiredString(payload.correlation_id || payload.correlationId || job.id, 'correlation_id'),
      rail: this.requiredString(payload.rail, 'rail') as any,
      amount: payload.amount,
      payer: payload.payer,
      payee: payload.payee,
      providerReference: payload.provider_reference || payload.providerReference,
      metadata: payload.metadata,
    });
    return {
      accepted: true,
      process_id: process.id,
      state: process.state,
      type: job.type,
      processed_at: new Date().toISOString(),
    };
  }

  private async recordPaymentSettlement(job: WorkerJob) {
    const payload = job.payload;
    const process = await this.payments.getManager().recordWebhook({
      tenantId: job.tenant_id,
      providerReference: this.requiredString(
        payload.provider_reference || payload.providerReference || payload.payment_reference,
        'provider_reference',
      ),
      providerEventId: this.requiredString(
        payload.provider_event_id || payload.providerEventId || payload.webhook_event_id || job.id,
        'provider_event_id',
      ),
      status: (payload.status || 'succeeded') as any,
      failureReason: payload.failure_reason || payload.failureReason,
      payload,
    });
    return {
      accepted: true,
      process_id: process.id,
      state: process.state,
      type: job.type,
      processed_at: new Date().toISOString(),
    };
  }

  private async reconcilePayments(job: WorkerJob) {
    const tenantId = job.tenant_id === 'system' ? undefined : job.tenant_id;
    const result = await this.payments.getManager().reconcile({
      tenantId,
      limit: Number(job.payload.limit || this.config.paymentReconciliationLimit),
    });
    return {
      accepted: true,
      ...result,
      type: job.type,
      processed_at: new Date().toISOString(),
    };
  }

  private requiredString(value: any, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${field} is required`);
    }
    return value;
  }

  private async ledgerCoreEvent(job: WorkerJob) {
    const domainEvent = this.extractDomainEvent(job.payload);
    if (domainEvent) {
      return this.ledgerCoreDomainEvent(job, domainEvent);
    }

    const response = await fetch(`${this.config.fengineUrl}/api/internal/worker/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await this.serviceTokens.forTenant(job.tenant_id)}`,
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
      throw new Error(`ledger-core callback failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }

  private extractDomainEvent(payload: Record<string, any>): Record<string, any> | undefined {
    if (this.isCanonicalDomainEvent(payload)) {
      return payload;
    }
    if (payload.domain_event === true) {
      if (!payload.event || typeof payload.event !== 'object') {
        throw new Error('domain_event payload must include an event object');
      }
      return payload.event;
    }
    return undefined;
  }

  private isCanonicalDomainEvent(value: any): boolean {
    return Boolean(
      value
        && typeof value === 'object'
        && typeof value.event_id === 'string'
        && typeof value.event_type === 'string'
        && typeof value.tenant_id === 'string'
        && typeof value.event_version === 'number'
        && value.aggregate
        && value.payload
        && value.metadata,
    );
  }

  private async ledgerCoreDomainEvent(job: WorkerJob, event: Record<string, any>) {
    const response = await fetch(`${this.config.fengineUrl}/api/internal/worker/domain-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await this.serviceTokens.forTenant(job.tenant_id)}`,
      },
      body: JSON.stringify({
        job_id: job.id,
        event,
      }),
      signal: AbortSignal.timeout(this.config.internalRequestTimeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`ledger-core domain event callback failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }
}
