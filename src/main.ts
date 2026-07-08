/*
 * mavula.io - Worker Kit Bootstrap
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getRuntimeConfig } from './utils/runtime-config';

async function bootstrap() {
  const config = getRuntimeConfig();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  await app.listen(config.port, '0.0.0.0');
  console.log(`fwk listening on ${await app.getUrl()}`);
}

bootstrap();
