/*
 * MAVULA Workbench Payment Outbox Publisher
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentOutboxEvent } from '@mavula/settlements';
import { JobStoreService } from '../queue/job-store.service';
import { getRuntimeConfig } from '../utils/runtime-config';
import { PaymentProcessRuntimeService } from './payment-process-runtime.service';

export interface PaymentOutboxPublishResult {
  claimed: number;
  published: number;
  failed: number;
}

@Injectable()
export class PaymentOutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly config = getRuntimeConfig();
  private readonly lockedBy = `workbench-payment-outbox-${process.pid}`;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private lastError?: string;

  constructor(
    private readonly payments: PaymentProcessRuntimeService,
    private readonly jobs: JobStoreService,
  ) {}

  onModuleInit(): void {
    if (!this.config.paymentOutboxPublisherEnabled) {
      return;
    }

    this.timer = setInterval(() => {
      void this.publishPending().catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      });
    }, this.config.paymentOutboxPublisherPollMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  status() {
    return {
      enabled: this.config.paymentOutboxPublisherEnabled,
      running: this.running,
      last_error: this.lastError,
    };
  }

  async publishPending(limit = this.config.paymentOutboxPublisherBatchSize): Promise<PaymentOutboxPublishResult> {
    if (this.running || limit <= 0) {
      return { claimed: 0, published: 0, failed: 0 };
    }

    this.running = true;
    const result: PaymentOutboxPublishResult = { claimed: 0, published: 0, failed: 0 };
    try {
      const manager = this.payments.getManager();
      let lastPublishError: string | undefined;
      const events = await manager.claimOutboxEvents({
        limit,
        leaseMs: this.config.paymentOutboxPublisherLeaseMs,
        lockedBy: this.lockedBy,
      });
      result.claimed = events.length;

      for (const event of events) {
        try {
          await this.enqueueLedgerCoreEvent(event);
          await manager.markOutboxEventPublished(event);
          result.published += 1;
        } catch (error) {
          const publishError = this.asError(error);
          await manager.markOutboxEventFailed(event, publishError);
          lastPublishError = publishError.message;
          result.failed += 1;
        }
      }

      this.lastError = lastPublishError;
      return result;
    } catch (error) {
      this.lastError = this.asError(error).message;
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async enqueueLedgerCoreEvent(event: PaymentOutboxEvent): Promise<void> {
    await this.jobs.enqueue({
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      tenant_id: event.tenantId,
      max_attempts: event.maxAttempts,
      payload: {
        domain_event: true,
        event_type: event.eventType,
        event: event.payload,
        outbox_event_id: event.id,
      },
    });
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
