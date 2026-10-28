import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AffiliateService } from './affiliate.service';
import { CTV_NOTIFICATION } from './ctv-notification-codes';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { RewardPointsService } from '../wallet/reward-points.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { NotificationsService } from '../notifications/notifications.service';

const noop = {} as never;

// Cờ tự chuyển vào Ví tắt: các ca dưới đây kiểm đường thông báo "đã duyệt" như trước khi có tự chuyển (ca tự chuyển ở affiliate-auto-wallet.spec.ts).
const configAutoOff = {
  get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.auto_wallet_transfer_enabled' ? false : fb) as T,
} as unknown as SystemConfigService;

function build(prismaParts: Record<string, unknown>, withNotifications = true) {
  const notify = jest.fn().mockResolvedValue(undefined);
  const svc = new AffiliateService(
    prismaParts as unknown as PrismaService,
    configAutoOff,
    noop as PricingService,
    noop as PancakeOrderService,
    noop as RewardPointsService,
    noop as AnalyticsEventsService,
    withNotifications ? ({ notify } as unknown as NotificationsService) : undefined,
  );
  return { svc, notify };
}

describe('AffiliateService.notifyCommissionCreated (C-029: hoa hồng mới)', () => {
  const commissionRow = (over: Record<string, unknown> = {}) => ({
    affiliateUserId: 'ctv1', amount: 25_000, order: { placedForCustomer: false }, ...over,
  });

  it('đơn của khách mua qua link CTV → báo CTV số hoa hồng dự kiến, KHÔNG kèm mã đơn của khách', async () => {
    const findFirst = jest.fn().mockResolvedValue(commissionRow());
    const { svc, notify } = build({ commission: { findFirst } });
    await svc.notifyCommissionCreated('o1');
    expect(findFirst.mock.calls[0][0].where).toEqual({ orderId: 'o1' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('ctv1', CTV_NOTIFICATION.NEW, { amount: '25.000đ' });
    // order_code làm app hiện nút "Xem đơn" dẫn tới đơn của KHÁCH (CTV không xem được → 404).
    expect(Object.keys(notify.mock.calls[0][2])).not.toContain('order_code');
  });

  it('đơn CTV tự lên hộ (placedForCustomer) → không báo, CTV vừa tự tạo đơn đó', async () => {
    const findFirst = jest.fn().mockResolvedValue(commissionRow({ order: { placedForCustomer: true } }));
    const { svc, notify } = build({ commission: { findFirst } });
    await svc.notifyCommissionCreated('o1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('đơn không sinh hoa hồng (rate 0, hàng bị chặn affiliate) → không báo', async () => {
    const { svc, notify } = build({ commission: { findFirst: jest.fn().mockResolvedValue(null) } });
    await svc.notifyCommissionCreated('o1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('không bao giờ ném lỗi: gửi thông báo hỏng hoặc truy vấn hỏng đều không phá luồng đặt hàng', async () => {
    const a = build({ commission: { findFirst: jest.fn().mockResolvedValue(commissionRow()) } });
    a.notify.mockRejectedValue(new Error('zns down'));
    await expect(a.svc.notifyCommissionCreated('o1')).resolves.toBeUndefined();
    const b = build({ commission: { findFirst: jest.fn().mockRejectedValue(new Error('db')) } });
    await expect(b.svc.notifyCommissionCreated('o1')).resolves.toBeUndefined();
  });

  it('thiếu NotificationsService (test/DI tối giản) → bỏ qua, không đụng DB', async () => {
    const findFirst = jest.fn();
    const { svc } = build({ commission: { findFirst } }, false);
    await svc.notifyCommissionCreated('o1');
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('AffiliateService.approveDueCommissions (C-029: được duyệt)', () => {
  function prismaForCron(count: number, approved: { affiliateUserId: string; amount: number }[]) {
    const updateMany = jest.fn().mockResolvedValue({ count });
    const findMany = jest.fn().mockResolvedValue(approved);
    return {
      parts: {
        returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
        commission: { updateMany, findMany },
      },
      updateMany,
      findMany,
    };
  }

  it('gộp theo CTV: mỗi người nhận đúng một thông báo (số khoản + tổng tiền) cho lượt duyệt này', async () => {
    const p = prismaForCron(3, [
      { affiliateUserId: 'a', amount: 10_000 },
      { affiliateUserId: 'a', amount: 5_000 },
      { affiliateUserId: 'b', amount: 7_000 },
    ]);
    const { svc, notify } = build(p.parts);
    await svc.approveDueCommissions();
    // Lọc đúng lượt vừa chốt: cùng approvedAt với câu UPDATE, không quét lại hoa hồng duyệt từ trước.
    const stamp = p.updateMany.mock.calls[0][0].data.approvedAt as Date;
    expect(stamp).toBeInstanceOf(Date);
    expect(p.findMany.mock.calls[0][0].where).toEqual({ status: 'APPROVED', approvedAt: stamp });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith('a', CTV_NOTIFICATION.APPROVED, { count: '2', amount: '15.000đ' });
    expect(notify).toHaveBeenCalledWith('b', CTV_NOTIFICATION.APPROVED, { count: '1', amount: '7.000đ' });
  });

  it('không có khoản nào đủ hạn → không truy vấn thêm, không báo', async () => {
    const p = prismaForCron(0, []);
    const { svc, notify } = build(p.parts);
    await svc.approveDueCommissions();
    expect(p.findMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('báo một CTV lỗi thì vẫn báo các CTV còn lại và cron không ném lỗi', async () => {
    const p = prismaForCron(2, [
      { affiliateUserId: 'a', amount: 10_000 },
      { affiliateUserId: 'b', amount: 7_000 },
    ]);
    const { svc, notify } = build(p.parts);
    notify.mockRejectedValueOnce(new Error('zns down'));
    await expect(svc.approveDueCommissions()).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('thiếu NotificationsService → chốt hoa hồng như cũ, không truy vấn thêm', async () => {
    const p = prismaForCron(2, []);
    const { svc } = build(p.parts, false);
    await svc.approveDueCommissions();
    expect(p.updateMany).toHaveBeenCalledTimes(1);
    expect(p.findMany).not.toHaveBeenCalled();
  });
});

describe('AffiliateService.markPayoutPaid (C-029: đã rút)', () => {
  const payoutRow = (over: Record<string, unknown> = {}) => ({
    id: 'p1', userId: 'ctv1', amount: 480_000, bankRef: 'FT2610', ...over,
  });
  function prismaForPayout(count: number, row = payoutRow()) {
    const p = {
      payout: {
        updateMany: jest.fn().mockResolvedValue({ count }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      },
      commission: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(),
    };
    p.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(p));
    return p;
  }

  it('SELLER-10: hoa hồng trong lệnh rút chỉ thành PAID khi admin xác nhận đã chuyển, trong cùng transaction', async () => {
    const p = prismaForPayout(1);
    const { svc } = build(p);
    await svc.markPayoutPaid('admin1', 'p1', { bankRef: 'FT2610' });
    expect(p.commission.updateMany).toHaveBeenCalledWith({
      where: { payoutBatchId: 'p1', status: 'APPROVED' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
  });

  it('SELLER-10: lệnh đã bị xử lý (count=0) → không đụng hoa hồng', async () => {
    const p = prismaForPayout(0);
    const { svc } = build(p);
    await expect(svc.markPayoutPaid('admin1', 'p1')).rejects.toThrow();
    expect(p.commission.updateMany).not.toHaveBeenCalled();
  });

  it('chuyển khoản xong → báo CTV số tiền thực nhận kèm mã giao dịch', async () => {
    const { svc, notify } = build(prismaForPayout(1));
    const res = await svc.markPayoutPaid('admin1', 'p1', { bankRef: 'FT2610' });
    expect(res.id).toBe('p1');
    expect(notify).toHaveBeenCalledWith('ctv1', CTV_NOTIFICATION.PAYOUT_PAID, {
      amount: '480.000đ',
      ref: ' (mã giao dịch FT2610)',
    });
  });

  it('không có mã giao dịch → không in dấu ngoặc rỗng', async () => {
    const { svc, notify } = build(prismaForPayout(1, payoutRow({ bankRef: null })));
    await svc.markPayoutPaid('admin1', 'p1');
    expect(notify.mock.calls[0][2]).toEqual({ amount: '480.000đ', ref: '' });
  });

  it('lệnh đã được xử lý bởi người khác (count=0) → ném lỗi cũ và KHÔNG báo', async () => {
    const { svc, notify } = build(prismaForPayout(0));
    await expect(svc.markPayoutPaid('admin1', 'p1')).rejects.toThrow('không ở trạng thái');
    expect(notify).not.toHaveBeenCalled();
  });

  it('gửi thông báo lỗi không làm hỏng việc ghi nhận đã chi', async () => {
    const { svc, notify } = build(prismaForPayout(1));
    notify.mockRejectedValue(new Error('zns down'));
    await expect(svc.markPayoutPaid('admin1', 'p1')).resolves.toMatchObject({ id: 'p1' });
  });
});

describe('mẫu thông báo CTV trong seed (C-029)', () => {
  const seed = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf8');

  it.each(Object.values(CTV_NOTIFICATION))('%s có mẫu INAPP trong seed.ts, nội dung tiếng Việt', (code) => {
    const line = seed.split('\n').find((l) => l.includes(`code: '${code}'`));
    expect(line).toBeDefined();
    expect(line).toContain("channel: 'INAPP'");
    expect(line).toMatch(/bodyTemplate: '[^']*[ăâđêôơưáàảãạ]/);
  });

  it('mẫu hoa hồng mới không dùng {{order_code}} (tránh nút xem đơn của khách)', () => {
    const line = seed.split('\n').find((l) => l.includes(`code: '${CTV_NOTIFICATION.NEW}'`))!;
    expect(line).not.toContain('order_code');
    expect(line).toContain('{{amount}}');
  });

  it('mã bắt đầu bằng COMMISSION để app gom vào nhóm "Hoa hồng CTV"', () => {
    for (const code of Object.values(CTV_NOTIFICATION)) expect(code.startsWith('COMMISSION')).toBe(true);
  });
});
