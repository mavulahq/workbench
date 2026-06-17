/*
 * getfluxo.io - Worker Kit
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Module } from '@nestjs/common';
import { JobsController } from './controllers/jobs.controller';
import { StatusController } from './controllers/status.controller';
import { JobStoreService } from './queue/job-store.service';
import { PlatformStatusService } from './status/platform-status.service';
import { JobHandlersService } from './worker/job-handlers.service';
import { WorkerService } from './worker/worker.service';

@Module({
  controllers: [StatusController, JobsController],
  providers: [JobStoreService, PlatformStatusService, JobHandlersService, WorkerService],
})
export class AppModule {}
