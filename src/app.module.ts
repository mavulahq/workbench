/*
 * mavula.io - Worker Kit
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Module } from '@nestjs/common';
import { JobsController } from './controllers/jobs.controller';
import { StatusController } from './controllers/status.controller';
import { JobStoreService } from './queue/job-store.service';
import { PlatformStatusService } from './status/platform-status.service';
import { JobHandlersService } from './worker/job-handlers.service';
import { PaymentOutboxPublisherService } from './worker/payment-outbox-publisher.service';
import { PaymentProcessRuntimeService } from './worker/payment-process-runtime.service';
import { SchedulerService } from './worker/scheduler.service';
import { WorkerMetricsService } from './worker/worker-metrics.service';
import { WorkerService } from './worker/worker.service';

@Module({
  controllers: [StatusController, JobsController],
  providers: [
    JobStoreService,
    PlatformStatusService,
    JobHandlersService,
    PaymentOutboxPublisherService,
    PaymentProcessRuntimeService,
    WorkerService,
    SchedulerService,
    WorkerMetricsService,
  ],
})
export class AppModule {}
