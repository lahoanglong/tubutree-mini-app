import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEnv } from './env';
import { BridgeError } from './zalo-client';
import { createServer } from './server';

const SECRET = 'S'.repeat(32);

function fakeClient() {
  return {
    state: vi.fn(() => ({ state: 'CONNECTED' })),
    qrStart: vi.fn(async () => ({ status: 'WAITING_SCAN' as const, image: 'data:image/png;base64,A' })),
    qrStatus: vi.fn(() => ({ status: 'IDLE' as const })),
    logout: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    groups: vi.fn(async () => [{ id: 'G1', name: 'n', memberCount: 2 }]),
    setGroup: vi.fn(async () => undefined),
    send: vi.fn(async () => ({ msgId: '111' })),
  };
}

describe('server', () => {
  let client: ReturnType<typeof fakeClient>;
  let base: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    client = fakeClient();
    const server = createServer(client as never, { ZALO_BRIDGE_SECRET: SECRET } as BridgeEnv);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  afterEach(() => close());

  const call = (method: string, path: string, body?: unknown, auth: string | null = `Bearer ${SECRET}`) =>
    fetch(base + path, {
      method,
      headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('thiếu hoặc sai Bearer thì 401 trên mọi lệnh và không chạm client', async () => {
    const routes: [string, string][] = [
      ['GET', '/health'], ['POST', '/qr/start'], ['GET', '/qr/status'], ['POST', '/logout'], ['POST', '/reconnect'],
      ['GET', '/groups'], ['PUT', '/config'], ['POST', '/send'], ['GET', '/khong-co'],
    ];
    for (const [m, p] of routes) {
      expect((await call(m, p, m === 'GET' ? undefined : {}, null)).status).toBe(401);
      expect((await call(m, p, m === 'GET' ? undefined : {}, 'Bearer sai')).status).toBe(401);
    }
    expect(client.send).not.toHaveBeenCalled();
    expect(client.logout).not.toHaveBeenCalled();
  });

  it('GET /health', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ state: 'CONNECTED' });
  });

  it('QR, logout, reconnect', async () => {
    expect(await (await call('POST', '/qr/start')).json()).toEqual({ status: 'WAITING_SCAN', image: 'data:image/png;base64,A' });
    expect(await (await call('GET', '/qr/status')).json()).toEqual({ status: 'IDLE' });
    expect(await (await call('POST', '/logout')).json()).toEqual({ ok: true });
    expect(await (await call('POST', '/reconnect')).json()).toEqual({ ok: true });
    expect(client.logout).toHaveBeenCalled();
    expect(client.reconnect).toHaveBeenCalled();
  });

  it('POST /reconnect trả ngay, không đợi connect, lỗi chỉ được ghi log', async () => {
    client.reconnect.mockImplementationOnce(() => new Promise(() => undefined));
    const r = await Promise.race([call('POST', '/reconnect'), new Promise<null>((res) => setTimeout(() => res(null), 500))]);
    expect(r).not.toBeNull();
    expect(await (r as Response).json()).toEqual({ ok: true });

    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client.reconnect.mockRejectedValueOnce(new Error('boom'));
    expect((await call('POST', '/reconnect')).status).toBe(200);
    await new Promise((res) => setImmediate(res));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('GET /groups, chưa kết nối thì 409', async () => {
    expect(await (await call('GET', '/groups')).json()).toEqual({ groups: [{ id: 'G1', name: 'n', memberCount: 2 }] });
    client.groups.mockRejectedValueOnce(new BridgeError('NOT_CONNECTED'));
    const r = await call('GET', '/groups');
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ code: 'NOT_CONNECTED' });
  });

  it('PUT /config lưu groupId, từ chối kiểu sai', async () => {
    const r = await call('PUT', '/config', { groupId: 'G1' });
    expect(await r.json()).toEqual({ groupId: 'G1' });
    expect(client.setGroup).toHaveBeenCalledWith('G1');
    expect(await (await call('PUT', '/config', { groupId: null })).json()).toEqual({ groupId: null });
    expect((await call('PUT', '/config', { groupId: 5 })).status).toBe(400);
  });

  it('POST /send trả msgId, lỗi nghiệp vụ đúng mã', async () => {
    const r = await call('POST', '/send', { idempotencyKey: 'k', text: 'xin chào' });
    expect(await r.json()).toEqual({ msgId: '111' });
    expect(client.send).toHaveBeenCalledWith({ idempotencyKey: 'k', text: 'xin chào' });

    client.send.mockRejectedValueOnce(new BridgeError('NO_GROUP'));
    const a = await call('POST', '/send', { idempotencyKey: 'k2', text: 'x' });
    expect(a.status).toBe(409);
    expect(await a.json()).toEqual({ code: 'NO_GROUP' });

    client.send.mockRejectedValueOnce(new BridgeError('SEND_FAILED', 'zalo down'));
    const b = await call('POST', '/send', { idempotencyKey: 'k3', text: 'x' });
    expect(b.status).toBe(502);
    expect(await b.json()).toEqual({ code: 'SEND_FAILED', message: 'zalo down' });

    expect((await call('POST', '/send', { idempotencyKey: '', text: 'x' })).status).toBe(400);
    expect((await call('POST', '/send', { idempotencyKey: 'k', text: '' })).status).toBe(400);
  });

  it('đường lạ có xác thực thì 404', async () => {
    expect((await call('GET', '/khong-co')).status).toBe(404);
  });
});
