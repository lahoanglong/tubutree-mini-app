import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { bodyParserErrorHandler, createBodyParsers, requestInputGuard } from '../../common/body-limits';
import { readMssEnv } from '../integrations/mss/mss-config';
import { MSS_ENV_READER } from '../integrations/mss/mss-flags';
import { MSS_UNAUTHORIZED_BODY } from '../integrations/mss/mss-inbound.guard';
import { computeMssSignature } from '../integrations/mss/mss-signer';
import { MssOrderStatusController, parseMssOrderStatus } from './mss-order-status.controller';
import { MssPaymentRescueService } from './mss-payment-rescue.service';

const INBOUND = 'inbound-secret-not-for-prod-0123456789abcdef';
const env = readMssEnv({
  NODE_ENV: 'test',
  MSS_BASE_URL: 'https://mss.example.test',
  MSS_KEY_ID: 'tubu-test',
  MSS_OUTBOUND_SECRET: 'outbound-secret-not-for-prod-0123456789',
  MSS_INBOUND_SECRET: INBOUND,
});

/** Thân mẫu của hợp đồng W4-02 (mss-tubu-wave4-draft.md), trên thân `order-status` của hợp đồng commerce mục 2.4. */
const OVERDUE = {
  order_code: 'TUBU2026111912345',
  sequence: 5,
  status: 'PENDING_PAYMENT',
  attention: null,
  at: '2026-11-20T14:00:05+07:00',
  payment_rescue: { state: 'overdue', overdue_at: '2026-11-20T14:00:00+07:00', reminders_sent: 2, last_reminded_at: '2026-11-19T20:02:00+07:00' },
};

const NOW = Date.parse('2026-11-20T07:00:05Z');

describe('parseMssOrderStatus', () => {
  it('đọc order_code và khối payment_rescue "overdue", bỏ qua khoá lạ', () => {
    expect(parseMssOrderStatus({ ...OVERDUE, extra: { a: 1 } }, NOW)).toEqual({
      orderCode: 'TUBU2026111912345',
      paymentRescue: { state: 'overdue', sent: 2, lastAt: new Date('2026-11-19T13:02:00.000Z') },
    });
  });

  it.each([
    ['MSS chưa gửi hai trường', {}, { sent: null, lastAt: null }],
    ['số nhắc âm', { reminders_sent: -1 }, { sent: null, lastAt: null }],
    ['số nhắc lẻ', { reminders_sent: 1.5 }, { sent: null, lastAt: null }],
    ['số nhắc là chuỗi', { reminders_sent: '2' }, { sent: null, lastAt: null }],
    ['số nhắc quá lớn', { reminders_sent: 1001 }, { sent: null, lastAt: null }],
    ['mốc không có múi giờ', { reminders_sent: 0, last_reminded_at: '2026-11-19T20:02:00' }, { sent: 0, lastAt: null }],
    ['mốc không đọc được', { last_reminded_at: 'hôm qua' }, { sent: null, lastAt: null }],
    ['mốc quá xa trong tương lai', { last_reminded_at: '2026-11-25T20:02:00+07:00' }, { sent: null, lastAt: null }],
    ['mốc trước 2026', { last_reminded_at: '2025-12-31T23:59:00Z' }, { sent: null, lastAt: null }],
  ])('%s: trường sai bỏ qua, khối overdue vẫn xử lý', (_name, extra, want) => {
    const body = { order_code: 'TUBU1', payment_rescue: { state: 'overdue', ...extra } };
    expect(parseMssOrderStatus(body, NOW)).toEqual({ orderCode: 'TUBU1', paymentRescue: { state: 'overdue', ...want } });
  });

  it.each([
    ['không có khối', { order_code: 'TUBU1' }],
    ['trạng thái lạ', { order_code: 'TUBU1', payment_rescue: { state: 'paid' } }],
    ['khối sai dạng', { order_code: 'TUBU1', payment_rescue: 'overdue' }],
    ['khối là mảng', { order_code: 'TUBU1', payment_rescue: [{ state: 'overdue' }] }],
  ])('%s: paymentRescue null (bên nhận bỏ qua khối không biết)', (_name, body) => {
    expect(parseMssOrderStatus(body)).toEqual({ orderCode: 'TUBU1', paymentRescue: null });
  });

  it.each([null, [], 'x', {}, { order_code: '' }, { order_code: 'A'.repeat(33) }, { order_code: 'TUBU 1' }, { order_code: 12 }])('thân %j: null (400)', (body) => {
    expect(parseMssOrderStatus(body)).toBeNull();
  });
});

