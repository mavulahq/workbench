/*
 * getfluxo.io - Worker Kit Identifiers
 * Copyright (c) 2026 getfluxo.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'crypto';

export function createJobId(type: string): string {
  return `job_${type.toLowerCase()}_${randomUUID()}`;
}
