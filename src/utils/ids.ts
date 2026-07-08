/*
 * mavula.io - Worker Kit Identifiers
 * Copyright (c) 2026 mavula.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'crypto';

export function createJobId(type: string): string {
  return `job_${type.toLowerCase()}_${randomUUID()}`;
}
