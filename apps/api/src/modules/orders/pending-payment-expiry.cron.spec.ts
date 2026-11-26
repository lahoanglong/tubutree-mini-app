import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import {
  DEALER_PENDING_PAYMENT_TTL_KEY,
  DEFAULT_DEALER_PENDING_PAYMENT_TTL_HOURS,
  DEFAULT_PENDING_PAYMENT_TTL_HOURS,
  PAYMENT_UNLINKED_HOLD_HOURS,
  PENDING_PAYMENT_TTL_KEY,
  PendingPaymentExpiryCron,
  ORDER_PAYMENT_REMINDER_TEMPLATE,
  paymentReminderDedupeKey,
} from './pending-payment-expiry.cron';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { OrderStatusService } from './order-status.service';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { holdsLease } from '../../common/cron-leader/run-exclusive.fixtures';

jest.mock('../../common/cron-leader/run-exclusive');

const NOW = new Date('2026-10-10T05:00:00.000Z');
const HOUR = 3_600_000;

type StaleRow = { id: string; code: string; type?: string; paymentMethod?: string; _count?: { paymentAttempts: number } };

function make(opts: { ttl?: unknown; locked?: boolean; orders?: StaleRow[] } = {}) {
  (runExclusive as jest.Mock).mockImplementation(holdsLease(opts.locked ?? true));
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
  };
  const systemConfig = {
    get: jest.fn(async (_key: string, fallback: unknown) => ('ttl' in opts ? opts.ttl : fallback)),
  };
  const orderStatus = {
    setStatus: jest.fn(async (id: string) => ({ id, status: 'CANCELLED' })),
  };
  const cron = new PendingPaymentExpiryCron(
    prisma as unknown as PrismaService,
    systemConfig as unknown as SystemConfigService,
    orderStatus as unknown as OrderStatusService,
  );
  return { cron, prisma, systemConfig, orderStatus };
}

