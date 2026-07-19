import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getRuntimeConfig } from '../utils/runtime-config';
import { loadJose } from './access-token.guard';

interface CachedToken {
  value: string;
  refreshAt: number;
}

@Injectable()
export class ServiceTokenService {
  private readonly config = getRuntimeConfig();
  private readonly cache = new Map<string, CachedToken>();

  async forTenant(tenantId: string): Promise<string> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.refreshAt > Date.now()) return cached.value;
    const token = await this.request(tenantId);
    this.cache.set(tenantId, token);
    return token.value;
  }

  private async request(tenantId: string): Promise<CachedToken> {
    const clientId = this.required('WORKBENCH_OIDC_CLIENT_ID', this.config.oidcClientId);
    const tokenEndpoint = this.required('OIDC_TOKEN_ENDPOINT', this.config.oidcTokenEndpoint);
    const privateJwk = this.json(this.required('WORKBENCH_PRIVATE_JWK_JSON', this.config.oidcPrivateJwk));
    if (process.env.NODE_ENV === 'production' && new URL(tokenEndpoint).protocol !== 'https:') {
      throw new Error('OIDC_TOKEN_ENDPOINT must use HTTPS in production');
    }
    if (privateJwk.kty !== 'RSA' || privateJwk.alg !== 'PS256' || typeof privateJwk.kid !== 'string' || typeof privateJwk.d !== 'string') {
      throw new Error('WORKBENCH_PRIVATE_JWK_JSON must be a private RSA PS256 key with kid');
    }
    const { importJWK, SignJWT } = await loadJose();
    const key = await importJWK(privateJwk, String(privateJwk.alg || 'PS256'));
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: String(privateJwk.alg || 'PS256'), kid: String(privateJwk.kid), typ: 'JWT' })
      .setIssuer(clientId)
      .setSubject(clientId)
      .setAudience(tokenEndpoint)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(key);
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      resource: this.config.ledgerCoreAudience,
      scope: 'internal.worker regulatory.export',
      tenant_id: tenantId,
    });
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(this.config.internalRequestTimeoutMs),
    });
    const result = await response.json() as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !result.access_token) {
      throw new Error(`service token request failed (${response.status}): ${result.error || 'invalid response'}`);
    }
    const expiresIn = Math.max(1, Number(result.expires_in || 300));
    return {
      value: result.access_token,
      refreshAt: Date.now() + Math.max(1, expiresIn - 30) * 1000,
    };
  }

  private required(name: string, value: string): string {
    if (!value) throw new Error(`${name} is required`);
    return value;
  }

  private json(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      throw new Error('WORKBENCH_PRIVATE_JWK_JSON must be valid JSON');
    }
  }
}