describe('POST /api/integrations/mss/order-status (HTTP thật, chữ ký HMAC)', () => {
  let app: INestApplication;
  let base: string;
  const handleOverdue = jest.fn(async () => ({ outcome: 'cancelled' as const }));
  const recordReminders = jest.fn(async () => undefined);

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mod = await Test.createTestingModule({
      controllers: [MssOrderStatusController],
      providers: [
        { provide: MSS_ENV_READER, useValue: () => env },
        { provide: MssPaymentRescueService, useValue: { handleOverdue, recordReminders } },
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
  beforeEach(() => {
    handleOverdue.mockClear();
    recordReminders.mockClear();
  });

  const sign = (raw: string, ts = Math.floor(Date.now() / 1000), secret = INBOUND) => ({
    'x-mss-key-id': 'tubu-test',
    'x-mss-timestamp': String(ts),
    'x-mss-signature': computeMssSignature(secret, ts, Buffer.from(raw)),
  });
  const post = (raw: string, headers: Record<string, string>) =>
    fetch(`${base}/api/integrations/mss/order-status`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });

  it('ký đúng + khối overdue: 200 kèm kết quả của MssPaymentRescueService', async () => {
    const raw = JSON.stringify(OVERDUE);
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'cancelled' });
    expect(handleOverdue).toHaveBeenCalledTimes(1);
    expect(handleOverdue).toHaveBeenCalledWith('TUBU2026111912345');
    // Ghi số lần nhắc trước khi quyết huỷ, để đơn vừa tự huỷ vẫn hiện số nhắc ở admin.
    expect(recordReminders).toHaveBeenCalledWith('TUBU2026111912345', { sent: 2, lastAt: new Date('2026-11-19T13:02:00.000Z') });
    expect(recordReminders.mock.invocationCallOrder[0]).toBeLessThan(handleOverdue.mock.invocationCallOrder[0]!);
  });

  it('thân trạng thái thường (không có khối payment_rescue): 200 ignored, không đụng đơn', async () => {
    const raw = JSON.stringify({ order_code: 'TUBU2026111912345', sequence: 4, status: 'SHIPPING', attention: null });
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'ignored' });
    expect(handleOverdue).not.toHaveBeenCalled();
    expect(recordReminders).not.toHaveBeenCalled();
  });

  it('chữ ký sai, đổi thân sau khi ký, thiếu chữ ký, lệch giờ quá 300 giây: 401 thân chung, không gọi service', async () => {
    const raw = JSON.stringify(OVERDUE);
    const cases = [
      await post(raw, sign(raw, undefined, 'wrong-secret-0123456789abcdef0123456789')),
      await post(JSON.stringify({ ...OVERDUE, order_code: 'TUBU2026111999999' }), sign(raw)),
      await post(raw, {}),
      await post(raw, sign(raw, Math.floor(Date.now() / 1000) - 301)),
    ];
    for (const res of cases) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(MSS_UNAUTHORIZED_BODY);
    }
    expect(handleOverdue).not.toHaveBeenCalled();
  });

  it('ký đúng nhưng thiếu order_code: 400 invalid_body', async () => {
    const raw = JSON.stringify({ payment_rescue: { state: 'overdue' } });
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(400);
    expect(handleOverdue).not.toHaveBeenCalled();
  });

  it('service lỗi (DB): 5xx để MSS gửi lại', async () => {
    handleOverdue.mockRejectedValueOnce(new Error('db down'));
    const raw = JSON.stringify(OVERDUE);
    const res = await post(raw, sign(raw));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
