import { OrderStatusService } from './order-status.service';
import * as refundQueue from './refund-queue';
import type { OrderReversalService } from './order-reversal.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { ATTENTION_CANCEL_AFTER_HANDOVER, ATTENTION_COD_RETURN_UNVERIFIED } from '../integrations/pancake/pancake-attention';
import { PANCAKE_RETURNING_PREFIX } from '../integrations/pancake/pancake-status.map';

/**
 * D12-02: sau khi tx CANCELLED/RETURNED commit, lỗi ở đảo điểm/hoa hồng không được làm mất phần còn lại của setStatus
 * (xếp lệnh huỷ Pancake, báo merchant, báo khách), và lần gọi lại với đơn đã ở trạng thái cuối phải làm nốt phần đảo còn thiếu.
 */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    type: 'RETAIL',
    status: 'CONFIRMED',
    note: null,
    total: 100000,
    paymentMethod: 'WALLET',
    paymentStatus: 'PAID',
    pancakeOrderId: 'pk-1',
    pancakePushClaimedAt: null,
    pointsUsed: 0,
    pointsUsedConverted: 0,
    items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null }],
    ...overrides,
  };
}

function build(order: Record<string, unknown>, over: { loyalty?: Record<string, jest.Mock>; affiliate?: Record<string, jest.Mock>; hooks?: Record<string, jest.Mock>; attention?: string | null } = {}) {
  const tx = {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: order.userId }) },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    orderCustomerRefund: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUnique: jest.fn().mockResolvedValue({ pancakeAttention: over.attention ?? null, fulfiller: 'TUBU', fulfillerStorefront: null }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    gomdonAlert: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const hooks = {
    precheckCancel: jest.fn().mockResolvedValue({ kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' }),
    afterLocalCancel: jest.fn().mockResolvedValue(undefined),
    afterPaid: jest.fn().mockResolvedValue(undefined),
    ...over.hooks,
  };
  const loyalty = {
    creditOrderPoints: jest.fn().mockResolvedValue(undefined),
    reverseOrderPoints: jest.fn().mockResolvedValue(0),
    pointsExpiresAt: jest.fn().mockResolvedValue(new Date('2027-10-20T00:00:00Z')),
    ...over.loyalty,
  };
  const affiliate = {
    lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    grantReferralReward: jest.fn().mockResolvedValue(undefined),
    reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    ...over.affiliate,
  };
  const reversal = { reverseFinancials: jest.fn().mockResolvedValue({ moneyRefunded: false, pointsRefunded: 0, refund: null }) };
  const svc = new OrderStatusService(
    prisma as unknown as PrismaService,
    loyalty as unknown as LoyaltyService,
    affiliate as unknown as AffiliateService,
    notifications as unknown as NotificationsService,
    reversal as unknown as OrderReversalService,
    undefined,
    undefined,
    hooks as never,
  );
  return { svc, prisma, tx, notifications, hooks, loyalty, affiliate, reversal };
}

describe('OrderStatusService — việc sau commit của CANCELLED/RETURNED (D12-02)', () => {
  const dbDown = () => new Error('P2024: hết kết nối trong pool');

  it('reverseOrderPoints ném lỗi: hoa hồng, xếp lệnh huỷ Pancake, báo khách vẫn chạy đúng một lần, rồi ném lỗi để người gọi thử lại', async () => {
    const { svc, loyalty, affiliate, hooks, notifications } = build(makeOrder(), {
      loyalty: { reverseOrderPoints: jest.fn().mockRejectedValue(dbDown()) },
    });

    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'a1' })).rejects.toThrow('P2024');

    expect(loyalty.reverseOrderPoints).toHaveBeenCalledTimes(1);
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
    expect(hooks.afterLocalCancel).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CANCELLED', expect.objectContaining({ order_code: 'TUBU1' }));
  });

  it('quyết định DEFERRED + reverseOrderPoints ném lỗi: afterLocalCancel vẫn nhận đúng quyết định để xếp lệnh huỷ Pancake', async () => {
    const decision = { kind: 'DEFERRED', reason: 'Pancake vừa không phản hồi' };
    const { svc, hooks } = build(makeOrder(), {
      loyalty: { reverseOrderPoints: jest.fn().mockRejectedValue(dbDown()) },
      hooks: { precheckCancel: jest.fn().mockResolvedValue(decision) },
    });

    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow();

    expect(hooks.afterLocalCancel).toHaveBeenCalledWith('o1', decision);
  });

  it('reverseCommissionsForOrder ném lỗi cũng không chặn xếp lệnh huỷ Pancake và tin khách; điểm vẫn được đảo', async () => {
    const { svc, loyalty, hooks, notifications } = build(makeOrder(), {
      affiliate: { reverseCommissionsForOrder: jest.fn().mockRejectedValue(dbDown()) },
    });

    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow('P2024');

    expect(loyalty.reverseOrderPoints).toHaveBeenCalledTimes(1);
    expect(hooks.afterLocalCancel).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('thử lại sau lỗi (đơn đã CANCELLED): đảo điểm + hoa hồng chạy lại, KHÔNG xếp lệnh huỷ hay báo khách lần hai', async () => {
    const order = makeOrder();
    const reverseOrderPoints = jest.fn().mockRejectedValueOnce(dbDown()).mockResolvedValue(0);
    const built = build(order, { loyalty: { reverseOrderPoints } });

    await expect(built.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow();
    built.prisma.order.findFirst.mockResolvedValue({ ...order, status: 'CANCELLED' });

    await expect(built.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(reverseOrderPoints).toHaveBeenCalledTimes(2);
    expect(built.affiliate.reverseCommissionsForOrder).toHaveBeenCalledTimes(2);
    expect(built.hooks.afterLocalCancel).toHaveBeenCalledTimes(1);
    expect(built.notifications.notify).toHaveBeenCalledTimes(1);
    expect(built.reversal.reverseFinancials).toHaveBeenCalledTimes(1);
  });

  it('thử lại mà vẫn lỗi: ném lại cho người gọi (webhook Pancake được BullMQ thử tiếp), vẫn không báo khách lại', async () => {
    const order = makeOrder({ status: 'CANCELLED' });
    const { svc, notifications, hooks } = build(order, { loyalty: { reverseOrderPoints: jest.fn().mockRejectedValue(dbDown()) } });

    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'PANCAKE' })).rejects.toThrow('P2024');

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(hooks.afterLocalCancel).not.toHaveBeenCalled();
  });

  it('RETURNED lặp lại: cũng chạy lại đảo điểm + hoa hồng', async () => {
    const { svc, loyalty, affiliate, notifications } = build(makeOrder({ status: 'RETURNED' }));

    await svc.setStatus('o1', 'RETURNED' as never, { actorType: 'ADMIN' });

    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('đơn dùng Điểm Xanh thường: hạn điểm hoàn được đọc TRƯỚC tx và truyền cho reverseFinancials để hoàn cùng tx với lần lật', async () => {
    const expiresAt = new Date('2027-10-20T00:00:00Z');
    const order = makeOrder({ pointsUsed: 20000, pointsUsedConverted: 0 });
    const { svc, loyalty, reversal, tx, prisma } = build(order, { loyalty: { pointsExpiresAt: jest.fn().mockResolvedValue(expiresAt) } });

    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });

    expect(reversal.reverseFinancials).toHaveBeenCalledWith(tx, order, { standardPointsExpiresAt: expiresAt });
    expect(loyalty.pointsExpiresAt.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]!);
  });

  it('tin khách tính cả điểm thường hoàn trong tx (reverseFinancials.pointsRefunded) và không đếm hai lần', async () => {
    const order = makeOrder({ pointsUsed: 20000, pointsUsedConverted: 0 });
    const { svc, reversal, notifications } = build(order);
    reversal.reverseFinancials.mockResolvedValue({ moneyRefunded: true, pointsRefunded: 20000, refund: { amount: 80000, to: 'WALLET' } });

    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });

    const data = notifications.notify.mock.calls[0]![2] as Record<string, string>;
    expect(data.refund_note).toContain('20.000');
  });

  describe('P3: lý do COD chờ đối soát không bị xoá bởi việc đóng cảnh báo cũ', () => {
    const codOrder = (attention: string) =>
      makeOrder({ status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 300000, pancakeAttention: attention });
    const CANCEL_REASON = `${ATTENTION_CANCEL_AFTER_HANDOVER} (mã 6) — kiểm tra`;

    it('đơn đang có lý do "Pancake báo HUỶ…" rồi nhận "Đã hoàn": sau setStatus chỉ còn lý do COD', async () => {
      const merged = `${CANCEL_REASON} | ${ATTENTION_COD_RETURN_UNVERIFIED}`;
      const { svc, prisma } = build(codOrder(CANCEL_REASON), { attention: merged });

      await svc.setStatus('o1', 'RETURNED' as never, { actorType: 'PANCAKE', returnedToSender: true, withholdCodRefund: true });

      const writes = prisma.order.updateMany.mock.calls.map(([a]) => a as { where: Record<string, unknown>; data: Record<string, unknown> });
      expect(writes.some((w) => w.data.pancakeAttention === null)).toBe(false);
      expect(writes).toContainEqual({ where: { id: 'o1', pancakeAttention: merged }, data: { pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED } });
    });

    it('lý do "ĐANG HOÀN" cũng chỉ bị gỡ phần của nó, lý do COD ở lại', async () => {
      const merged = `${PANCAKE_RETURNING_PREFIX} — chờ hàng về | ${ATTENTION_COD_RETURN_UNVERIFIED}`;
      const { svc, prisma } = build(codOrder(`${PANCAKE_RETURNING_PREFIX} — chờ hàng về`), { attention: merged });

      await svc.setStatus('o1', 'RETURNED' as never, { actorType: 'PANCAKE', returnedToSender: true, withholdCodRefund: true });

      const writes = prisma.order.updateMany.mock.calls.map(([a]) => a as { data: Record<string, unknown> });
      expect(writes.some((w) => w.data.pancakeAttention === null)).toBe(false);
      expect(writes.some((w) => w.data.pancakeAttention === ATTENTION_COD_RETURN_UNVERIFIED)).toBe(true);
    });
  });

  describe('Q19: mốc reversalEffectsAt chỉ ghi khi mọi việc sau commit đã xong', () => {
    const markerWrites = (prisma: ReturnType<typeof build>['prisma']) =>
      prisma.order.updateMany.mock.calls.filter(([a]) => 'reversalEffectsAt' in ((a as { data: Record<string, unknown> }).data ?? {}));

    it('huỷ xong trọn vẹn: ghi mốc một lần, chỉ lên dòng còn null', async () => {
      const { svc, prisma } = build(makeOrder());

      await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });

      const writes = markerWrites(prisma);
      expect(writes).toHaveLength(1);
      expect(writes[0]![0]).toEqual({ where: { id: 'o1', reversalEffectsAt: null }, data: { reversalEffectsAt: expect.any(Date) } });
    });

    it('trả hàng xong trọn vẹn: cũng ghi mốc', async () => {
      const { svc, prisma } = build(makeOrder({ status: 'DELIVERED' }));

      await svc.setStatus('o1', 'RETURNED' as never, { actorType: 'ADMIN' });

      expect(markerWrites(prisma)).toHaveLength(1);
    });

    it('đảo điểm hoặc hoa hồng lỗi: KHÔNG ghi mốc (cron còn thấy đơn để chạy lại)', async () => {
      const a = build(makeOrder(), { loyalty: { reverseOrderPoints: jest.fn().mockRejectedValue(dbDown()) } });
      await expect(a.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow();
      expect(markerWrites(a.prisma)).toHaveLength(0);

      const b = build(makeOrder(), { affiliate: { reverseCommissionsForOrder: jest.fn().mockRejectedValue(dbDown()) } });
      await expect(b.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow();
      expect(markerWrites(b.prisma)).toHaveLength(0);
    });

    it('khoản hoàn số tiền khách chuyển thiếu lỗi (bị nuốt thành 0): KHÔNG ghi mốc, cron còn thấy đơn để ghi khoản hoàn', async () => {
      const spy = jest.spyOn(refundQueue, 'refundReportedUnderpayment').mockRejectedValue(dbDown());
      try {
        const { svc, prisma } = build(makeOrder());
        await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).resolves.toBeDefined();
        expect(markerWrites(prisma)).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('xếp lệnh huỷ Pancake thất bại trước khi đặt PENDING (afterLocalCancel trả false): KHÔNG ghi mốc', async () => {
      const { svc, prisma } = build(makeOrder(), { hooks: { afterLocalCancel: jest.fn().mockResolvedValue(false) } });
      await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).resolves.toBeDefined();
      expect(markerWrites(prisma)).toHaveLength(0);
    });

    it('afterLocalCancel trả true hoặc không trả gì (đã xếp job/không có đơn Pancake): vẫn ghi mốc', async () => {
      const { svc, prisma } = build(makeOrder(), { hooks: { afterLocalCancel: jest.fn().mockResolvedValue(true) } });
      await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });
      expect(markerWrites(prisma)).toHaveLength(1);
    });

    it('ghi mốc lỗi không làm hỏng lần huỷ đã commit', async () => {
      const built = build(makeOrder());
      built.prisma.order.updateMany.mockImplementation(async (a: { data: Record<string, unknown> }) => {
        if ('reversalEffectsAt' in a.data) throw dbDown();
        return { count: 1 };
      });

      await expect(built.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).resolves.toBeDefined();
    });
  });
});
