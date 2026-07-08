/*
 * MAVULA Workbench Scheduled Jobs
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobStoreService } from '../queue/job-store.service';
import { ScheduledJobDefinition } from '../types';
import { getRuntimeConfig } from '../utils/runtime-config';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly config = getRuntimeConfig();
  private readonly schedules: ScheduledJobDefinition[] = [
    {
      id: 'scheduled_fees_daily',
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      every_ms: 24 * 60 * 60 * 1000,
      payload: { event_type: 'SCHEDULED_FEES_ACCRUAL' },
    },
    {
      id: 'scheduled_interest_daily',
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      every_ms: 24 * 60 * 60 * 1000,
      payload: { event_type: 'SCHEDULED_INTEREST_ACCRUAL' },
    },
    {
      id: 'scheduled_reconciliation_hourly',
      queue: 'payments',
      type: 'PAYMENT_RECONCILIATION',
      every_ms: 60 * 60 * 1000,
      payload: {},
    },
    {
      id: 'scheduled_reports_daily',
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      every_ms: 24 * 60 * 60 * 1000,
      payload: { event_type: 'SCHEDULED_REPORT_GENERATION' },
    },
  ];

  constructor(private readonly store: JobStoreService) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.schedulerEnabled || this.store.usesMemory()) {
      return;
    }

    await this.store.removeSchedule('platform', 'scheduled_reconciliation_hourly');
    await this.store.removeSchedule('payments', 'scheduled_reconciliation_hourly');
    for (const schedule of this.schedules) {
      await this.store.schedule({
        schedule_id: schedule.id,
        queue: schedule.queue,
        type: schedule.type,
        tenant_id: 'system',
        payload: schedule.payload,
        every_ms: schedule.every_ms,
        max_attempts: 3,
      });
    }
  }

  list(): ScheduledJobDefinition[] {
    return this.schedules;
  }
}
