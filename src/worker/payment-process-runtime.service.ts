/*
 * mavula.io - Payment Process Runtime
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  MemoryPaymentProcessStore,
  PaymentProcessManager,
  PaymentProcessMetrics,
  PaymentProcessStore,
  PostgresPaymentProcessStore,
} from '@mavula/settlements';
import { getRuntimeConfig } from '../utils/runtime-config';

@Injectable()
export class PaymentProcessRuntimeService implements OnModuleDestroy {
  private readonly config = getRuntimeConfig();
  private store?: PaymentProcessStore;
  private manager?: PaymentProcessManager;

  async onModuleDestroy(): Promise<void> {
    await this.store?.close?.();
  }

  getManager(): PaymentProcessManager {
    if (!this.manager) {
      this.store = this.createStore();
      this.manager = new PaymentProcessManager(this.store, {
        settlementOutboxEnabled: this.config.paymentSettlementOutboxEnabled,
      });
    }
    return this.manager;
  }

  metrics(): Promise<PaymentProcessMetrics> {
    return this.getManager().metrics();
  }

  private createStore(): PaymentProcessStore {
    if (this.useMemoryStore()) {
      return new MemoryPaymentProcessStore();
    }
    return new PostgresPaymentProcessStore(this.config.databaseUrl);
  }

  private useMemoryStore(): boolean {
    return this.config.paymentProcessStore === 'memory' || process.env.NODE_ENV === 'test';
  }
}
