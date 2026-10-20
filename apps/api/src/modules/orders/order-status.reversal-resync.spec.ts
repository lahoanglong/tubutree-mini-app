import { OrderStatusService } from './order-status.service';
import type { OrderReversalService } from './order-reversal.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';

/**
 * Q19: tiến trình chết giữa commit CANCELLED/RETURNED và các việc sau (đảo điểm tích, thu hồi hoa hồng, lệnh huỷ Pancake, tin báo)
 * thì không ai gọi lại setStatus. resyncReversalEffects (cron gọi) làm nốt, mỗi việc idempotent, và chỉ ghi mốc khi xong hết.
 */
const CLOSED_AT = new Date('2026-10-20T01:00:00.000Z');

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    status: 'CANCELLED',
    reversalEffectsAt: null,
    hasRecyclingPickup: false,
    placedForCustomer: false,
    pancakeCancelStatus: null,
    fulfiller: 'TUBU',
    fulfillerStorefront: null,
    ...overrides,
  };
}

function build(order: Record<string, unknown> | null, over: { actor?: string; noticeSent?: boolean; loyalty?: Record<string, jest.Mock>; affiliate?: Record<string, jest.Mock> } = {}) {
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderStatusHistory: { findFirst: jest.fn().mockResolvedValue({ actorType: over.actor ?? 'ADMIN', createdAt: CLOSED_AT }) },
    notificationLog: { findFirst: jest.fn().mockResolvedValue(over.noticeSent ? { id: 'n1' } : null) },
    gomdonAlert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const hooks = { afterLocalCancel: jest.fn().mockResolvedValue(undefined) };
  const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(0), ...over.loyalty };
  const affiliate = { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined), ...over.affiliate };
  const svc = new OrderStatusService(
    prisma as unknown as PrismaService,
    loyalty as unknown as LoyaltyService,
    affiliate as unknown as AffiliateService,
    notifications as unknown as NotificationsService,
    {} as unknown as OrderReversalService,
    undefined,
    undefined,
    hooks as never,
  );
  const markerWrites = () =>
    prisma.order.updateMany.mock.calls.filter(([a]) => 'reversalEffectsAt' in ((a as { data: Record<string, unknown> }).data ?? {}));
  return { svc, prisma, notifications, hooks, loyalty, affiliate, markerWrites };
}

