import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { OrderConfirmEmailService } from '../../notifications/order-email/order-confirm-email.service';
import { MSS_FALLBACK_SHUTDOWN_WAIT_MS, MssOrderEventFallback } from './mss-order-event.fallback';

/**
 * Tắt ứng dụng khi email đường lui còn đang gửi (wave tubu-w39-01, review w38-02 MINOR-1): chờ tối đa MSS_FALLBACK_SHUTDOWN_WAIT_MS, không
 * để timer treo khi email xong sớm, và không mở email mới sau khi đã bắt đầu tắt. Đồng hồ giả; Prisma giả theo khuôn spec MSS khác.
 */
describe('MssOrderEventFallback: tắt ứng dụng', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    for (const level of ['log', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Dòng `order.created` người mua, MSS bỏ qua vì quyền riêng tư, không có ZNS hoãn: đường lui IN_APP_ONLY + email. */
  function setup(sendForEvent: jest.Mock) {
    const row = {
      id: 'row-1',
      eventId: 'evt-1',
      eventType: 'order.created',
      recipientRole: 'buyer',
      orderCode: 'TB1A2B',
      status: 'RESULT_SKIPPED',
      resultReason: 'privacy_blocked',
      lastHttpStatus: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      fallbackAt: null,
      znsHeldTemplate: null,
      znsHeldData: null,
      order: { userId: 'u1' },
    };
    const prisma = {
      mssOrderEventOutbox: {
        findUnique: jest.fn(async () => row),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    } as unknown as PrismaService;
    const notifications = { sendHeldZns: jest.fn() } as unknown as NotificationsService;
    const orderEmail = { sendForEvent } as unknown as OrderConfirmEmailService;
    return new MssOrderEventFallback(prisma, notifications, orderEmail);
  }

  /** Theo dõi lời hứa: `done` đổi thành true khi nó xong. */
  function track(p: Promise<unknown>) {
    const state = { done: false };
    void p.then(() => {
      state.done = true;
    });
    return state;
  }

  it('F1 email treo mãi: onModuleDestroy xong đúng sau 5000 ms, cảnh báo một lần', async () => {
    const sendForEvent = jest.fn(() => new Promise<never>(() => undefined));
    const fallback = setup(sendForEvent);
    expect(await fallback.run('evt-1')).toBe('IN_APP_ONLY');
    expect(sendForEvent).toHaveBeenCalledTimes(1);

    const destroy = track(fallback.onModuleDestroy());
    await jest.advanceTimersByTimeAsync(MSS_FALLBACK_SHUTDOWN_WAIT_MS - 1);
    expect(destroy.done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(destroy.done).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(`${MSS_FALLBACK_SHUTDOWN_WAIT_MS} ms`);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('F2 email xong sau 100 ms: onModuleDestroy xong ở ~100 ms, không cảnh báo, không còn timer', async () => {
    const sendForEvent = jest.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('SENT'), 100)));
    const fallback = setup(sendForEvent);
    expect(await fallback.run('evt-1')).toBe('IN_APP_ONLY');

    const destroy = track(fallback.onModuleDestroy());
    await jest.advanceTimersByTimeAsync(99);
    expect(destroy.done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(destroy.done).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('F3 sau khi bắt đầu tắt: đường lui vẫn chốt IN_APP_ONLY nhưng không mở email mới (cron quét cứu sau)', async () => {
    const sendForEvent = jest.fn(async () => 'SENT');
    const fallback = setup(sendForEvent);
    await fallback.onModuleDestroy();
    expect(await fallback.run('evt-1')).toBe('IN_APP_ONLY');
    expect(sendForEvent).not.toHaveBeenCalled();
  });

  it('F4 không có email đang gửi: xong ngay, không tạo timer', async () => {
    const fallback = setup(jest.fn());
    const destroy = track(fallback.onModuleDestroy());
    await Promise.resolve();
    await Promise.resolve();
    expect(destroy.done).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
