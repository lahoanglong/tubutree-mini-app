import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createValidationPipe } from '../../../common/validation-pipe';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentController } from './payment.controller';
import { ZalopayService } from './zalopay.service';
import { BankTransferService } from './bank-transfer.service';

const KEY2 = 'controller-key2';

/**
 * R2-LIFECYCLE-1: callback thật của ZaloPay là `{ data, mac, type }` (type 1 = đơn, 2 = agreement). Đi qua HTTP + đúng
 * ValidationPipe toàn cục của main.ts (whitelist + chặn trường lạ) thì không được 400 vì trường `type`.
 */
describe('POST /webhooks/zalopay qua ValidationPipe toàn cục', () => {
  let app: INestApplication;
  const order = { id: 'o1', code: 'TUBU1', userId: 'u1', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT', total: 285000 };
  const attempt = { id: 'a1', orderId: 'o1', appTransId: '261014_TUBU1_abc123', amount: 285000, order };
  const updateMany = jest.fn();
  const attemptUpdateMany = jest.fn();
  const notify = jest.fn();

  beforeAll(async () => {
    const prisma: Record<string, unknown> = {
      order: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(order), updateMany },
      paymentAttempt: { findUnique: jest.fn().mockResolvedValue(attempt), updateMany: attemptUpdateMany, update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown): unknown => cb(prisma)),
    };
    const config = {
      get: (k: string) =>
        ({ ZALOPAY_APP_ID: '2553', ZALOPAY_KEY1: 'k1', ZALOPAY_KEY2: KEY2, ZALOPAY_ENDPOINT: 'http://127.0.0.1:9' })[k] ?? '',
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        ZalopayService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { notify } },
        { provide: ConfigService, useValue: config },
        { provide: BankTransferService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(createValidationPipe());
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    attemptUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    notify.mockReset().mockResolvedValue(undefined);
  });

  function callbackBody(extra: Record<string, unknown> = {}) {
    const data = JSON.stringify({
      app_id: 2553,
      app_trans_id: attempt.appTransId,
      app_time: 1760400000000,
      app_user: 'u1',
      amount: 285000,
      embed_data: '{"orderCode":"TUBU1"}',
      item: '[]',
      zp_trans_id: 251014000000123,
      server_time: 1760400060000,
      channel: 38,
      merchant_user_id: 'mu',
      user_fee_amount: 0,
      discount_amount: 0,
    });
    return { data, mac: createHmac('sha256', KEY2).update(data).digest('hex'), type: 1, ...extra };
  }

  async function post(body: unknown) {
    const res = await fetch(`${await app.getUrl()}/webhooks/zalopay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it('body đúng mẫu ZaloPay {data, mac, type:1} → 200 return_code 1, đơn lật PAID/CONFIRMED', async () => {
    const res = await post(callbackBody());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ return_code: 1, return_message: 'success' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'PAID', status: 'CONFIRMED' }) }),
    );
    expect(notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU1' });
  });

  it('ZaloPay thêm trường mới vào body → vẫn nhận (không 400 vì trường lạ)', async () => {
    const res = await post(callbackBody({ version: 2 }));
    expect(res.status).toBe(200);
    expect(res.json.return_code).toBe(1);
  });

  it('MAC sai → return_code -1, không đụng đơn', async () => {
    const res = await post({ ...callbackBody(), mac: 'x'.repeat(64) });
    expect(res.status).toBe(200);
    expect(res.json.return_code).toBe(-1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('thiếu data/mac → 400, không đụng đơn', async () => {
    const res = await post({ type: 1 });
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('callback agreement (type 2) → ghi nhận, không xử lý như thanh toán đơn', async () => {
    const res = await post(callbackBody({ type: 2 }));
    expect(res.status).toBe(200);
    expect(res.json.return_code).toBe(1);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
