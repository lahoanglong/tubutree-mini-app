import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { readMssEnv, type MssEnv } from './mss-config';
import { MSS_CIRCUIT_KEY, MSS_CIRCUIT_OPEN_MS, MSS_CIRCUIT_THRESHOLD, MssCircuitBreaker, type MssSharedStore } from './mss-circuit';
import { MssClient, MssRequestError, parseHealthDoc, type MssFetch } from './mss.client';
import { verifyMssSignature } from './mss-signer';

const FIXTURES = join(__dirname, '../../../../test/fixtures/mss');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const ORDER_EVENT = fixture('order-event.json');
const PHONE = '0901234567';
const OUT_SECRET = 'outbound-secret-not-for-prod-0123456789';

const env = (over: Record<string, string | undefined> = {}): MssEnv =>
  readMssEnv({
    NODE_ENV: 'test',
    MSS_BASE_URL: 'https://mss.example.test/',
    MSS_KEY_ID: 'tubu-test',
    MSS_OUTBOUND_SECRET: OUT_SECRET,
    MSS_INBOUND_SECRET: 'inbound-secret-not-for-prod-0123456789',
    ...over,
  });

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

class MemoryStore implements MssSharedStore {
  readonly data = new Map<string, string>();
  fail = false;
  async get(k: string) {
    if (this.fail) throw new Error('redis down');
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    if (this.fail) throw new Error('redis down');
    this.data.set(k, v);
  }
  async setIfAbsent(k: string, v: string) {
    if (this.fail) throw new Error('redis down');
    if (this.data.has(k)) return false;
    this.data.set(k, v);
    return true;
  }
  async del(k: string) {
    if (this.fail) throw new Error('redis down');
    this.data.delete(k);
  }
}

const flush = () => new Promise((r) => setImmediate(r));

