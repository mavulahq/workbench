import { ServiceTokenService } from '../src/auth/service-token.service';
import { loadJose } from '../src/auth/access-token.guard';

describe('ServiceTokenService', () => {
  it('uses private_key_jwt and caches a short-lived token per tenant', async () => {
    const { exportJWK, generateKeyPair } = await loadJose();
    const { privateKey } = await generateKeyPair('PS256', { modulusLength: 2048, extractable: true });
    const jwk = await exportJWK(privateKey);
    process.env.OIDC_TOKEN_ENDPOINT = 'https://identity.mavula.io/token';
    process.env.WORKBENCH_OIDC_CLIENT_ID = 'workbench-service';
    process.env.WORKBENCH_PRIVATE_JWK_JSON = JSON.stringify({
      ...jwk,
      alg: 'PS256',
      kid: 'workbench-test',
      use: 'sig',
    });
    process.env.LEDGER_CORE_AUDIENCE = 'urn:mavula:ledger-core';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'signed-access-token', expires_in: 300 }),
    } as any);
    const service = new ServiceTokenService();
    await expect(service.forTenant('tenant-1')).resolves.toBe('signed-access-token');
    await expect(service.forTenant('tenant-1')).resolves.toBe('signed-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][1]!;
    const body = request.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('tenant_id')).toBe('tenant-1');
    expect(body.get('resource')).toBe('urn:mavula:ledger-core');
    expect(body.get('scope')).toBe('internal.worker regulatory.export');
    expect(body.get('client_assertion')).toBeTruthy();
    fetchMock.mockRestore();
  });
});
