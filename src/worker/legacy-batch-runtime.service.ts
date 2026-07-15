import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  LegacyBatchManager,
  MemoryLegacyBatchStore,
  PostgresLegacyBatchStore,
  type LegacyBatchMetrics,
  type LegacyBatchStore,
} from '@mavula/legacy-connectors';
import { getRuntimeConfig } from '../utils/runtime-config';

@Injectable()
export class LegacyBatchRuntimeService implements OnModuleDestroy {
  private readonly config = getRuntimeConfig();
  private store?: LegacyBatchStore;
  private manager?: LegacyBatchManager;

  async onModuleDestroy(): Promise<void> { await this.store?.close?.(); }

  getManager(): LegacyBatchManager {
    if (!this.manager) {
      this.store = this.useMemoryStore()
        ? new MemoryLegacyBatchStore()
        : new PostgresLegacyBatchStore(this.config.legacyConnectorsDatabaseUrl);
      this.manager = new LegacyBatchManager(this.store);
    }
    return this.manager;
  }

  metrics(): Promise<LegacyBatchMetrics> { return this.getManager().globalMetrics(); }

  private useMemoryStore(): boolean {
    return this.config.legacyBatchStore === 'memory' || process.env.NODE_ENV === 'test';
  }
}