describe('MssClient', () => {
  let logs: string[];
  let now: number;
  beforeEach(() => {
    logs = [];
    now = Date.parse('2026-11-17T01:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(String(args[0]));
      });
    }
  });
  afterEach(() => jest.restoreAllMocks());

  const make = (fetchImpl: MssFetch, e: MssEnv = env(), store?: MssSharedStore) => new MssClient(() => e, fetchImpl, store);

  it('thiếu biến môi trường: not_configured, không gọi mạng', async () => {
    const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>();
    const c = make(f, readMssEnv({}));
    await expect(c.request('POST', '/order-events', { body: {} })).rejects.toMatchObject({ kind: 'not_configured' });
    await expect(c.health()).rejects.toMatchObject({ kind: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
    expect(c.isConfigured()).toBe(false);
  });

  it('ký đúng byte gửi đi, header X-Tubu-*, Idempotency-Key, không theo chuyển hướng, URL có tiền tố v1', async () => {
    const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(json(202, { event_id: 'x', status: 'queued', duplicate: false }));
    const res = await make(f).request('POST', '/order-events', { body: ORDER_EVENT, eventId: '01JCX9Z7Q4M8T2K5V6W3Y0ABCD', idempotencyKey: 'idem-1' });
    expect(res.status).toBe(202);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://mss.example.test/api/ext/tubu/v1/order-events');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe(ORDER_EVENT);
    const h = init.headers as Record<string, string>;
    expect(h['X-Tubu-Key-Id']).toBe('tubu-test');
    expect(h['Idempotency-Key']).toBe('idem-1');
    expect(h['Content-Type']).toMatch(/^application\/json/);
    const nowSec = Math.floor(now / 1000);
    expect(h['X-Tubu-Timestamp']).toBe(String(nowSec));
    expect(verifyMssSignature({ timestamp: h['X-Tubu-Timestamp'], signature: h['X-Tubu-Signature'], rawBody: ORDER_EVENT, secrets: [OUT_SECRET], nowSec })).toEqual({ ok: true, usedPreviousSecret: false });
  });

  it('GET không thân: ký "<ts>.", không Content-Type, không body', async () => {
    const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(json(200, { ok: true }));
    await make(f).request('GET', '/catalog/products?updated_since=2026-11-01');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://mss.example.test/api/ext/tubu/v1/catalog/products?updated_since=2026-11-01');
    expect(init.body).toBeUndefined();
    const h = init.headers as Record<string, string>;
    expect(h['Content-Type']).toBeUndefined();
    expect(verifyMssSignature({ timestamp: h['X-Tubu-Timestamp'], signature: h['X-Tubu-Signature'], rawBody: '', secrets: [OUT_SECRET], nowSec: Math.floor(now / 1000) }).ok).toBe(true);
  });

  it('đường dẫn lạ (.., //, ký tự cấm) bị chặn trước khi gửi', async () => {
    const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>();
    const c = make(f);
    await expect(c.request('GET', '/../admin')).rejects.toThrow();
    await expect(c.request('GET', '//evil.example/x')).rejects.toThrow();
    await expect(c.request('GET', 'health')).rejects.toThrow();
    await expect(c.request('GET', '/a b')).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it('quá hạn chờ: lỗi timeout (thử lại được), có thời lượng trong log, không thân', async () => {
    const f: MssFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const err = await make(f).request('POST', '/order-events', { body: ORDER_EVENT, timeoutMs: 20, eventId: 'evt-1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MssRequestError);
    expect((err as MssRequestError).kind).toBe('timeout');
    expect((err as MssRequestError).transient).toBe(true);
    expect(logs.join('\n')).toMatch(/MSS POST order-events event evt-1: timeout \d+ms/);
  });

  it('lỗi mạng: network', async () => {
    const f: MssFetch = () => Promise.reject(new TypeError('fetch failed'));
    await expect(make(f).request('GET', '/health')).rejects.toMatchObject({ kind: 'network' });
  });

  it.each([
    [401, { error: 'stale_timestamp', message: 'x' }, 'stale_timestamp', true],
    [401, { error: 'unauthorized', message: 'x' }, 'unauthorized', false],
    [429, { error: 'rate_limited', message: 'x' }, 'rate_limited', true],
    [503, { error: 'disabled', message: 'x' }, 'unavailable', true],
    [500, 'Internal Server Error', 'server_error', true],
    [422, { error: 'unknown_event_type', message: 'x' }, 'client_error', false],
    [409, { error: 'conflict', message: 'x' }, 'client_error', false],
  ] as const)('HTTP %d %j → %s (transient=%s)', async (status, body, kind, transient) => {
    const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(json(status, body, { 'retry-after': '300' }));
    const err = (await make(f).request('POST', '/order-events', { body: {} }).catch((e: unknown) => e)) as MssRequestError;
    expect(err.kind).toBe(kind);
    expect(err.transient).toBe(transient);
    expect(err.status).toBe(status);
    expect(err.details.retryAfterSec).toBe(300);
  });

  it('2xx mà thân không phải JSON: invalid_response', async () => {
    const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(make(f).request('GET', '/health')).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('log không chứa thân yêu cầu, thân phản hồi hay SĐT trên đường dẫn', async () => {
    const leaky = `{"error":"bad_request","message":"phone ${PHONE} Fuwa3e"}`;
    const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>()
      .mockResolvedValueOnce(json(400, leaky))
      .mockResolvedValueOnce(json(200, { phone: PHONE }))
      .mockResolvedValueOnce(json(500, leaky));
    const c = make(f);
    await c.request('POST', '/order-events', { body: ORDER_EVENT, eventId: 'evt-2' }).catch(() => undefined);
    await c.request('GET', `/customers/${PHONE}`);
    await c.request('PUT', `/customers/${PHONE}`, { body: { phone: PHONE } }).catch(() => undefined);
    const all = logs.join('\n');
    expect(all).toContain('evt-2');
    expect(all).toContain('HTTP 400');
    expect(all).not.toContain(PHONE);
    expect(all).not.toContain('Fuwa3e');
    expect(all).not.toContain('tracking_url');
    expect(all).not.toContain(OUT_SECRET);
  });

  describe('cầu dao', () => {
    it(`${MSS_CIRCUIT_THRESHOLD} lỗi liên tiếp (timeout/5xx/mạng) thì ngắt: lời gọi sau lỗi ngay circuit_open, không gọi mạng`, async () => {
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockImplementation(async () => json(500, 'boom'));
      const c = make(f);
      for (let i = 0; i < MSS_CIRCUIT_THRESHOLD - 1; i++) await c.request('POST', '/order-events', { body: {} }).catch(() => undefined);
      expect(c.circuit.snapshot().state).toBe('closed');
      await c.request('POST', '/order-events', { body: {} }).catch(() => undefined);
      expect(c.circuit.snapshot()).toMatchObject({ state: 'open', consecutiveFailures: MSS_CIRCUIT_THRESHOLD, lastFailureKind: 'server_error' });
      f.mockClear();
      await expect(c.request('POST', '/order-events', { body: {} })).rejects.toMatchObject({ kind: 'circuit_open' });
      expect(f).not.toHaveBeenCalled();
    });

    it('4xx (kể cả 401, 429) không tính và xoá chuỗi lỗi: MSS vẫn sống', async () => {
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockImplementation(async () => json(503, { error: 'disabled' }));
      const c = make(f);
      for (let i = 0; i < MSS_CIRCUIT_THRESHOLD - 1; i++) await c.request('GET', '/health').catch(() => undefined);
      f.mockImplementationOnce(async () => json(429, { error: 'rate_limited' }));
      await c.request('GET', '/health').catch(() => undefined);
      expect(c.circuit.snapshot()).toMatchObject({ state: 'closed', consecutiveFailures: 0 });
    });

    it('hết 5 phút: lời gọi kế tiếp dò GET /health trước; /health tốt thì đóng và gửi tiếp', async () => {
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockImplementation(async () => json(500, 'boom'));
      const c = make(f);
      for (let i = 0; i < MSS_CIRCUIT_THRESHOLD; i++) await c.request('POST', '/order-events', { body: {} }).catch(() => undefined);
      now += MSS_CIRCUIT_OPEN_MS - 1;
      await expect(c.request('POST', '/order-events', { body: {} })).rejects.toMatchObject({ kind: 'circuit_open' });
      now += 2;
      f.mockReset();
      f.mockResolvedValueOnce(new Response(fixture('health.ok.json'), { status: 200 })).mockResolvedValueOnce(json(202, { status: 'queued' }));
      const res = await c.request('POST', '/order-events', { body: {} });
      expect(res.status).toBe(202);
      expect(f.mock.calls.map(([u, i]) => `${i.method} ${u}`)).toEqual([
        'GET https://mss.example.test/api/ext/tubu/v1/health',
        'POST https://mss.example.test/api/ext/tubu/v1/order-events',
      ]);
      expect(c.circuit.snapshot()).toMatchObject({ state: 'closed', consecutiveFailures: 0, openUntil: null });
    });

    it('dò /health hỏng (kể cả 401 hay ok:false) thì ngắt thêm một chu kỳ, lời gọi không được gửi', async () => {
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockImplementation(async () => json(500, 'boom'));
      const c = make(f);
      for (let i = 0; i < MSS_CIRCUIT_THRESHOLD; i++) await c.request('POST', '/order-events', { body: {} }).catch(() => undefined);
      for (const probe of [json(401, { error: 'unauthorized' }), json(200, { ok: false }), json(503, { error: 'disabled' })]) {
        now += MSS_CIRCUIT_OPEN_MS + 1;
        f.mockReset();
        f.mockResolvedValueOnce(probe);
        await expect(c.request('POST', '/order-events', { body: {} })).rejects.toMatchObject({ kind: 'circuit_open' });
        expect(f).toHaveBeenCalledTimes(1);
        expect(f.mock.calls[0]![0]).toMatch(/\/health$/);
        expect(c.circuit.snapshot().state).toBe('open');
      }
    });

    it('chỉ một lời gọi được dò; lời gọi khác trong lúc dò bị từ chối', async () => {
      const breaker = new MssCircuitBreaker(undefined, { threshold: 1, openMs: 1000, now: () => now });
      breaker.recordFailure('timeout');
      now += 1001;
      expect(await breaker.admit()).toBe('probe');
      expect(await breaker.admit()).toBe('reject');
      expect(breaker.snapshot().state).toBe('half_open');
      breaker.recordSuccess();
      expect(await breaker.admit()).toBe('allow');
    });

    it('mốc ngắt chép sang kho chung: replica khác cũng ngắt; đóng thì xoá mốc', async () => {
      const store = new MemoryStore();
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockImplementation(async () => json(500, 'boom'));
      const a = make(f, env(), store);
      for (let i = 0; i < MSS_CIRCUIT_THRESHOLD; i++) await a.request('POST', '/order-events', { body: {} }).catch(() => undefined);
      await flush();
      expect(Number(store.data.get(MSS_CIRCUIT_KEY))).toBe(now + MSS_CIRCUIT_OPEN_MS);
      const b = make(f, env(), store);
      f.mockClear();
      await expect(b.request('POST', '/order-events', { body: {} })).rejects.toMatchObject({ kind: 'circuit_open' });
      expect(f).not.toHaveBeenCalled();
      now += MSS_CIRCUIT_OPEN_MS + 1;
      f.mockReset();
      f.mockResolvedValueOnce(new Response(fixture('health.ok.json'), { status: 200 })).mockResolvedValueOnce(json(202, {}));
      await a.request('POST', '/order-events', { body: {} });
      await flush();
      expect(store.data.has(MSS_CIRCUIT_KEY)).toBe(false);
    });

    it('Redis lỗi: cầu dao chạy bằng bộ nhớ, không chặn lời gọi, báo kho unavailable', async () => {
      const store = new MemoryStore();
      store.fail = true;
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(json(200, { ok: true }));
      const c = make(f, env(), store);
      await expect(c.request('GET', '/health')).resolves.toMatchObject({ status: 200 });
      expect(c.circuit.snapshot().sharedStore).toBe('unavailable');
    });
  });

  describe('health()', () => {
    it('đọc thân /health hiện tại của MSS (contract là object, capabilities rỗng)', async () => {
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(new Response(fixture('health.ok.json'), { status: 200 }));
      await expect(make(f).health()).resolves.toEqual({ ok: true, capabilities: [], contract: { order_events: '1.2', commerce: '0.9' } });
    });

    it('đọc thân /health theo hợp đồng v0.9 (contract là chuỗi, đủ năng lực)', async () => {
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(new Response(fixture('health.full.json'), { status: 200 }));
      const doc = await make(f).health();
      expect(doc.contract).toBe('0.9');
      expect(doc.capabilities).toEqual(['catalog.enrichment', 'catalog.source', 'orders', 'invoice', 'customers', 'order_events']);
    });

    it('MSS tắt kết nối (503 disabled): unavailable', async () => {
      const f = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockResolvedValue(new Response(fixture('health.disabled.json'), { status: 503 }));
      await expect(make(f).health()).rejects.toMatchObject({ kind: 'unavailable' });
    });

    it('parseHealthDoc lọc năng lực sai dạng, trùng, quá dài', () => {
      expect(parseHealthDoc({ ok: true, capabilities: ['orders', 'orders', 'Bad Cap', 7, 'x'.repeat(80), 'invoice'] })).toEqual({ ok: true, capabilities: ['orders', 'invoice'], contract: null });
      expect(parseHealthDoc({ capabilities: [] })).toBeNull();
      expect(parseHealthDoc('ok')).toBeNull();
    });
  });
});
