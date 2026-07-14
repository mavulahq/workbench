/*
 * mavula.io - Worker Kit Public Status API
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Controller, Get, Header } from '@nestjs/common';
import { PlatformStatusService } from '../status/platform-status.service';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller()
export class StatusController {
  constructor(private readonly platformStatus: PlatformStatusService) {}

  @Get('health')
  @Public()
  health() {
    return this.platformStatus.health();
  }

  @Get('status')
  @RequirePermissions('workbench.read')
  status() {
    return this.platformStatus.status();
  }

  @Get('status/queues')
  @RequirePermissions('workbench.read')
  queues() {
    return this.platformStatus.queueStats();
  }

  @Get('status/schedules')
  @RequirePermissions('workbench.read')
  schedules() {
    return this.platformStatus.schedules();
  }

  @Get('status/metrics')
  @RequirePermissions('workbench.read')
  metrics() {
    return this.platformStatus.workerMetrics();
  }

  @Get('metrics')
  @RequirePermissions('observability.read')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  prometheusMetrics() {
    return this.platformStatus.prometheusMetrics();
  }
}
