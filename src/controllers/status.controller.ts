/*
 * getfluxo.io - Worker Kit Public Status API
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Controller, Get } from '@nestjs/common';
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
}