describe('OrderStatusService.resyncReversalEffects (Q19)', () => {
  const dbDown = () => new Error('P2024: hết kết nối trong pool');

  it('đơn không tồn tại: ném NotFound; đơn chưa đóng: NOT_CLOSED; đã có mốc: ALREADY_DONE — không đụng gì', async () => {
    await expect(build(null).svc.resyncReversalEffects('x')).rejects.toThrow('Không tìm thấy');

    const open = build(makeOrder({ status: 'CONFIRMED' }));
    await expect(open.svc.resyncReversalEffects('o1')).resolves.toEqual({ outcome: 'NOT_CLOSED' });
    const done = build(makeOrder({ reversalEffectsAt: new Date() }));
    await expect(done.svc.resyncReversalEffects('o1')).resolves.toEqual({ outcome: 'ALREADY_DONE' });
    for (const b of [open, done]) {
      expect(b.loyalty.reverseOrderPoints).not.toHaveBeenCalled();
      expect(b.affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
      expect(b.markerWrites()).toHaveLength(0);
    }
  });

  it('huỷ chưa xong việc sau commit: đảo điểm, thu hồi hoa hồng, xếp lệnh huỷ Pancake không quyết định, báo khách một lần, ghi mốc', async () => {
    const { svc, loyalty, affiliate, hooks, notifications, markerWrites } = build(makeOrder());

    await expect(svc.resyncReversalEffects('o1')).resolves.toEqual({ outcome: 'DONE' });

    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
    expect(hooks.afterLocalCancel).toHaveBeenCalledWith('o1', undefined);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CANCELLED', expect.objectContaining({ order_code: 'TUBU1' }));
    expect(markerWrites()).toEqual([[{ where: { id: 'o1', reversalEffectsAt: null }, data: { reversalEffectsAt: expect.any(Date) } }]]);
  });

  it('điểm thường hoàn lại ở bước này được nói trong tin báo khách', async () => {
    const { svc, notifications } = build(makeOrder(), { loyalty: { reverseOrderPoints: jest.fn().mockResolvedValue(20_000) } });

    await svc.resyncReversalEffects('o1');

    expect((notifications.notify.mock.calls[0]![2] as Record<string, string>).refund_note).toContain('20.000');
  });

  it('đảo điểm hoặc hoa hồng lỗi: INCOMPLETE, KHÔNG ghi mốc, KHÔNG báo khách (lần sau làm nốt rồi mới báo); việc còn lại vẫn chạy', async () => {
    const a = build(makeOrder(), { loyalty: { reverseOrderPoints: jest.fn().mockRejectedValue(dbDown()) } });
    await expect(a.svc.resyncReversalEffects('o1')).resolves.toMatchObject({ outcome: 'INCOMPLETE', error: expect.stringContaining('P2024') });
    expect(a.affiliate.reverseCommissionsForOrder).toHaveBeenCalledTimes(1);
    expect(a.hooks.afterLocalCancel).toHaveBeenCalledTimes(1);
    expect(a.notifications.notify).not.toHaveBeenCalled();
    expect(a.markerWrites()).toHaveLength(0);

    const b = build(makeOrder(), { affiliate: { reverseCommissionsForOrder: jest.fn().mockRejectedValue(dbDown()) } });
    await expect(b.svc.resyncReversalEffects('o1')).resolves.toMatchObject({ outcome: 'INCOMPLETE' });
    expect(b.loyalty.reverseOrderPoints).toHaveBeenCalledTimes(1);
    expect(b.notifications.notify).not.toHaveBeenCalled();
    expect(b.markerWrites()).toHaveLength(0);
  });

  it('tin báo đã đi sau lúc đóng đơn (log có tin của đơn): không gửi lại, vẫn ghi mốc', async () => {
    const { svc, notifications, prisma, markerWrites } = build(makeOrder(), { noticeSent: true });

    await expect(svc.resyncReversalEffects('o1')).resolves.toEqual({ outcome: 'DONE' });

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.notificationLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', sentAt: { gte: CLOSED_AT }, payload: { path: ['data', 'order_code'], equals: 'TUBU1' } }),
      }),
    );
    expect(markerWrites()).toHaveLength(1);
  });

  it('Pancake tự báo huỷ (actor PANCAKE) hoặc đã có kết quả huỷ Pancake: không xếp lệnh huỷ lần nữa', async () => {
    const byPancake = build(makeOrder(), { actor: 'PANCAKE' });
    await byPancake.svc.resyncReversalEffects('o1');
    expect(byPancake.hooks.afterLocalCancel).not.toHaveBeenCalled();

    const settled = build(makeOrder({ pancakeCancelStatus: 'CANCELLED' }));
    await settled.svc.resyncReversalEffects('o1');
    expect(settled.hooks.afterLocalCancel).not.toHaveBeenCalled();
  });

  it('RETURNED: đảo điểm + hoa hồng + báo khách ORDER_RETURNED, không đụng lệnh huỷ Pancake', async () => {
    const { svc, hooks, loyalty, affiliate, notifications } = build(makeOrder({ status: 'RETURNED' }));

    await expect(svc.resyncReversalEffects('o1')).resolves.toEqual({ outcome: 'DONE' });

    expect(loyalty.reverseOrderPoints).toHaveBeenCalledTimes(1);
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledTimes(1);
    expect(hooks.afterLocalCancel).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_RETURNED', expect.any(Object));
  });

  it('đơn gian hàng tự giao bị admin huỷ: báo chủ gian hàng (không báo khi chính gian hàng huỷ)', async () => {
    const merchantOrder = { fulfiller: 'MERCHANT', fulfillerStorefront: { ownerUserId: 'owner1' } };
    const byAdmin = build(makeOrder(merchantOrder), { actor: 'ADMIN' });
    byAdmin.prisma.order.findUnique.mockResolvedValue(merchantOrder);
    await byAdmin.svc.resyncReversalEffects('o1');
    expect(byAdmin.notifications.notify).toHaveBeenCalledWith('owner1', 'MERCHANT_ORDER_CANCELLED', expect.objectContaining({ order_code: 'TUBU1' }));

    const bySeller = build(makeOrder(merchantOrder), { actor: 'MERCHANT' });
    bySeller.prisma.order.findUnique.mockResolvedValue(merchantOrder);
    await bySeller.svc.resyncReversalEffects('o1');
    expect(bySeller.notifications.notify).not.toHaveBeenCalledWith('owner1', 'MERCHANT_ORDER_CANCELLED', expect.anything());
  });
});
