/*
 * getfluxo.io - Worker Kit TCP Health Checks
 * Copyright (c) 2026 getfluxo.io
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Socket } from 'net';
import { DependencyStatus } from '../types';

export async function checkTcpUrl(url: string, fallbackPort: number, timeoutMs = 750): Promise<DependencyStatus> {
  const started = Date.now();
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || 'localhost';
    const port = Number(parsed.port || fallbackPort);
    await connectTcp(host, port, timeoutMs);
    return { status: 'ok', latency_ms: Date.now() - started };
  } catch (error: any) {
    return {
      status: 'down',
      latency_ms: Date.now() - started,
      message: error?.message || 'dependency unavailable',
    };
  }
}

function connectTcp(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      cleanup();
      resolve();
    });
    socket.once('timeout', () => {
      cleanup();
      reject(new Error(`timeout connecting to ${host}:${port}`));
    });
    socket.once('error', (error) => {
      cleanup();
      reject(error);
    });
    socket.connect(port, host);
  });
}
