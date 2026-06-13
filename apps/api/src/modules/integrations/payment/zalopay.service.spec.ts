import { createHmac } from 'node:crypto';
import { ZalopayService } from './zalopay.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { ConfigService } from '@nestjs/config';

const KEY2 = 'test-key2';

function makeConfig(configured = true): ConfigService {
  const map: Record<string, string> = configured
    ? {
        ZALOPAY_APP_ID: '2553',
        ZALOPAY_KEY1: 'k1',
        ZALOPAY_KEY2: KEY2,
        ZALOPAY_ENDPOINT: 'https://sb-openapi.zalopay.vn/v2',
      }
    : { ZALOPAY_APP_ID: '', ZALOPAY_KEY1: '', ZALOPAY_KEY2: '', ZALOPAY_ENDPOINT: '' };
  return { get: (k: string) => map[k] ?? '' } as unknown as ConfigService;
}

function sign(rawData: string): string {
  return createHmac('sha256', KEY2).update(rawData).digest('hex');
}

describe('ZalopayService.handleCallback (verify MAC §10.1)', () => {
  const order = { id: 'o1', code: 'TUBU1', userId: 'u1', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' };

  function setup(over: Record<string, unknown> = {}) {
    const update = jest.fn().mockResolvedValue({});
    const findFirst = jest.fn().mockResolvedValue(order);
    const prisma = { order: { findFirst, update } } as unknown as PrismaService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifications = { notify } as unknown as NotificationsService;
    const svc = new ZalopayService(prisma, notifications, makeConfig(true) as never);
    return { svc, update, findFirst, notify, ...over };
  }

  it('chưa cấu hình → return_code 2, không xử lý', async () => {
    const prisma = { order: { findFirst: jest.fn(), update: jest.fn() } } as unknown as PrismaService;
    const svc = new ZalopayService(prisma, { notify: jest.fn() } as unknown as NotificationsService, makeConfig(false) as never);
    const r = await svc.handleCallback('{}', 'whatever');
    expect(r.return_code).toBe(2);
  });

  it('MAC sai → return_code -1, KHÔNG cập nhật đơn', async () => {
    const { svc, update } = setup();
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    const r = await svc.handleCallback(raw, 'mac-gia-mao');
    expect(r.return_code).toBe(-1);
    expect(update).not.toHaveBeenCalled();
  });

  it('MAC đúng → set PAID + CONFIRMED + notify', async () => {
    const { svc, update, notify } = setup();
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    const r = await svc.handleCallback(raw, sign(raw));
    expect(r.return_code).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    const data = (update as jest.Mock).mock.calls[0][0].data;
    expect(data.paymentStatus).toBe('PAID');
    expect(data.status).toBe('CONFIRMED');
    expect(notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU1' });
  });

  it('MAC đúng nhưng đơn đã PAID → không xử lý lại (idempotent)', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ ...order, paymentStatus: 'PAID' }), update },
    } as unknown as PrismaService;
    const notify = jest.fn();
    const svc = new ZalopayService(prisma, { notify } as unknown as NotificationsService, makeConfig(true) as never);
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    const r = await svc.handleCallback(raw, sign(raw));
    expect(r.return_code).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('MAC đúng độ dài khác (timingSafeEqual không ném) → -1', async () => {
    const { svc, update } = setup();
    const raw = JSON.stringify({ app_trans_id: 'x' });
    const r = await svc.handleCallback(raw, 'short'); // ngắn hơn hex digest → length khác
    expect(r.return_code).toBe(-1);
    expect(update).not.toHaveBeenCalled();
  });
});
