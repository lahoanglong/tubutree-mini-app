import { RemarketingService } from './remarketing.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(key: string, fallback?: T): Promise<T> =>
      (key in values ? values[key] : fallback) as T,
  } as unknown as SystemConfigService;
}

// ============================================================
// Feature A: Cart-abandonment reminder
// ============================================================

function cartRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cart1',
    userId: 'u1',
    updatedAt: new Date('2026-07-04T12:00:00Z'), // 12h trước NOW giả lập
    abandonRemindedAt: null,
    items: [
      { quantity: 2, variation: { product: { name: 'Dầu gội Visante 500ml' } } },
      { quantity: 1, variation: { product: { name: 'Sữa tắm Fuwa3e' } } },
    ],
    ...over,
  };
}

function setupCart(rows: unknown[], claimedCount = 1) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const updateMany = jest.fn().mockResolvedValue({ count: claimedCount });
  const prisma = { cart: { findMany, updateMany } } as unknown as PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  const config = makeConfig();
  const svc = new RemarketingService(prisma, config, notifications);
  return { svc, findMany, updateMany, notify };
}

describe('RemarketingService.sendCartAbandonReminders', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('giỏ trong khung giờ (min..max), chưa từng nhắc → notify + claim atomic', async () => {
    const { svc, notify, updateMany } = setupCart([cartRow()]);
    await svc.sendCartAbandonReminders();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data.abandonRemindedAt).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledWith('u1', 'CART_ABANDONED', {
      item_count: '3',
      product: 'Dầu gội Visante 500ml',
    });
  });

  it('đã nhắc CHO LẦN bỏ quên này (abandonRemindedAt >= updatedAt) → KHÔNG nhắc lại', async () => {
    const { svc, notify, updateMany } = setupCart([
      cartRow({
        updatedAt: new Date('2026-07-04T12:00:00Z'),
        abandonRemindedAt: new Date('2026-07-04T13:00:00Z'), // đã nhắc SAU lần cập nhật giỏ
      }),
    ]);
    await svc.sendCartAbandonReminders();

    expect(notify).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('giỏ CŨ hơn được cập nhật lại (abandonRemindedAt < updatedAt mới) → nhắc lại', async () => {
    const { svc, notify } = setupCart([
      cartRow({
        updatedAt: new Date('2026-07-04T18:00:00Z'), // cập nhật MỚI hơn lần nhắc trước
        abandonRemindedAt: new Date('2026-07-01T00:00:00Z'),
      }),
    ]);
    await svc.sendCartAbandonReminders();

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('giỏ rỗng (không món nào) → không nhắc', async () => {
    const { svc, notify, updateMany } = setupCart([cartRow({ items: [] })]);
    await svc.sendCartAbandonReminders();

    expect(notify).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('claim atomic thất bại (count 0, cron khác đã nhắc trước) → bỏ qua, không notify', async () => {
    const { svc, notify, updateMany } = setupCart([cartRow()], 0);
    await svc.sendCartAbandonReminders();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('không có giỏ nào tới hạn → không làm gì', async () => {
    const { svc, notify, updateMany } = setupCart([]);
    await svc.sendCartAbandonReminders();

    expect(notify).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('dùng ngưỡng min/max giờ từ SystemConfig để tính khung updatedAt truy vấn', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { cart: { findMany, updateMany: jest.fn() } } as unknown as PrismaService;
    const notifications = { notify: jest.fn() } as unknown as NotificationsService;
    const config = makeConfig({
      'remarketing.cart_abandon_min_hours': 6,
      'remarketing.cart_abandon_max_hours': 72,
    });
    const svc = new RemarketingService(prisma, config, notifications);

    await svc.sendCartAbandonReminders();

    const where = findMany.mock.calls[0][0].where;
    expect(where.updatedAt.lte).toEqual(new Date('2026-07-04T18:00:00Z')); // now - 6h
    expect(where.updatedAt.gte).toEqual(new Date('2026-07-02T00:00:00Z')); // now - 72h
  });
});

// ============================================================
// Feature B: Voucher-expiry reminder (coupon cá nhân scope USER_GROUP)
// ============================================================

function couponRow(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    code: 'WELCOME-U1',
    scope: 'USER_GROUP',
    scopeMeta: { userId: 'u1', reason: 'WELCOME' },
    usedCount: 0,
    endAt: new Date('2026-07-07T00:00:00Z'),
    remindedAt: null,
    ...over,
  };
}

function setupVoucher(rows: unknown[], claimedCount = 1) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const updateMany = jest.fn().mockResolvedValue({ count: claimedCount });
  const prisma = { coupon: { findMany, updateMany } } as unknown as PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  const config = makeConfig();
  const svc = new RemarketingService(prisma, config, notifications);
  return { svc, findMany, updateMany, notify };
}

describe('RemarketingService.sendVoucherExpiryReminders', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('voucher cá nhân sắp hết hạn, chưa dùng, chưa nhắc → notify + claim atomic', async () => {
    const { svc, notify, updateMany } = setupVoucher([couponRow()]);
    await svc.sendVoucherExpiryReminders();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data.remindedAt).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledWith('u1', 'VOUCHER_EXPIRING', {
      code: 'WELCOME-U1',
      expires: expect.any(String),
    });
  });

  it('coupon không có scopeMeta.userId (dữ liệu bất thường) → bỏ qua, không notify', async () => {
    const { svc, notify, updateMany } = setupVoucher([couponRow({ scopeMeta: {} })]);
    await svc.sendVoucherExpiryReminders();

    expect(notify).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('claim atomic thất bại (count 0) → bỏ qua, không notify', async () => {
    const { svc, notify, updateMany } = setupVoucher([couponRow()], 0);
    await svc.sendVoucherExpiryReminders();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('không có voucher nào sắp hết hạn → không làm gì', async () => {
    const { svc, notify, updateMany } = setupVoucher([]);
    await svc.sendVoucherExpiryReminders();

    expect(notify).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('truy vấn coupon scope USER_GROUP, chưa dùng, chưa nhắc, endAt trong N ngày (config)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { coupon: { findMany, updateMany: jest.fn() } } as unknown as PrismaService;
    const notifications = { notify: jest.fn() } as unknown as NotificationsService;
    const config = makeConfig({ 'remarketing.voucher_expiry_days': 3 });
    const svc = new RemarketingService(prisma, config, notifications);

    await svc.sendVoucherExpiryReminders();

    const where = findMany.mock.calls[0][0].where;
    expect(where.scope).toBe('USER_GROUP');
    expect(where.usedCount).toBe(0);
    expect(where.remindedAt).toBeNull();
    expect(where.endAt.gte).toEqual(new Date('2026-07-05T00:00:00Z'));
    expect(where.endAt.lte).toEqual(new Date('2026-07-08T00:00:00Z')); // now + 3 ngày
  });
});
