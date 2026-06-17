/*
 * getfluxo.io - Minimal Redis RESP Client
 * Copyright (c) 2026 getfluxo.io
 * License: PROPRIETARY
 */

import { Socket } from 'net';

export class SimpleRedisClient {
  private readonly host: string;
  private readonly port: number;

  constructor(redisUrl: string) {
    const parsed = new URL(redisUrl);
    this.host = parsed.hostname || 'localhost';
    this.port = Number(parsed.port || 6379);
  }

  async ping(): Promise<string> {
    return this.command('PING');
  }

  async command(...args: Array<string | number>): Promise<any> {
    const payload = encodeCommand(args.map(String));
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let buffer = Buffer.alloc(0);

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.setTimeout(1000);
      socket.once('connect', () => socket.write(payload));
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const parsed = parseResponse(buffer);
          cleanup();
          resolve(parsed.value);
        } catch (error: any) {
          if (error?.message !== 'RESP_INCOMPLETE') {
            cleanup();
            reject(error);
          }
        }
      });
      socket.once('timeout', () => {
        cleanup();
        reject(new Error(`Redis timeout at ${this.host}:${this.port}`));
      });
      socket.once('error', (error) => {
        cleanup();
        reject(error);
      });
      socket.connect(this.port, this.host);
    });
  }
}

function encodeCommand(args: string[]): string {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join('')}`;
}

function parseResponse(buffer: Buffer, offset = 0): { value: any; offset: number } {
  if (offset >= buffer.length) {
    throw new Error('RESP_INCOMPLETE');
  }

  const type = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf('\r\n', offset);
  if (lineEnd === -1) {
    throw new Error('RESP_INCOMPLETE');
  }

  const line = buffer.slice(offset + 1, lineEnd).toString();
  const nextOffset = lineEnd + 2;

  switch (type) {
    case '+':
      return { value: line, offset: nextOffset };
    case '-':
      throw new Error(line);
    case ':':
      return { value: Number(line), offset: nextOffset };
    case '$':
      return parseBulkString(buffer, Number(line), nextOffset);
    case '*':
      return parseArray(buffer, Number(line), nextOffset);
    default:
      throw new Error(`Unsupported Redis response: ${type}`);
  }
}

function parseBulkString(buffer: Buffer, length: number, offset: number): { value: string | null; offset: number } {
  if (length === -1) {
    return { value: null, offset };
  }

  const end = offset + length;
  if (buffer.length < end + 2) {
    throw new Error('RESP_INCOMPLETE');
  }

  return {
    value: buffer.slice(offset, end).toString(),
    offset: end + 2,
  };
}

function parseArray(buffer: Buffer, length: number, offset: number): { value: any[] | null; offset: number } {
  if (length === -1) {
    return { value: null, offset };
  }

  const values: any[] = [];
  let cursor = offset;
  for (let i = 0; i < length; i += 1) {
    const parsed = parseResponse(buffer, cursor);
    values.push(parsed.value);
    cursor = parsed.offset;
  }
  return { value: values, offset: cursor };
}
