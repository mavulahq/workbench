/*
 * mavula.io - Worker Kit Jobs API
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import { JobStoreService } from '../queue/job-store.service';
import { CreateJobInput, PUBLIC_JOB_TYPES, PublicJobType } from '../types';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CreateJobV1Dto } from '../dto/create-job-v1.dto';
import { JobSubmissionService } from '../idempotency/job-submission.service';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly store: JobStoreService,
    private readonly submissions: JobSubmissionService,
  ) {}

  @Post()
  @RequirePermissions('workbench.jobs.write')
  async create(
    @Req() req: any,
    @Body() body: CreateJobV1Dto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('x-correlation-id') correlationId: string,
    @Res({ passthrough: true }) response?: any,
  ) {
    const input = this.validateCreateJob({
      type: body.type,
      payload: body.payload,
      tenant_id: req.tenantId,
      queue: 'payments',
      max_attempts: 3,
    });
    const result = await this.submissions.submit({
      tenantId: req.tenantId,
      actorId: req.identity?.sub || req.user?.sub || 'unknown',
      idempotencyKey,
      correlationId,
      request: body,
    }, (jobId) => this.store.enqueue({ ...input, job_id: jobId }));
    if (result.replayed) response?.setHeader?.('Idempotency-Replayed', 'true');
    return result.job;
  }

  @Get(':jobId')
  @RequirePermissions('workbench.read')
  async get(@Req() req: any, @Param('jobId') jobId: string) {
    const job = await this.store.getForTenant(jobId, req.tenantId);
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    return job;
  }

  private validateCreateJob(body: CreateJobInput): CreateJobInput {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Job payload is required');
    }

    if (!PUBLIC_JOB_TYPES.includes(body.type as PublicJobType)) {
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
      queue: 'payments',
      tenant_id: body.tenant_id!,
      payload: body.payload || {},
      max_attempts: 3,
    };
  }
}
