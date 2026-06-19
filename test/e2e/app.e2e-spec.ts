import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { StatusController } from '../../src/controllers/status.controller';

describe('fwk (e2e)', () => {
  let app: INestApplication;
  let statusController: StatusController;

  beforeAll(async () => {
    process.env.FWK_QUEUE_BACKEND = 'memory';
    process.env.FWK_WORKER_ENABLED = 'false';
    process.env.INTERNAL_API_KEY = 'test-internal-key';
    process.env.FENGINE_STATUS_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    statusController = app.get(StatusController);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.FWK_QUEUE_BACKEND;
    delete process.env.FWK_WORKER_ENABLED;
    delete process.env.INTERNAL_API_KEY;
    delete process.env.FENGINE_STATUS_ENABLED;
  });

  it('/api/health (GET)', async () => {
    await expect(statusController.health()).resolves.toMatchObject({ status: 'ok', service: 'fwk' });
  });

  it('/api/status (GET)', async () => {
    const status = await statusController.status();
    expect(status.service).toBe('fwk');
    expect(status).toHaveProperty('dependencies');
    expect(status).toHaveProperty('worker');
    expect(status).toHaveProperty('schedules');
    expect(status).toHaveProperty('queues');
  });

  it('/api/status/metrics (GET)', async () => {
    const metrics = await statusController.metrics();
    expect(metrics).toHaveProperty('worker_running');
    expect(metrics).toHaveProperty('queues');
  });
});
