import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LegacyBatchConflictError, LegacyBatchStateError, MAX_LEGACY_ARTIFACT_BYTES } from '@mavula/legacy-connectors';
import { RequirePermissions } from '../auth/permissions.decorator';
import { JobStoreService } from '../queue/job-store.service';
import { LegacyBatchRuntimeService } from '../worker/legacy-batch-runtime.service';

@Controller()
@RequirePermissions('compliance.manage')
export class LegacyBatchesController {
  constructor(private readonly runtime: LegacyBatchRuntimeService, private readonly jobs: JobStoreService) {}

  @Post('regulatory-exports')
  async requestExport(
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('x-correlation-id') correlationId: string,
    @Body() body: Record<string, string>,
  ) {
    return this.translate(async () => {
      this.requiredHeaders(idempotencyKey, correlationId);
      const receipt = await this.runtime.getManager().requestExport({
        tenant_id: req.tenantId, institution_id: req.institutionId, idempotency_key: idempotencyKey,
        correlation_id: correlationId, requested_by: req.identity.sub, period_from: body.period_from,
        period_to: body.period_to, generated_at: body.generated_at, legal_basis_code: body.legal_basis_code,
        retention_until: body.retention_until,
      });
      if (receipt.state === 'QUEUED') await this.enqueue(receipt.id, req.tenantId, 'LEGACY_EXPORT');
      return this.present(receipt);
    });
  }

  @Post('legacy-imports')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LEGACY_ARTIFACT_BYTES, files: 1 } }))
  async stageImport(
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('x-correlation-id') correlationId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.translate(async () => {
      this.requiredHeaders(idempotencyKey, correlationId);
      if (!file?.buffer) throw new BadRequestException('A multipart file field is required');
      const receipt = await this.runtime.getManager().stageImport({
        tenant_id: req.tenantId, institution_id: req.institutionId, idempotency_key: idempotencyKey,
        correlation_id: correlationId, requested_by: req.identity.sub, filename: file.originalname, content: file.buffer,
      });
      if (receipt.state === 'QUEUED') await this.enqueue(receipt.id, req.tenantId, 'LEGACY_IMPORT');
      return this.present(receipt);
    });
  }

  @Get('legacy-batches')
  async list(@Req() req: any) { return (await this.runtime.getManager().list(req.tenantId)).map((receipt) => this.present(receipt)); }

  @Get('legacy-batches/:batchId')
  async get(@Req() req: any, @Param('batchId') batchId: string) {
    return this.present(await this.requireBatch(req.tenantId, batchId));
  }

  @Get('legacy-batches/:batchId/artifact')
  async artifact(@Req() req: any, @Res() response: any, @Param('batchId') batchId: string) {
    await this.requireBatch(req.tenantId, batchId);
    const artifact = await this.runtime.getManager().getArtifact(req.tenantId, batchId);
    if (!artifact) throw new NotFoundException('Legacy batch artifact not found');
    response.setHeader('Content-Type', `${artifact.media_type}; charset=us-ascii`);
    response.setHeader('Content-Length', String(artifact.byte_length));
    response.setHeader('ETag', `"${artifact.content_sha256}"`);
    response.setHeader('Content-Disposition', `attachment; filename="${artifact.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    response.send(artifact.content);
  }

  @Get('legacy-batches/:batchId/rejections')
  async rejections(@Req() req: any, @Param('batchId') batchId: string) {
    const receipt = await this.requireBatch(req.tenantId, batchId);
    return { batch_id: receipt.id, rejections: receipt.rejection_report };
  }

  @Post('regulatory-exports/:batchId/delivery')
  async delivery(
    @Req() req: any,
    @Param('batchId') batchId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('x-correlation-id') correlationId: string,
    @Body() body: Record<string, string>,
  ) {
    return this.translate(() => {
      this.requiredHeaders(idempotencyKey, correlationId);
      if (body.delivered_at && Number.isNaN(new Date(body.delivered_at).valueOf())) {
        throw new BadRequestException('delivered_at must be a valid date-time');
      }
      return this.runtime.getManager().markDelivered(
        req.tenantId, batchId, body.authority_reference,
        body.delivered_at ? new Date(body.delivered_at) : undefined,
      ).then((receipt) => this.present(receipt));
    });
  }

  private async enqueue(batchId: string, tenantId: string, type: 'LEGACY_EXPORT' | 'LEGACY_IMPORT'): Promise<void> {
    await this.jobs.enqueue({
      job_id: `legacy-${batchId}`, queue: 'legacy', type, tenant_id: tenantId,
      payload: { batch_id: batchId }, max_attempts: 3,
    });
  }

  private async requireBatch(tenantId: string, batchId: string) {
    const receipt = await this.runtime.getManager().get(tenantId, batchId);
    if (!receipt) throw new NotFoundException('Legacy batch not found');
    return receipt;
  }

  private requiredHeaders(idempotencyKey: string, correlationId: string): void {
    if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key is required');
    if (!correlationId?.trim()) throw new BadRequestException('X-Correlation-ID is required');
    if (idempotencyKey.length > 255) throw new BadRequestException('Idempotency-Key exceeds 255 characters');
    if (correlationId.length > 128) throw new BadRequestException('X-Correlation-ID exceeds 128 characters');
  }

  private present(receipt: any) {
    const {
      idempotency_key_digest: _idempotencyKeyDigest,
      request_hash: _requestHash,
      request: _request,
      lease_until: _leaseUntil,
      ...publicReceipt
    } = receipt;
    return publicReceipt;
  }

  private async translate<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof LegacyBatchConflictError || error instanceof LegacyBatchStateError) throw new ConflictException(error.message);
      throw new BadRequestException((error as Error).message);
    }
  }
}
