import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { JobsController } from '../src/controllers/jobs.controller';
import { StatusController } from '../src/controllers/status.controller';
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
      payload: { payment_reference: 'pay_test_001' },
    });

    expect(job.status).toBe('QUEUED');
    expect(await worker.processOnce()).toBe(1);

    const processed = await jobsController.get(job.id);
    expect(processed.status).toBe('COMPLETED');
    expect(processed.result).toMatchObject({ accepted: true, payment_reference: 'pay_test_001' });
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
        headers: expect.objectContaining({ 'x-internal-api-key': 'test-internal-key' }),
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
  });
});
