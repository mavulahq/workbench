import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { JobsController } from '../src/controllers/jobs.controller';
import { StatusController } from '../src/controllers/status.controller';
import { PlatformStatusService } from '../src/status/platform-status.service';
import { WorkerService } from '../src/worker/worker.service';

describe('fwk - worker runtime', () => {
  let moduleFixture: TestingModule;
  let jobsController: JobsController;
  let statusController: StatusController;
  let worker: WorkerService;

  beforeAll(async () => {
    process.env.FWK_QUEUE_BACKEND = 'memory';
    process.env.FWK_WORKER_ENABLED = 'false';
    process.env.FWK_QUEUES = 'payments,platform';
    process.env.FENGINE_URL = 'http://fengine.test';
    process.env.INTERNAL_API_KEY = 'test-internal-key';
    process.env.FENGINE_STATUS_ENABLED = 'false';
    process.env.FWK_PAYMENT_PROCESS_STORE = 'memory';

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleFixture.init();
    jobsController = moduleFixture.get(JobsController);
    statusController = moduleFixture.get(StatusController);
    worker = moduleFixture.get(WorkerService);
  });

  afterAll(async () => {
    await moduleFixture.close();
    delete process.env.FWK_QUEUE_BACKEND;
    delete process.env.FWK_WORKER_ENABLED;
    delete process.env.FWK_QUEUES;
    delete process.env.FENGINE_URL;
    delete process.env.INTERNAL_API_KEY;
    delete process.env.FENGINE_STATUS_ENABLED;
    delete process.env.FENGINE_PROJECTION_STATUS_ENABLED;
    delete process.env.FWK_PAYMENT_PROCESS_STORE;
  });

  it('returns a public health payload', async () => {
    const health = await statusController.health();
    expect(health).toMatchObject({ status: 'ok', service: 'fwk' });
  });

  it('enqueues and processes payment jobs', async () => {
    const job = await jobsController.create({
      queue: 'payments',
      type: 'PAYMENT_CAPTURE',
      tenant_id: 'test_inst_001',
      payload: paymentPayload('idem_payment_job_001', 'provider_payment_job_001'),
    });

    expect(job.status).toBe('QUEUED');
    expect(await worker.processOnce()).toBe(1);

    const processed = await jobsController.get(job.id);
    expect(processed.status).toBe('COMPLETED');
    expect(processed.result).toMatchObject({
      accepted: true,
      state: 'PROVIDER_PENDING',
      type: 'PAYMENT_CAPTURE',
    });
  });

  it('runs payment reconciliation jobs on the payments queue', async () => {
    const job = await jobsController.create({
      queue: 'payments',
      type: 'PAYMENT_RECONCILIATION',
      tenant_id: 'test_inst_001',
      payload: { limit: 10 },
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get(job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: {
        accepted: true,
        type: 'PAYMENT_RECONCILIATION',
      },
    });
  });

  it('rejects unsupported job types', async () => {
    expect(() =>
      jobsController.create({
        type: 'UNSUPPORTED_JOB' as any,
        payload: {},
      }),
    ).toThrow('Unsupported job type');
  });

  it('dispatches fengine events through the authenticated callback', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, executed_workflows: 1 }),
    } as any);
    const job = await jobsController.create({
      queue: 'platform',
      type: 'FENGINE_EVENT',
      tenant_id: 'test_inst_001',
      payload: { event_type: 'LOAN_APPROVED', loan_id: 'loan_001' },
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get(job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, executed_workflows: 1 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fengine.test/api/internal/worker/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-internal-api-key': 'test-internal-key',
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

    const job = await jobsController.create({
      queue: 'platform',
      type: 'FENGINE_EVENT',
      tenant_id: 'test_inst_001',
      payload: { domain_event: true, event, event_type: event.event_type },
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get(job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: event.event_id },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fengine.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(event.event_id),
        headers: expect.objectContaining({
          'x-internal-api-key': 'test-internal-key',
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

    const job = await jobsController.create({
      queue: 'platform',
      type: 'FENGINE_EVENT',
      tenant_id: 'test_inst_001',
      payload: event,
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get(job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: event.event_id },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fengine.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(event.event_id),
        headers: expect.objectContaining({
          'x-internal-api-key': 'test-internal-key',
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

    const job = await jobsController.create({
      queue: 'platform',
      type: 'FENGINE_EVENT',
      tenant_id: 'test_inst_001',
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
    await expect(jobsController.get(job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: 'evt_partial' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fengine.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('evt_partial'),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://fengine.test/api/internal/worker/events',
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

    const job = await jobsController.create({
      queue: 'platform',
      type: 'FENGINE_EVENT',
      tenant_id: 'test_inst_001',
      payload: event,
    });

    expect(await worker.processOnce()).toBe(1);
    await expect(jobsController.get(job.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { accepted: true, event_id: event.event_id },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fengine.test/api/internal/worker/domain-events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(event.event_id),
      }),
    );
    fetchMock.mockRestore();
  });

  it('exposes queue stats in platform status', async () => {
    const status = await statusController.status();
    expect(status.service).toBe('fwk');
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
    });
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
  process.env.FENGINE_STATUS_ENABLED = 'true';
  process.env.FENGINE_PROJECTION_STATUS_ENABLED = 'true';
  return new PlatformStatusService(
    { ping: jest.fn(), stats: jest.fn() } as any,
    { status: jest.fn() } as any,
    { list: jest.fn() } as any,
    { snapshot: jest.fn(), prometheus: jest.fn() } as any,
  );
}