describe('PendingPaymentExpiryCron (C-024)', () => {
  it('@Cron chạy theo giờ Việt Nam', () => {
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, PendingPaymentExpiryCron.prototype.handleCron);
    expect(meta).toMatchObject({ timeZone: 'Asia/Ho_Chi_Minh' });
  });

  it('quét đơn lẻ/CTV trả trước còn UNPAID ở PENDING_PAYMENT quá TTL (mặc định 24 giờ)', async () => {
    const { cron, prisma, systemConfig } = make();
    await cron.expireStale(NOW);
    expect(systemConfig.get).toHaveBeenCalledWith(PENDING_PAYMENT_TTL_KEY, DEFAULT_PENDING_PAYMENT_TTL_HOURS);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
    expect(where.OR).toContainEqual({ type: 'RETAIL', createdAt: { lt: new Date(NOW.getTime() - 24 * HOUR) } });
    expect(where.paymentMethod.in).toEqual(expect.arrayContaining(['BANK_TRANSFER', 'ZALOPAY', 'VNPAY']));
    expect(where.paymentMethod.in).not.toContain('COD');
  });

  // SELLER-7: đơn đại lý "Trả trước" không ai trả từng giữ tồn kho mãi mãi. Đơn "Ghi công nợ" CONFIRMED ngay nên không lọt vào.
  it('SELLER-7: đơn đại lý trả trước cũng tự huỷ, theo hạn riêng (mặc định 72 giờ)', async () => {
    const { cron, prisma, systemConfig, orderStatus } = make({
      orders: [{ id: 'd1', code: 'DL1', paymentMethod: 'BANK_TRANSFER', type: 'DEALER' }],
    });
    await cron.expireStale(NOW);
    expect(systemConfig.get).toHaveBeenCalledWith(DEALER_PENDING_PAYMENT_TTL_KEY, DEFAULT_DEALER_PENDING_PAYMENT_TTL_HOURS);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PENDING_PAYMENT');
    expect(where.OR).toContainEqual({ type: 'DEALER', createdAt: { lt: new Date(NOW.getTime() - 72 * HOUR) } });
    expect(orderStatus.setStatus).toHaveBeenCalledWith(
      'd1',
      'CANCELLED',
      expect.objectContaining({ onlyIfUnpaid: true, expectedStatus: 'PENDING_PAYMENT', note: expect.stringContaining('72 giờ') }),
    );
  });

  // Không có API tra trạng thái ZaloPay: callback mất mà khách đã trả thì đơn vẫn bị huỷ — để lại dấu trong
  // ghi chú/lịch sử đơn + log cảnh báo để vận hành đối chiếu cổng thanh toán và hoàn tiền tay nếu cần.
  it('đơn qua cổng thanh toán (ZALOPAY/VNPAY) đã mở lệnh → ghi chú huỷ nhắc đối chiếu cổng + log cảnh báo', async () => {
    const { cron, orderStatus } = make({
      orders: [
        { id: 'z1', code: 'Z1', paymentMethod: 'ZALOPAY', _count: { paymentAttempts: 1 } },
        { id: 'z2', code: 'Z2', paymentMethod: 'ZALOPAY', _count: { paymentAttempts: 0 } },
        { id: 'b1', code: 'B1', paymentMethod: 'BANK_TRANSFER', _count: { paymentAttempts: 0 } },
      ],
    });
    const warn = jest.spyOn((cron as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    await cron.expireStale(NOW);
    const noteOf = (id: string) =>
      (orderStatus.setStatus.mock.calls.find((c) => c[0] === id) as unknown as [string, string, { note: string }])[2].note;
    expect(noteOf('z1')).toContain('đối chiếu ZALOPAY');
    expect(noteOf('z2')).not.toContain('đối chiếu');
    expect(noteOf('b1')).not.toContain('đối chiếu');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Z1'));
  });

  it('huỷ từng đơn qua đường huỷ chuẩn setStatus(CANCELLED) với guard onlyIfUnpaid, actor SYSTEM', async () => {
    const { cron, orderStatus } = make({ ttl: 6, orders: [{ id: 'o1', code: 'A' }, { id: 'o2', code: 'B' }] });
    const res = await cron.expireStale(NOW);
    expect(orderStatus.setStatus).toHaveBeenCalledTimes(2);
    expect(orderStatus.setStatus).toHaveBeenCalledWith(
      'o1',
      'CANCELLED',
      expect.objectContaining({
        actorType: 'SYSTEM',
        onlyIfUnpaid: true,
        expectedStatus: 'PENDING_PAYMENT',
        note: expect.stringContaining('6 giờ'),
      }),
    );
    expect(res).toMatchObject({ scanned: 2, cancelled: 2, failed: 0 });
  });

  it('bỏ qua đơn hệ thống đã thôi tự huỷ vì đã bàn giao vận chuyển — không thử huỷ lại mỗi 10 phút (R4-SYNC-5)', async () => {
    const { cron, prisma } = make();
    await cron.expireStale(NOW);
    expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({ autoCancelBlockedAt: null });
  });

  it('đơn có cờ "Pancake báo đã thanh toán, chờ đối chiếu" chỉ được hoãn tự huỷ 48 giờ kể từ khoản đầu tiên (paymentUnlinkedFirstAt); quá hạn thì cron huỷ như thường', async () => {
    const { cron, prisma } = make();
    await cron.expireStale(NOW);
    const hold = new Date(NOW.getTime() - PAYMENT_UNLINKED_HOLD_HOURS * HOUR);
    expect(PAYMENT_UNLINKED_HOLD_HOURS).toBe(48);
    expect(prisma.order.findMany.mock.calls[0][0].where.AND).toEqual([
      {
        OR: [
          { paymentUnlinkedAt: null },
          { paymentUnlinkedFirstAt: { lt: hold } },
          { paymentUnlinkedFirstAt: null, paymentUnlinkedAt: { lt: hold } },
        ],
      },
    ]);
  });

  it('đơn chuyển khoản chờ tiền có thể đã lên Pancake → huỷ qua cổng Pancake (D1, PANCAKE-2)', async () => {
    const { cron, orderStatus } = make({ ttl: 6, orders: [{ id: 'o1', code: 'A' }] });
    await cron.expireStale(NOW);
    expect(orderStatus.setStatus).toHaveBeenCalledWith('o1', 'CANCELLED', expect.objectContaining({ pancakeGate: true }));
  });

  it('đơn được trả tiền chen giữa (setStatus trả về đơn không bị huỷ) → không đếm là đã huỷ', async () => {
    const { cron, orderStatus } = make({ orders: [{ id: 'o1', code: 'A' }] });
    orderStatus.setStatus.mockResolvedValueOnce({ id: 'o1', status: 'CONFIRMED' });
    const res = await cron.expireStale(NOW);
    expect(res).toMatchObject({ scanned: 1, cancelled: 0, failed: 0 });
  });

  it('một đơn lỗi không chặn các đơn còn lại', async () => {
    const { cron, orderStatus } = make({ orders: [{ id: 'o1', code: 'A' }, { id: 'o2', code: 'B' }] });
    orderStatus.setStatus.mockRejectedValueOnce(new Error('db blip'));
    const res = await cron.expireStale(NOW);
    expect(orderStatus.setStatus).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ cancelled: 1, failed: 1 });
  });

  it.each([
    [0, 1],
    [-5, 1],
    ['abc', DEFAULT_PENDING_PAYMENT_TTL_HOURS],
    [null, DEFAULT_PENDING_PAYMENT_TTL_HOURS],
    [100_000, 24 * 30],
  ])('TTL cấu hình %p → dùng %p giờ (không để cấu hình sai huỷ hàng loạt đơn đang chờ chuyển khoản)', async (ttl, hours) => {
    const { cron, prisma } = make({ ttl });
    await cron.expireStale(NOW);
    expect(prisma.order.findMany.mock.calls[0][0].where.OR).toContainEqual({
      type: 'RETAIL',
      createdAt: { lt: new Date(NOW.getTime() - (hours as number) * HOUR) },
    });
  });

  it('instance khác đang giữ khoá lượt chạy → bỏ lượt, không quét', async () => {
    const { cron, prisma, orderStatus } = make({ locked: false, orders: [{ id: 'o1', code: 'A' }] });
    const res = await cron.expireStale(NOW);
    expect(res).toEqual({ skipped: 'LOCKED' });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(orderStatus.setStatus).not.toHaveBeenCalled();
  });

  it('lượt trước chưa xong trong cùng instance → lượt sau bỏ qua', async () => {
    const { cron, orderStatus } = make({ orders: [{ id: 'o1', code: 'A' }] });
    let finish!: () => void;
    orderStatus.setStatus.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r({ id: 'o1', status: 'CANCELLED' }))) as never,
    );
    const first = cron.expireStale(NOW);
    await new Promise((r) => setImmediate(r));
    await expect(cron.expireStale(NOW)).resolves.toEqual({ skipped: 'RUNNING' });
    finish();
    await expect(first).resolves.toMatchObject({ cancelled: 1 });
    // Sau khi lượt đầu xong, lượt mới chạy bình thường.
    await expect(cron.expireStale(NOW)).resolves.toMatchObject({ scanned: 1 });
  });

  it('handleCron nuốt lỗi (cron không được làm sập process)', async () => {
    const { cron } = make();
    (runExclusive as jest.Mock).mockRejectedValueOnce(new Error('pool exhausted'));
    await expect(cron.handleCron()).resolves.toBeUndefined();
  });
});

