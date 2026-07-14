import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { StatusController } from '../../src/controllers/status.controller';

describe('workbench (e2e)', () => {
  let app: INestApplication;
  let statusController: StatusController;

  beforeAll(async () => {
    process.env.WORKBENCH_QUEUE_BACKEND = 'memory';
    process.env.WORKBENCH_WORKER_ENABLED = 'false';
    process.env.OIDC_ISSUER = 'https://identity.mavula.io';
    process.env.OIDC_AUDIENCE = 'urn:mavula:workbench';
    process.env.OIDC_JWKS_URI = 'https://identity.mavula.io/jwks';
    process.env.LEDGER_CORE_STATUS_ENABLED = 'false';

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
    delete process.env.WORKBENCH_QUEUE_BACKEND;
    delete process.env.WORKBENCH_WORKER_ENABLED;
    delete process.env.LEDGER_CORE_STATUS_ENABLED;
  });

  it('/api/health (GET)', async () => {
    await expect(statusController.health()).resolves.toMatchObject({ status: 'ok', service: 'workbench' });
  });

  it('/api/status (GET)', async () => {
    const status = await statusController.status();
    expect(status.service).toBe('workbench');
    expect(status).toHaveProperty('dependencies');
    expect(status).toHaveProperty('worker');
    expect(status).toHaveProperty('schedules');
    expect(status).toHaveProperty('queues');
  });

  it('/api/status/metrics (GET)', async () => {
    const metrics = await statusController.metrics();
    expect(metrics).toHaveProperty('worker_running');
    expect(metrics).toHaveProperty('queues');
    expect(metrics).toHaveProperty('payment_processes');
  });
});
