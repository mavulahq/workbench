import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { JobsController } from '../src/controllers/jobs.controller';
import { StatusController } from '../src/controllers/status.controller';
import { PlatformStatusService } from '../src/status/platform-status.service';
import { PaymentOutboxPublisherService } from '../src/worker/payment-outbox-publisher.service';
import { PaymentProcessRuntimeService } from '../src/worker/payment-process-runtime.service';
import { WorkerService } from '../src/worker/worker.service';
import { ServiceTokenService } from '../src/auth/service-token.service';
import { LegacyBatchesController } from '../src/controllers/legacy-batches.controller';
import { LegacyBatchRuntimeService } from '../src/worker/legacy-batch-runtime.service';
import { readFileSync } from 'node:fs';
import { JobStoreService } from '../src/queue/job-store.service';

describe('workbench worker runtime', () => {
  let moduleFixture: TestingModule;
  let jobsController: JobsController;
  let statusController: StatusController;
  let paymentOutboxPublisher: PaymentOutboxPublisherService;
  let paymentRuntime: PaymentProcessRuntimeService;
  let worker: WorkerService;
  let legacyBatchesController: LegacyBatchesController;
  let legacyBatchRuntime: LegacyBatchRuntimeService;
  let jobStore: JobStoreService;

  beforeAll(async () => {
    process.env.WORKBENCH_QUEUE_BACKEND = 'memory';
    process.env.WORKBENCH_WORKER_ENABLED = 'false';
    process.env.WORKBENCH_QUEUES = 'payments,platform,legacy';
    process.env.LEDGER_CORE_URL = 'http://ledger-core.test';
    process.env.OIDC_ISSUER = 'https://identity.mavula.io';
    process.env.OIDC_AUDIENCE = 'urn:mavula:workbench';
    process.env.OIDC_JWKS_URI = 'https://identity.mavula.io/jwks';
    process.env.LEDGER_CORE_STATUS_ENABLED = 'false';
    process.env.WORKBENCH_PAYMENT_PROCESS_STORE = 'memory';
    process.env.WORKBENCH_LEGACY_BATCH_STORE = 'memory';
    process.env.FPAY_SETTLEMENT_OUTBOX_ENABLED = 'true';
    process.env.FPAY_OUTBOX_PUBLISHER_ENABLED = 'false';

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleFixture.init();
    jobsController = moduleFixture.get(JobsController);
    statusController = moduleFixture.get(StatusController);
    paymentOutboxPublisher = moduleFixture.get(PaymentOutboxPublisherService);
    paymentRuntime = moduleFixture.get(PaymentProcessRuntimeService);
    worker = moduleFixture.get(WorkerService);
    legacyBatchesController = moduleFixture.get(LegacyBatchesController);
    legacyBatchRuntime = moduleFixture.get(LegacyBatchRuntimeService);
    jobStore = moduleFixture.get(JobStoreService);
    jest.spyOn(moduleFixture.get(ServiceTokenService), 'forTenant').mockResolvedValue('test-service-token');
  });

  afterAll(async () => {
    await moduleFixture.close();
    delete process.env.WORKBENCH_QUEUE_BACKEND;
    delete process.env.WORKBENCH_WORKER_ENABLED;
    delete process.env.WORKBENCH_QUEUES;
    delete process.env.LEDGER_CORE_URL;
    delete process.env.LEDGER_CORE_STATUS_ENABLED;
    delete process.env.LEDGER_CORE_PROJECTION_STATUS_ENABLED;
    delete process.env.WORKBENCH_PAYMENT_PROCESS_STORE;
    delete process.env.WORKBENCH_LEGACY_BATCH_STORE;
    delete process.env.FPAY_SETTLEMENT_OUTBOX_ENABLED;
    delete process.env.FPAY_OUTBOX_PUBLISHER_ENABLED;
  });

  it('returns a public health payload', async () => {
    const health = await statusController.health();
    expect(health).toMatchObject({ status: 'ok', service: 'workbench' });
  });

  it('enqueues and processes payment jobs', async () => {
    const job = await jobsController.create({ tenantId: 'test_inst_001', identity: { sub: 'operator_001' } }, {
      type: 'PAYMENT_CAPTURE',
      payload: paymentPayload('idem_payment_job_001', 'provider_payment_job_001'),
    }, 'job-submit-payment-001', 'corr-job-submit-payment-001');

    expect(job.status).toBe('QUEUED');
    expect(await worker.processOnce()).toBe(1);

    const processed = await jobsController.get({ tenantId: 'test_inst_001' }, job.id);
    expect(processed.status).toBe('COMPLETED');
    expect(processed.result).toMatchObject({
      accepted: true,
      state: 'PROVIDER_PENDING',
      type: 'PAYMENT_CAPTURE',
    });
  });

  it('replays an identical public job submission without adding a second job', async () => {
    const request = { tenantId: 'tenant_job_replay', identity: { sub: 'operator_replay' } };
    const body = {
      type: 'PAYMENT_CAPTURE' as const,
      payload: paymentPayload('idem_payment_replay_001', 'provider_payment_replay_001'),
    };
    const response = { setHeader: jest.fn() };
    const first = await jobsController.create(request, body, 'job-submit-replay-001', 'corr-job-replay-001');
    const replay = await jobsController.create(request, body, 'job-submit-replay-001', 'corr-job-replay-001', response);

    expect(replay.id).toBe(first.id);
    expect(response.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
    expect((await statusController.queues()).find((queue: any) => queue.queue === 'payments')?.total).toBeGreaterThan(0);
    expect(await worker.processOnce()).toBe(1);
  });

  it('rejects reuse of a job submission key with a different request', async () => {
    const request = { tenantId: 'tenant_job_conflict', identity: { sub: 'operator_conflict' } };
    await jobsController.create(request, {
      type: 'PAYMENT_RECONCILIATION', payload: { limit: 10 },
    }, 'job-submit-conflict-001', 'corr-job-conflict-001');

    await expect(jobsController.create(request, {
      type: 'PAYMENT_RECONCILIATION', payload: { limit: 20 },
    }, 'job-submit-conflict-001', 'corr-job-conflict-001')).rejects.toMatchObject({ status: 409 });
    expect(await worker.processOnce()).toBe(1);
  });

  it('does not disclose a job to another tenant', async () => {
    const job = await jobsController.create(
      { tenantId: 'tenant_job_owner', identity: { sub: 'operator_owner' } },
      { type: 'PAYMENT_RECONCILIATION', payload: { limit: 1 } },
      'job-submit-tenant-read-001',
      'corr-job-tenant-read-001',
    );
    await expect(jobsController.get({ tenantId: 'tenant_job_other' }, job.id)).rejects.toMatchObject({ status: 404 });
    expect(await worker.processOnce()).toBe(1);
  });

  it('runs payment reconciliation jobs on the payments queue', async () => {
    const job = await jobsController.create({ tenantId: 'test_inst_001', identity: { sub: 'operator_001' } }, {
      type: 'PAYMENT_RECONCILIATION',
      payload: { limit: 10 },
    }, 'job-submit-reconcile-001', 'corr-job-submit-reconcile-001');

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get({ tenantId: 'test_inst_001' }, job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: {
        accepted: true,
        type: 'PAYMENT_RECONCILIATION',
      },
    });
  });

  it('generates a regulatory export through the legacy queue', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ records: [{
        record_id: 'regtxn_001', transaction_id: 'txn_001', transaction_type: 'LOAN_PAYMENT',
        instruction_method: 'BATCH', source_party_id: 'customer_001', source_account_id: 'account_001',
        destination_party_id: 'institution_001', destination_account_id: 'loan_001',
        counterparty_id: 'institution_001', amount_minor: '120000', currency: 'MZN',
        occurred_at: '2026-07-15T10:00:00.000Z', recorded_at: '2026-07-15T10:00:01.000Z',
        correlation_id: 'corr_txn_001', retention_until: '2036-07-15', legal_basis_code: 'MZ-AML-14-2023-ART-43',
      }], rejections: [] }),
    } as any);
    const request = { tenantId: 'tenant_legacy_001', institutionId: 'institution_001', identity: { sub: 'compliance_001' } };
    const receipt = await legacyBatchesController.requestExport(request, 'idem-export-001', 'corr-export-001', {
      period_from: '2026-07-01', period_to: '2026-07-31', generated_at: '2026-08-01T08:00:00.000Z',
      legal_basis_code: 'MZ-AML-14-2023-ART-43', retention_until: '2036-07-31',
    });
    const replay = await legacyBatchesController.requestExport(request, 'idem-export-001', 'corr-export-001', {
      period_from: '2026-07-01', period_to: '2026-07-31', generated_at: '2026-08-01T08:00:00.000Z',
      legal_basis_code: 'MZ-AML-14-2023-ART-43', retention_until: '2036-07-31',
    });
    expect(replay.id).toBe(receipt.id);
    expect(receipt).not.toHaveProperty('idempotency_key_digest');
    expect((await statusController.queues()).find((queue: any) => queue.queue === 'legacy')).toMatchObject({ queued: 1, total: 1 });

    expect(await worker.processOnce()).toBe(1);
    await expect(legacyBatchRuntime.getManager().get(request.tenantId, receipt.id)).resolves.toMatchObject({
      state: 'GENERATED', record_count: 1,
    });
    await expect(legacyBatchRuntime.getManager().getArtifact(request.tenantId, receipt.id)).resolves.toMatchObject({
      media_type: 'text/plain', byte_length: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/regulatory-transaction-records',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer test-service-token' }) }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('persists ledger source mapping failures as batch rejections', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ records: [], rejections: [{
        transaction_id: 'txn_incomplete', field: 'destination_account_id', code: 'REQUIRED_SOURCE_FIELD_MISSING',
      }] }),
    } as any);
    const request = { tenantId: 'tenant_legacy_rejected', institutionId: 'institution_rejected', identity: { sub: 'compliance_rejected' } };
    const receipt = await legacyBatchesController.requestExport(request, 'idem-export-rejected', 'corr-export-rejected', {
      period_from: '2026-07-01', period_to: '2026-07-31', generated_at: '2026-08-01T08:00:00.000Z',
      legal_basis_code: 'MZ-AML-14-2023-ART-43', retention_until: '2036-07-31',
    });
    expect(await worker.processOnce()).toBe(1);
    await expect(legacyBatchRuntime.getManager().get(request.tenantId, receipt.id)).resolves.toMatchObject({
      state: 'REJECTED', attempts: 1,
      rejection_report: [{ field: 'destination_account_id', code: 'REQUIRED_SOURCE_FIELD_MISSING', reference: 'txn_incomplete' }],
    });
    fetchMock.mockRestore();
  });

  it('stages and validates an imported artifact without a ledger callback', async () => {
    const fixture = readFileSync('../legacy-connectors/contracts/regulatory-transaction-export/v1/examples/regulatory-transaction-export.v1.dat');
    const request = { tenantId: 'tenant_legacy_002', institutionId: 'institution_002', identity: { sub: 'compliance_002' } };
    const receipt = await legacyBatchesController.stageImport(
      request, 'idem-import-001', 'corr-import-001',
      { originalname: 'incoming.dat', buffer: fixture } as Express.Multer.File,
    );
    expect(await worker.processOnce()).toBe(1);
    await expect(legacyBatchRuntime.getManager().get(request.tenantId, receipt.id)).resolves.toMatchObject({
      state: 'VALIDATED', record_count: 1,
    });
  });

  it('rejects unsupported job types', async () => {
    await expect(
      jobsController.create({ tenantId: 'test_inst_001', identity: { sub: 'operator_001' } }, {
        type: 'UNSUPPORTED_JOB' as any,
        payload: {},
      }, 'job-submit-invalid-001', 'corr-job-submit-invalid-001'),
    ).rejects.toThrow('Unsupported job type');
  });

  it('dispatches ledger-core events through the authenticated callback', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, executed_workflows: 1 }),
    } as any);
    const job = await jobStore.enqueue({
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      tenant_id: 'test_inst_001',
      payload: { event_type: 'LOAN_APPROVED', loan_id: 'loan_001' },
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get({ tenantId: 'test_inst_001' }, job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, executed_workflows: 1 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-service-token',
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('dispatches canonical domain events through the domain callback', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        event_id: 'evt_6b2f87a4-0d49-4a1e-9e13-75ca45d6301b',
      }),
    } as any);
    const event = {
      event_id: 'evt_6b2f87a4-0d49-4a1e-9e13-75ca45d6301b',
      event_type: 'lending.loan_disbursed',
      event_version: 1,
      occurred_at: '2026-06-20T10:00:00.000Z',
      tenant_id: 'test_inst_001',
      aggregate: { type: 'loan', id: 'loan_001', version: 1 },
      correlation_id: 'corr_disburse_001',
      causation_id: 'cmd_disburse_001',
      idempotency_key: 'idem_disburse_001',
      payload: {
        transaction_id: 'disburse_001',
        destination_account_id: 'CUST_cust_001',
        money: { amount: '25000.00', currency: 'MZN' },
      },
      metadata: {
        producer: 'fengine',
        data_classification: 'restricted',
        schema_uri: 'contracts/domain-events/event-envelope.schema.json',
      },
    };

    const job = await jobStore.enqueue({
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      tenant_id: 'test_inst_001',
      payload: { domain_event: true, event, event_type: event.event_type },
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get({ tenantId: 'test_inst_001' }, job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: event.event_id },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(event.event_id),
        headers: expect.objectContaining({
          authorization: 'Bearer test-service-token',
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('dispatches direct canonical domain event envelopes through the domain callback', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        event_id: 'evt_8d2f5a72-3fc6-45a5-8ef8-5df4af5e2e3a',
      }),
    } as any);
    const event = {
      event_id: 'evt_8d2f5a72-3fc6-45a5-8ef8-5df4af5e2e3a',
      event_type: 'lending.payment_posted',
      event_version: 1,
      occurred_at: '2026-06-27T10:00:00.000Z',
      tenant_id: 'test_inst_001',
      aggregate: { type: 'loan', id: 'loan_001', version: 2 },
      correlation_id: 'corr_payment_001',
      causation_id: 'cmd_payment_001',
      idempotency_key: 'idem_payment_001',
      payload: {
        transaction_id: 'txn_payment_001',
        source_account_id: 'CUST_cust_001',
        money: { amount: '2500.00', currency: 'MZN' },
        allocation: { principal: '1375.00', interest: '625.00', fees: '500.00' },
        balance_after: '23625.00',
      },
      metadata: {
        producer: 'fengine',
        data_classification: 'restricted',
        schema_uri: 'contracts/domain-events/event-envelope.schema.json',
      },
    };

    const job = await jobStore.enqueue({
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      tenant_id: 'test_inst_001',
      payload: event,
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get({ tenantId: 'test_inst_001' }, job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: event.event_id },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(event.event_id),
        headers: expect.objectContaining({
          authorization: 'Bearer test-service-token',
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('keeps explicitly flagged domain events on the domain callback path', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: 'evt_partial' }),
    } as any);

    const job = await jobStore.enqueue({
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      tenant_id: 'test_inst_001',
      max_attempts: 1,
      payload: {
        domain_event: true,
        event_type: 'lending.payment_posted',
        event: {
          event_id: 'evt_partial',
          event_type: 'lending.payment_posted',
        },
      },
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get({ tenantId: 'test_inst_001' }, job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: 'evt_partial' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('evt_partial'),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/events',
      expect.anything(),
    );
    fetchMock.mockRestore();
  });

  it('dispatches explicitly flagged direct domain event envelopes', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        event_id: 'evt_03d2a77a-90c7-4351-9d5e-1d53db8d1280',
      }),
    } as any);

    const event = {
      domain_event: true,
      event_id: 'evt_03d2a77a-90c7-4351-9d5e-1d53db8d1280',
      event_type: 'lending.payment_posted',
      event_version: 1,
      occurred_at: '2026-06-27T10:00:00.000Z',
      tenant_id: 'test_inst_001',
      aggregate: { type: 'loan', id: 'loan_001', version: 3 },
      correlation_id: 'corr_payment_002',
      causation_id: 'cmd_payment_002',
      payload: {
        transaction_id: 'txn_payment_002',
        source_account_id: 'CUST_cust_001',
        money: { amount: '1000.00', currency: 'MZN' },
        allocation: { principal: '375.00', interest: '625.00', fees: '0.00' },
        balance_after: '23250.00',
      },
      metadata: {
        producer: 'fengine',
        data_classification: 'restricted',
      },
    };

    const job = await jobStore.enqueue({
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      tenant_id: 'test_inst_001',
      payload: event,
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get({ tenantId: 'test_inst_001' }, job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: event.event_id },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(event.event_id),
      }),
    );
    fetchMock.mockRestore();
  });

  it('rejects a domain event from another tenant before requesting a service token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const serviceTokens = moduleFixture.get(ServiceTokenService);
    const tokenMock = jest.spyOn(serviceTokens, 'forTenant');
    tokenMock.mockClear();
    const job = await jobStore.enqueue({
      queue: 'platform',
      type: 'LEDGER_CORE_EVENT',
      tenant_id: 'test_inst_001',
      max_attempts: 1,
      payload: {
        event_id: 'evt_cross_tenant',
        event_type: 'ledger.journal_posted',
        event_version: 1,
        occurred_at: '2026-07-14T00:00:00.000Z',
        tenant_id: 'test_inst_002',
        aggregate: { type: 'journal_entry', id: 'entry-1', version: 1 },
        correlation_id: 'corr-cross-tenant',
        causation_id: 'cmd-cross-tenant',
        payload: {},
        metadata: {},
      },
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get({ tenantId: 'test_inst_001' }, job.id)).resolves.toMatchObject({
      status: 'FAILED',
      last_error: 'domain event tenant does not match the worker job tenant',
    });
    expect(tokenMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('publishes payment settlement outbox events to ledger-core event jobs', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        event_id: 'evt_payment_settlement_completed_001',
      }),
    } as any);
    const manager = paymentRuntime.getManager();

    await manager.start({
      tenantId: 'test_inst_001',
      idempotencyKey: 'idem_payment_outbox_001',
      correlationId: 'corr_payment_outbox_001',
      rail: 'mpesa',
      amount: {
        currency: 'MZN',
        valueMinor: 15000,
      },
      payer: {
        accountRef: 'customer_001',
        phoneNumber: '+258840000000',
      },
      payee: {
        accountRef: 'merchant_001',
      },
      providerReference: 'provider_payment_outbox_001',
    });
    await manager.recordWebhook({
      tenantId: 'test_inst_001',
      providerReference: 'provider_payment_outbox_001',
      providerEventId: 'provider_event_payment_outbox_001',
      status: 'succeeded',
    });

    await expect(paymentRuntime.metrics()).resolves.toMatchObject({
      outboxPending: expect.any(Number),
    });

    await expect(paymentOutboxPublisher.publishPending(1)).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    await expect(paymentRuntime.metrics()).resolves.toMatchObject({
      outboxPending: 0,
      outboxPublished: expect.any(Number),
    });

    expect(await worker.processOnce()).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-core.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('payments.settlement_completed'),
        headers: expect.objectContaining({
          authorization: 'Bearer test-service-token',
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('exposes queue stats in platform status', async () => {
    const status = await statusController.status();
    expect(status.service).toBe('workbench');
    expect(status.queues.some((queue: any) => queue.queue === 'payments')).toBe(true);
    expect(status.schedules.some((schedule: any) => schedule.id === 'scheduled_reconciliation_hourly')).toBe(true);
  });

  it('exposes worker health metrics', async () => {
    const metrics = await statusController.metrics();
    expect(metrics.worker_enabled).toBe(false);
    expect(metrics.queues.some((queue: any) => queue.queue === 'payments')).toBe(true);
    expect(metrics.payment_processes).toMatchObject({
      active: expect.any(Number),
      failed: expect.any(Number),
      expired: expect.any(Number),
      compensation_required: expect.any(Number),
      outbox_pending: expect.any(Number),
      outbox_publishing: expect.any(Number),
      outbox_published: expect.any(Number),
      outbox_failed: expect.any(Number),
    });
    expect(metrics.legacy_batches).toMatchObject({
      generated: expect.any(Number), validated: expect.any(Number), rejected: expect.any(Number), failed: expect.any(Number),
    });
  });

  it('keeps worker health metrics when payment metrics fail', async () => {
    const metricsSpy = jest
      .spyOn(paymentRuntime, 'metrics')
      .mockRejectedValueOnce(new Error('payment metrics unavailable'));

    const metrics = await statusController.metrics();

    expect(metrics.worker_enabled).toBe(false);
    expect(metrics.queues.some((queue: any) => queue.queue === 'payments')).toBe(true);
    expect(metrics).not.toHaveProperty('payment_processes');
    metricsSpy.mockRestore();
  });

  it('omits payment gauges when payment metrics fail', async () => {
    const metricsSpy = jest
      .spyOn(paymentRuntime, 'metrics')
      .mockRejectedValueOnce(new Error('payment metrics unavailable'));

    const prometheus = await statusController.prometheusMetrics();

    expect(prometheus).toContain('fwk_worker_running');
    expect(prometheus).not.toContain('fwk_payment_process_active');
    expect(prometheus).not.toContain('fwk_payment_outbox_pending');
    metricsSpy.mockRestore();
  });

  it('includes fengine projection status when available', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ok' }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          projections: [{ projection_name: 'loan_activity', event_count: 2 }],
        }),
      } as any);
    const service = platformStatusService();

    await expect((service as any).fengineStatus()).resolves.toMatchObject({
      status: 'ok',
      details: {
        projections: {
          status: 'ok',
          projections: [{ projection_name: 'loan_activity', event_count: 2 }],
        },
      },
    });
    fetchMock.mockRestore();
  });

  it('marks fengine degraded when projection status is unavailable', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ok' }) } as any)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as any);
    const service = platformStatusService();

    await expect((service as any).fengineStatus()).resolves.toMatchObject({
      status: 'degraded',
      message: 'projection status unavailable: HTTP 503',
    });
    fetchMock.mockRestore();
  });

  it('marks fengine degraded when projection status JSON is invalid', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ok' }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('invalid JSON');
        },
      } as any);
    const service = platformStatusService();

    await expect((service as any).fengineStatus()).resolves.toMatchObject({
      status: 'degraded',
      message: 'projection status unavailable: invalid JSON',
    });
    fetchMock.mockRestore();
  });

  it('propagates unhealthy projection status payloads', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ok' }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'down', projections: [] }),
      } as any);
    const service = platformStatusService();

    await expect((service as any).fengineStatus()).resolves.toMatchObject({
      status: 'down',
      message: 'projection status down',
      details: { projections: { status: 'down', projections: [] } },
    });
    fetchMock.mockRestore();
  });

  it('caps projection status requests to the remaining fengine timeout budget', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ok' }) } as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'ok' }) } as any);
    const timeoutMock = jest.spyOn(AbortSignal, 'timeout').mockReturnValue({} as any);
    const nowMock = jest.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2800)
      .mockReturnValue(2800);
    const service = platformStatusService();

    await expect((service as any).fengineStatus()).resolves.toMatchObject({ status: 'ok' });
    expect(timeoutMock).toHaveBeenNthCalledWith(1, 3000);
    expect(timeoutMock).toHaveBeenNthCalledWith(2, 1200);

    fetchMock.mockRestore();
    timeoutMock.mockRestore();
    nowMock.mockRestore();
  });
});

function paymentPayload(idempotencyKey: string, providerReference: string) {
  return {
    idempotency_key: idempotencyKey,
    correlation_id: `corr_${idempotencyKey}`,
    rail: 'mpesa',
    amount: {
      currency: 'MZN',
      valueMinor: 15000,
    },
    payer: {
      accountRef: 'customer_001',
      phoneNumber: '+258840000000',
    },
    payee: {
      accountRef: 'merchant_001',
    },
    provider_reference: providerReference,
  };
}

function platformStatusService(): PlatformStatusService {
  process.env.LEDGER_CORE_STATUS_ENABLED = 'true';
  process.env.LEDGER_CORE_PROJECTION_STATUS_ENABLED = 'true';
  return new PlatformStatusService(
    { ping: jest.fn(), stats: jest.fn() } as any,
    { status: jest.fn() } as any,
    { list: jest.fn() } as any,
    { snapshot: jest.fn(), prometheus: jest.fn() } as any,
  );
}
