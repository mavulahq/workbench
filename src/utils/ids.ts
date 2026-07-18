/*
 * mavula.io - Worker Kit Identifiers
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomUUID } from 'crypto';

export function createJobId(type: string): string {
  return `job_${type.toLowerCase()}_${randomUUID()}`;
}

export function createStableJobId(type: string, identity: string): string {
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 48);
  return `job_${type.toLowerCase()}_${digest}`;
}
