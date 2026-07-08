/*
 * getfluxo.io - Worker Kit Public Status API
 * Copyright (c) 2026 getfluxo.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Controller, Get, Header } from '@nestjs/common';
import { PlatformStatusService } from '../status/platform-status.service';

@Controller()
export class StatusController {
  constructor(private readonly platformStatus: PlatformStatusService) {}

  @Get('health')
  health() {
    return this.platformStatus.health();
  }

  @Get('status')
  status() {
    return this.platformStatus.status();
  }

  @Get('status/queues')
  queues() {
    return this.platformStatus.queueStats();
  }

  @Get('status/schedules')
  schedules() {
    return this.platformStatus.schedules();
  }

  @Get('status/metrics')
  metrics() {
    return this.platformStatus.workerMetrics();
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  prometheusMetrics() {
    return this.platformStatus.prometheusMetrics();
  }
}
