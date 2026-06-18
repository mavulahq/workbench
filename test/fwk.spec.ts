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