describe('PendingPaymentExpiryCron: nhắc chuyển khoản ~2 giờ trước hạn tự huỷ', () => {
  function makeWithNotify(opts: { due?: unknown[]; template?: boolean; ttl?: number; remindedKeys?: string[] } = {}) {
    (runExclusive as jest.Mock).mockImplementation(holdsLease(true));
    const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(opts.due ?? []);
    const prisma = {
      order: { findMany },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(opts.template === false ? null : { id: 'tpl' }) },
      notificationLog: { findMany: jest.fn().mockResolvedValue((opts.remindedKeys ?? []).map((dedupeKey) => ({ payload: { dedupeKey } }))) },
    };
    const systemConfig = { get: jest.fn(async (_k: string, fallback: unknown) => opts.ttl ?? fallback) };
    const orderStatus = { setStatus: jest.fn() };
    const notifications = { notifySafe: jest.fn().mockResolvedValue(true) };
    const cron = new PendingPaymentExpiryCron(
      prisma as unknown as PrismaService,
      systemConfig as unknown as SystemConfigService,
      orderStatus as unknown as OrderStatusService,
      notifications as unknown as NotificationsService,
    );
    return { cron, prisma, notifications, orderStatus };
  }

  it('chỉ đơn lẻ chuyển khoản còn UNPAID, chưa có dấu đã trả, tạo trong khoảng (hạn huỷ, hạn huỷ + 2 giờ]; khoá chống trùng pay_remind:<mã>', async () => {
    const createdAt = new Date(NOW.getTime() - 24 * HOUR + 90 * 60_000);
    const { cron, prisma, notifications } = makeWithNotify({ due: [{ userId: 'u1', code: 'TB123', total: 259000, createdAt }] });
    const res = await cron.expireStale(NOW);
    expect(res).toMatchObject({ reminded: 1 });
    const where = prisma.order.findMany.mock.calls[1][0].where;
    expect(where).toMatchObject({
      type: 'RETAIL',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'UNPAID',
      paymentMethod: 'BANK_TRANSFER',
      autoCancelBlockedAt: null,
      paymentUnlinkedAt: null,
      guestTokenHash: null,
      createdAt: { gt: new Date(NOW.getTime() - 24 * HOUR), lte: new Date(NOW.getTime() - 22 * HOUR) },
    });
    expect(where.OR).toEqual([{ pancakePaidReported: null }, { pancakePaidReported: 0 }]);
    expect(notifications.notifySafe).toHaveBeenCalledWith(
      'u1',
      ORDER_PAYMENT_REMINDER_TEMPLATE,
      { order_code: 'TB123', amount: `${(259000).toLocaleString('vi-VN')}đ`, deadline: '13:30 10/10/2026' },
      { dedupeKey: 'pay_remind:TB123' },
      'order=TB123',
    );
    expect(paymentReminderDedupeKey('TB123')).toBe('pay_remind:TB123');
    expect(prisma.order.findMany.mock.calls[1][0].take).toBe(1000);
  });

  it('bỏ đơn mà MSS đang giữ (PENDING/SENDING/DELIVERED) hoặc đã gửi order.created như bạn bè (RESULT_SENT, không lý do); tin người lạ, RESULT_FAILED hay chưa có sự kiện vẫn nhắc', async () => {
    const { cron, prisma } = makeWithNotify();
    await cron.expireStale(NOW);
    const where = prisma.order.findMany.mock.calls[1][0].where;
    expect(where.mssOrderEvents).toEqual({
      none: {
        eventType: 'order.created',
        recipientRole: 'buyer',
        OR: [{ status: { in: ['PENDING', 'SENDING', 'DELIVERED'] } }, { status: 'RESULT_SENT', resultReason: null }],
      },
    });
  });

  it('đơn đã có tin nhắc từ lượt trước: không gửi lại, không đếm; đơn mới trong cửa sổ vẫn được nhắc', async () => {
    const createdAt = new Date(NOW.getTime() - 23 * HOUR);
    const { cron, prisma, notifications } = makeWithNotify({
      due: [{ userId: 'u1', code: 'OLD', total: 1, createdAt }, { userId: 'u2', code: 'NEW', total: 1, createdAt }],
      remindedKeys: ['pay_remind:OLD', 'pay_remind:OTHER'],
    });
    await expect(cron.expireStale(NOW)).resolves.toMatchObject({ reminded: 1 });
    expect(notifications.notifySafe).toHaveBeenCalledTimes(1);
    expect(notifications.notifySafe.mock.calls[0][1]).toBe(ORDER_PAYMENT_REMINDER_TEMPLATE);
    expect(notifications.notifySafe.mock.calls[0][3]).toEqual({ dedupeKey: 'pay_remind:NEW' });
    expect(prisma.notificationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { templateCode: ORDER_PAYMENT_REMINDER_TEMPLATE, userId: { in: ['u1', 'u2'] } },
      }),
    );
  });

  it('hạn huỷ ngắn (2 giờ): chỉ nhắc đơn đã tạo ít nhất 1 giờ, không nhắc ngay khi vừa đặt', async () => {
    const { cron, prisma } = makeWithNotify({ ttl: 2 });
    await cron.expireStale(NOW);
    const where = prisma.order.findMany.mock.calls[1][0].where;
    expect(where.createdAt).toEqual({ gt: new Date(NOW.getTime() - 2 * HOUR), lte: new Date(NOW.getTime() - HOUR) });
  });

  it('chưa seed mẫu ORDER_PAYMENT_REMINDER: bỏ lượt nhắc, không gọi notify, việc huỷ vẫn chạy', async () => {
    const { cron, notifications } = makeWithNotify({ template: false, due: [{ userId: 'u1', code: 'A', total: 1, createdAt: NOW }] });
    await expect(cron.expireStale(NOW)).resolves.toMatchObject({ reminded: 0, scanned: 0 });
    expect(notifications.notifySafe).not.toHaveBeenCalled();
  });

  it('gửi lỗi (notifySafe trả false) không đếm; lỗi truy vấn nhắc không làm hỏng lượt huỷ', async () => {
    const a = makeWithNotify({ due: [{ userId: 'u1', code: 'A', total: 1, createdAt: NOW }, { userId: 'u2', code: 'B', total: 1, createdAt: NOW }] });
    a.notifications.notifySafe.mockResolvedValueOnce(false);
    await expect(a.cron.expireStale(NOW)).resolves.toMatchObject({ reminded: 1 });

    const b = makeWithNotify();
    b.prisma.order.findMany.mockReset().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('db down'));
    jest.spyOn((b.cron as unknown as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation();
    await expect(b.cron.expireStale(NOW)).resolves.toMatchObject({ scanned: 0, reminded: 0 });
  });

  it('không có NotificationsService (dựng 3 tham số): không truy vấn nhắc', async () => {
    const { cron, prisma } = make();
    await cron.expireStale(NOW);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });
});
