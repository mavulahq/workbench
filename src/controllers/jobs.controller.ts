/*
 * mavula.io - Worker Kit Jobs API
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { JobStoreService } from '../queue/job-store.service';
import { CreateJobInput, JOB_TYPES, JobType } from '../types';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CreateJobV1Dto } from '../dto/create-job-v1.dto';

@Controller('jobs')
export class JobsController {
  constructor(private readonly store: JobStoreService) {}

  @Post()
  @RequirePermissions('workbench.jobs.write')
  create(@Req() req: any, @Body() body: CreateJobV1Dto) {
    if (body.tenant_id && body.tenant_id !== req.tenantId) {
      throw new ForbiddenException('tenant_id does not match the authenticated tenant');
    }
    return this.store.enqueue(this.validateCreateJob({ ...body, tenant_id: req.tenantId }));
  }

  @Get(':jobId')
  @RequirePermissions('workbench.read')
  async get(@Param('jobId') jobId: string) {
    const job = await this.store.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    return job;
  }

  private validateCreateJob(body: CreateJobInput): CreateJobInput {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Job payload is required');
    }

    if (!JOB_TYPES.includes(body.type as JobType)) {
      throw new BadRequestException(`Unsupported job type: ${body.type}`);
    }

    if (body.queue !== undefined && !/^[a-z][a-z0-9_-]{1,63}$/.test(body.queue)) {
      throw new BadRequestException('Queue must use lowercase letters, numbers, underscore, or dash');
    }

    if (body.max_attempts !== undefined && (!Number.isInteger(Number(body.max_attempts)) || Number(body.max_attempts) < 1)) {
      throw new BadRequestException('max_attempts must be a positive integer');
    }

    return {
      ...body,
      type: body.type,
      queue: body.queue || 'payments',
      tenant_id: body.tenant_id!,
      payload: body.payload || {},
      max_attempts: body.max_attempts ? Number(body.max_attempts) : 3,
    };
  }
}
