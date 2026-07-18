/*
 * mavula.io - Worker Kit
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { AccessTokenGuard } from './auth/access-token.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { ServiceTokenService } from './auth/service-token.service';
import { LegacyBatchesController } from './controllers/legacy-batches.controller';
import { LegacyBatchRuntimeService } from './worker/legacy-batch-runtime.service';
import { JobSubmissionService } from './idempotency/job-submission.service';
import { MetricsTokenGuard } from './auth/metrics-token.guard';

@Module({
  controllers: [StatusController, JobsController, LegacyBatchesController],
  providers: [
    JobStoreService,
    JobSubmissionService,
    MetricsTokenGuard,
    PlatformStatusService,
    JobHandlersService,
    PaymentOutboxPublisherService,
    PaymentProcessRuntimeService,
    LegacyBatchRuntimeService,
    WorkerService,
    SchedulerService,
    WorkerMetricsService,
    ServiceTokenService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
