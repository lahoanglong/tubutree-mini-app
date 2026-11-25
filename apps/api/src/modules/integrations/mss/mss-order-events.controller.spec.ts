import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { bodyParserErrorHandler, createBodyParsers, requestInputGuard } from '../../../common/body-limits';
import { readMssEnv } from './mss-config';
import { MSS_ENV_READER } from './mss-flags';
import { MSS_UNAUTHORIZED_BODY } from './mss-inbound.guard';
import { MssOrderEventSender } from './mss-order-event.sender';
import { MssOrderEventsCallbackController, parseMssEventResult } from './mss-order-events.controller';
import { computeMssSignature } from './mss-signer';

const INBOUND = 'inbound-secret-not-for-prod-0123456789abcdef';
const env = readMssEnv({
  NODE_ENV: 'test',
  MSS_BASE_URL: 'https://mss.example.test',
  MSS_KEY_ID: 'tubu-test',
  MSS_OUTBOUND_SECRET: 'outbound-secret-not-for-prod-0123456789',
  MSS_INBOUND_SECRET: INBOUND,
});

const RESULT = {
  event_id: '01JCX9Z7Q4M8T2K5V6W3Y0ABCD',
  order_code: 'TB2611170001',
  event_type: 'order.shipping',
  status: 'sent',
  reason: null,
  sent_at: '2026-11-17T10:00:00+07:00',
};

describe('POST /api/integrations/mss/order-event-results (HTTP thật, chữ ký HMAC)', () => {
  let app: INestApplication;
  let base: string;
  const applyResult = jest.fn(async () => 'applied' as const);

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mod = await Test.createTestingModule({
      controllers: [MssOrderEventsCallbackController],
      providers: [
        { provide: MSS_ENV_READER, useValue: () => env },
        { provide: MssOrderEventSender, useValue: { applyResult } },
      ],
    }).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    app.use(...createBodyParsers('access-secret-not-for-prod-0123456789abc', 30), bodyParserErrorHandler, requestInputGuard);
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });
  beforeEach(() => applyResult.mockClear());

  const post = (raw: string, headers: Record<string, string>) =>
    fetch(`${base}/api/integrations/mss/order-event-results`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
  const sign = (raw: string, ts = Math.floor(Date.now() / 1000), secret = INBOUND) => ({
    'x-mss-key-id': 'tubu-test',
    'x-mss-timestamp': String(ts),
    'x-mss-signature': computeMssSignature(secret, ts, Buffer.from(raw)),
  });

  it('ký đúng: 200, gọi applyResult đúng 1 lần với dữ liệu đã đọc (khoá lạ như sent_at bị bỏ qua)', async () => {
    const raw = JSON.stringify(RESULT);
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'applied' });
    expect(applyResult).toHaveBeenCalledTimes(1);
    expect(applyResult).toHaveBeenCalledWith(RESULT.event_id, { orderCode: RESULT.order_code, eventType: 'order.shipping' }, 'sent', null, 'callback');
  });

  it('MSS W37/W38 skipped/stranger_cap ký đúng: 200, applyResult nhận đúng lý do stranger_cap', async () => {
    const body = { ...RESULT, event_type: 'order.created', status: 'skipped', reason: 'stranger_cap' };
    const raw = JSON.stringify(body);
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(applyResult).toHaveBeenCalledWith(RESULT.event_id, { orderCode: RESULT.order_code, eventType: 'order.created' }, 'skipped', 'stranger_cap', 'callback');
  });

  it('(6) chữ ký sai: 401 thân chung, không đổi gì', async () => {
    const raw = JSON.stringify(RESULT);
    const res = await post(raw, sign(raw, undefined, 'wrong-secret-0123456789abcdef0123456789'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(MSS_UNAUTHORIZED_BODY);
    expect(applyResult).not.toHaveBeenCalled();
  });

  it('(6) đổi thân sau khi ký: 401, không đổi gì', async () => {
    const raw = JSON.stringify(RESULT);
    const res = await post(raw.replace('"sent"', '"skipped"'), sign(raw));
    expect(res.status).toBe(401);
    expect(applyResult).not.toHaveBeenCalled();
  });

  it('(6) lệch giờ hơn 300 giây (cả hai phía): 401, không đổi gì', async () => {
    const raw = JSON.stringify(RESULT);
    const now = Math.floor(Date.now() / 1000);
    expect((await post(raw, sign(raw, now - 301))).status).toBe(401);
    expect((await post(raw, sign(raw, now + 301))).status).toBe(401);
    expect(applyResult).not.toHaveBeenCalled();
  });

  it('ký đúng nhưng thân sai hợp đồng: 400 invalid_body, không đổi gì', async () => {
    const raw = JSON.stringify({ ...RESULT, status: 'delivered' });
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(400);
    expect(applyResult).not.toHaveBeenCalled();
  });
});

describe('parseMssEventResult', () => {
  it('nhận đủ bốn trạng thái và reason null/thiếu', () => {
    for (const status of ['sent', 'skipped', 'failed', 'unknown']) {
      expect(parseMssEventResult({ ...RESULT, status })?.status).toBe(status);
    }
    const { reason: _r, ...noReason } = RESULT;
    expect(parseMssEventResult(noReason)?.reason).toBeNull();
  });

  it('MSS W37/W38: giữ nguyên lý do tin người lạ (sent/stranger, unknown/stranger, skipped/stranger_cap)', () => {
    expect(parseMssEventResult({ ...RESULT, status: 'sent', reason: 'stranger' })).toMatchObject({ status: 'sent', reason: 'stranger' });
    expect(parseMssEventResult({ ...RESULT, status: 'unknown', reason: 'stranger' })).toMatchObject({ status: 'unknown', reason: 'stranger' });
    expect(parseMssEventResult({ ...RESULT, status: 'skipped', reason: 'stranger_cap' })).toMatchObject({ status: 'skipped', reason: 'stranger_cap' });
  });

  it('từ chối event_id sai dạng, event_type lạ, order_code rỗng, reason không phải chuỗi, thân không phải object', () => {
    expect(parseMssEventResult({ ...RESULT, event_id: 'short' })).toBeNull();
    expect(parseMssEventResult({ ...RESULT, event_type: 'order.returned' })).toBeNull();
    expect(parseMssEventResult({ ...RESULT, order_code: '' })).toBeNull();
    expect(parseMssEventResult({ ...RESULT, reason: 42 })).toBeNull();
    expect(parseMssEventResult([RESULT])).toBeNull();
    expect(parseMssEventResult(null)).toBeNull();
  });
});
