import { OrderStatusService } from './order-status.service';
import type { OrderReversalService } from './order-reversal.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { PancakeHandedOverError, PancakeUnreachableError } from '../integrations/pancake/pancake-sync-hooks';
import { CancelAfterHandoverError } from './order-transition';

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
    items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null }],
    ...overrides,
  };
}

function make(order: Record<string, unknown>, hooks: Record<string, jest.Mock> = {}) {
  const tx = {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: order.userId }) },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null) },
    gomdonAlert: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }]) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    /** Dấu "vận chuyển đã báo … — đẩy tay sau khi nhận tiền" (flagDroppedStatus). */
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const pancakeHooks = {
    precheckCancel: jest.fn().mockResolvedValue({ kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' }),
    afterLocalCancel: jest.fn().mockResolvedValue(undefined),
    afterPaid: jest.fn().mockResolvedValue(undefined),
    ...hooks,
  };
  const svc = new OrderStatusService(
    prisma as unknown as PrismaService,
    { creditOrderPoints: jest.fn().mockResolvedValue(undefined), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService,
    {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService,
    notifications as unknown as NotificationsService,
    { reverseFinancials: jest.fn().mockResolvedValue(undefined) } as unknown as OrderReversalService,
    undefined,
    undefined,
    pancakeHooks as never,
  );
  return { svc, prisma, tx, pancakeHooks, notifications };
}

describe('OrderStatusService — huỷ đơn đã lên Pancake (D1: PANCAKE-2, SELLER-3, ADMINOPS-2)', () => {
  it('admin huỷ → hỏi Pancake trước, rồi ghi kết quả sau khi commit', async () => {
    const { svc, tx, pancakeHooks } = make(makeOrder());
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'a1' });
    expect(pancakeHooks.precheckCancel.mock.invocationCallOrder[0]).toBeLessThan(tx.order.updateMany.mock.invocationCallOrder[0]!);
    expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' });
  });

  it('Pancake đã gửi hàng → admin được hướng dẫn chặn giao với hãng / trả hàng (không bảo "liên hệ CSKH"), không lật CANCELLED, đồng bộ lại SHIPPING', async () => {
    const { svc, tx, pancakeHooks } = make(makeOrder({ status: 'PACKED' }), {
      precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)),
    });
    const err = await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Pancake báo đã gửi hàng \(mã 2\).*chặn giao\/hoàn hàng/);
    expect((err as Error).message).toContain('trả hàng');
    expect((err as Error).message).not.toContain('liên hệ CSKH');
    expect(tx.order.updateMany.mock.calls.map((c) => c[0].data.status)).toEqual(['SHIPPING']);
    expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
  });

  it('khách tự huỷ đơn đã bàn giao → vẫn câu "liên hệ CSKH"', async () => {
    const { svc } = make(makeOrder({ status: 'PACKED' }), { precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)) });
    await expect(svc.precheckPancakeCancel(makeOrder({ status: 'PACKED' }) as never, 'CUSTOMER')).rejects.toThrow('vui lòng liên hệ CSKH');
  });

  it('cron hết hạn thanh toán (SYSTEM + pancakeGate) gặp đơn đã bàn giao → không huỷ, đưa vào "Cần xử lý Pancake"', async () => {
    const order = makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const { svc, prisma, pancakeHooks } = make(order, { precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)) });
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true })).rejects.toThrow();
    expect(pancakeHooks.precheckCancel).toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pancakeAttention: expect.stringContaining('Hệ thống không tự huỷ được đơn') }) }),
    );
  });

  describe('cron hết hạn thanh toán gặp đơn Pancake đã gửi hàng (R4-SYNC-5, R4-SYNC-3c)', () => {
    const unpaid = () => makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const handedOver = () => ({ precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)) });
    const attention = (m: jest.Mock) =>
      m.mock.calls.map((c) => c[0].data?.pancakeAttention).filter((a): a is string => typeof a === 'string');

    it('lần đầu → ghi mốc thôi tự huỷ, nhắc "Cần xử lý Pancake" kèm lối ra rõ ràng, báo admin in-app', async () => {
      const { svc, prisma, notifications } = make(unpaid(), handedOver());
      await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true })).rejects.toThrow();
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', autoCancelBlockedAt: null },
        data: { autoCancelBlockedAt: expect.any(Date) },
      });
      const [reason] = attention(prisma.order.updateMany);
      expect(reason).toContain('Hệ thống không tự huỷ được đơn');
      expect(reason).toContain('"Đã nhận tiền"');
      expect(reason).toContain('"Đã hoàn"');
      expect(notifications.notify).toHaveBeenCalledWith('admin1', 'OPS_PANCAKE_ALERT', expect.objectContaining({ order_code: 'TUBU1' }));
    });

    it('đã có mốc (lượt cron trước đã nhắc) → không nhắc lại, không báo lại dù admin đã gỡ nhắc', async () => {
      const { svc, prisma, notifications } = make(unpaid(), handedOver());
      prisma.order.updateMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ({
        count: 'autoCancelBlockedAt' in where ? 0 : 1,
      }));
      await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true })).rejects.toThrow();
      expect(attention(prisma.order.updateMany)).toEqual([]);
      expect(notifications.notify).not.toHaveBeenCalledWith(expect.anything(), 'OPS_PANCAKE_ALERT', expect.anything());
    });
  });

  describe('người bấm huỷ đơn chờ chuyển khoản mà Pancake đã gửi hàng (R5-SYNC-1)', () => {
    const unpaid = (over: Record<string, unknown> = {}) =>
      makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', ...over });
    const handedOver = () => ({ precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)) });
    const marker = { where: { id: 'o1', autoCancelBlockedAt: null }, data: { autoCancelBlockedAt: expect.any(Date) } };
    const attention = (m: jest.Mock) =>
      m.mock.calls.map((c) => c[0].data?.pancakeAttention).filter((a): a is string => typeof a === 'string');

    it('khách bấm: chưa trả tiền nên không đồng bộ được → ghi mốc bàn giao (lần sau chặn sớm, cron thôi thử), nhắc "Cần xử lý" một lần', async () => {
      const { svc, prisma, notifications } = make(unpaid(), handedOver());
      await expect(svc.precheckPancakeCancel(unpaid() as never, 'CUSTOMER')).rejects.toThrow('vui lòng liên hệ CSKH');
      expect(prisma.order.updateMany).toHaveBeenCalledWith(marker);
      const [reason] = attention(prisma.order.updateMany);
      expect(reason).toContain('Khách bấm huỷ nhưng Pancake báo đã bàn giao vận chuyển (mã 2)');
      expect(reason).toContain('"Đã nhận tiền"');
      expect(notifications.notify).toHaveBeenCalledWith('admin1', 'OPS_PANCAKE_ALERT', expect.objectContaining({ order_code: 'TUBU1' }));
    });

    it('CSKH/admin bấm: cũng ghi mốc, lời báo cho người vận hành giữ nguyên', async () => {
      const { svc, prisma } = make(unpaid(), handedOver());
      const err = await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' }).catch((e: Error) => e);
      expect((err as Error).message).toMatch(/Pancake báo đã gửi hàng \(mã 2\)/);
      expect(prisma.order.updateMany).toHaveBeenCalledWith(marker);
    });

    it('đơn đã trả tiền: đồng bộ được về SHIPPING (trạng thái tự chặn huỷ) → không ghi mốc, không nhắc', async () => {
      const { svc, prisma, notifications } = make(makeOrder({ status: 'PACKED' }), handedOver());
      await expect(svc.precheckPancakeCancel(makeOrder({ status: 'PACKED' }) as never, 'CUSTOMER')).rejects.toThrow('vui lòng liên hệ CSKH');
      expect(prisma.order.updateMany).not.toHaveBeenCalledWith(marker);
      expect(notifications.notify).not.toHaveBeenCalledWith(expect.anything(), 'OPS_PANCAKE_ALERT', expect.anything());
    });

    it('đã có mốc (lượt trước đã nhắc, admin đã "Đã xử lý") → không nhắc lại', async () => {
      const { svc, prisma, notifications } = make(unpaid(), handedOver());
      prisma.order.updateMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ({
        count: 'autoCancelBlockedAt' in where ? 0 : 1,
      }));
      await expect(svc.precheckPancakeCancel(unpaid() as never, 'CUSTOMER')).rejects.toThrow();
      expect(attention(prisma.order.updateMany)).toEqual([]);
      expect(notifications.notify).not.toHaveBeenCalledWith(expect.anything(), 'OPS_PANCAKE_ALERT', expect.anything());
    });

    it('Pancake báo lại "Đã gửi hàng" cho đơn đã có mốc thôi tự huỷ → không gắn lại dấu "đẩy tay sau khi nhận tiền" mà admin đã xử lý', async () => {
      const blocked = unpaid({ autoCancelBlockedAt: new Date('2026-10-15T02:30:00Z') });
      const { svc, prisma } = make(blocked);
      await expect(svc.setStatus('o1', 'SHIPPING' as never, { actorType: 'PANCAKE' })).rejects.toThrow();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('chưa có mốc, hoặc hãng báo trạng thái mới (DELIVERED) → vẫn gắn dấu như trước', async () => {
      const fresh = make(unpaid());
      await expect(fresh.svc.setStatus('o1', 'SHIPPING' as never, { actorType: 'PANCAKE' })).rejects.toThrow();
      expect(fresh.prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const delivered = make(unpaid({ status: 'SHIPPING', autoCancelBlockedAt: new Date() }));
      await expect(delivered.svc.setStatus('o1', 'DELIVERED' as never, { actorType: 'PANCAKE' })).rejects.toThrow();
      expect(delivered.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('afterPancakeCancel: lần huỷ sau của khách xoá dấu lệch Pancake–Tubu của lần trước', () => {
    const divergence = (c: [{ where: Record<string, unknown>; data: Record<string, unknown> }]) =>
      JSON.stringify(c[0].where).includes('Pancake đã huỷ nhưng đơn Tubu còn hiệu lực');

    it('đóng đúng dấu "Pancake đã huỷ nhưng đơn Tubu còn hiệu lực" sau khi gọi hook huỷ Pancake', async () => {
      const { svc, prisma, pancakeHooks } = make(makeOrder());
      await svc.afterPancakeCancel('o1', { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' });
      expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', expect.objectContaining({ kind: 'CONFIRMED' }));
      const clears = prisma.order.updateMany.mock.calls.filter((c) => c[0].data?.pancakeAttention === null);
      expect(clears).toHaveLength(1);
      expect(clears[0]![0].where.id).toBe('o1');
      expect(divergence(clears[0] as never)).toBe(true);
    });

    it('lỗi khi xoá dấu không làm hỏng lần huỷ đã xong', async () => {
      const { svc, prisma } = make(makeOrder());
      prisma.order.updateMany.mockRejectedValue(new Error('db down'));
      await expect(svc.afterPancakeCancel('o1')).resolves.toBeUndefined();
    });
  });

  describe('không hỏi được Pancake (R3-CANCEL-1, R2-PANCAKE-1)', () => {
    const unreachable = () => jest.fn().mockRejectedValue(new PancakeUnreachableError('timeout of 5000ms exceeded'));

    it('CSKH/admin huỷ → 409 "Kho chưa phản hồi…" kèm hướng dẫn, KHÔNG lật CANCELLED, KHÔNG hoàn tiền', async () => {
      const { svc, tx, pancakeHooks } = make(makeOrder(), { precheckCancel: unreachable() });
      const err = (await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'cskh' }).catch((e: unknown) => e)) as {
        getStatus(): number;
        getResponse(): { code: string; message: string };
      };
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse().code).toBe('PANCAKE_UNREACHABLE');
      expect(err.getResponse().message).toMatch(/^Kho chưa phản hồi, vui lòng thử lại sau ít phút — đơn TUBU1 .*CHƯA huỷ/);
      expect(pancakeHooks.precheckCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }), 'INTERACTIVE');
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
    });

    it('khách tự huỷ → đúng câu "Kho chưa phản hồi, vui lòng thử lại sau ít phút"', async () => {
      const { svc, pancakeHooks } = make(makeOrder(), { precheckCancel: unreachable() });
      await expect(svc.precheckPancakeCancel(makeOrder() as never, 'CUSTOMER')).rejects.toThrow(/^Kho chưa phản hồi, vui lòng thử lại sau ít phút$/);
      expect(pancakeHooks.precheckCancel).toHaveBeenCalledWith(expect.anything(), 'INTERACTIVE');
    });

    it('cron hết hạn thanh toán hỏi ở chế độ BACKGROUND (được hoãn, không treo mẻ)', async () => {
      const order = makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
      const { svc, pancakeHooks } = make(order, { precheckCancel: jest.fn().mockResolvedValue({ kind: 'DEFERRED', reason: 'timeout' }) });
      await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true });
      expect(pancakeHooks.precheckCancel).toHaveBeenCalledWith(expect.anything(), 'BACKGROUND');
      expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', { kind: 'DEFERRED', reason: 'timeout' });
    });
  });

  it.each([
    ['CANCELLED', 'CONFIRMED'],
    ['RETURNED', 'DELIVERED'],
  ])('đơn chuyển %s → đóng báo động Gomdon "hàng đã hoàn về kho" và gỡ việc Pancake "HUỶ sau bàn giao"/"ĐANG HOÀN" (R3-CANCEL-3)', async (to, from) => {
    const { svc, prisma } = make(makeOrder({ status: from, pancakeOrderId: null, paymentStatus: 'UNPAID', paymentMethod: 'COD' }));
    await svc.setStatus('o1', to as never, { actorType: 'ADMIN' });
    expect(prisma.gomdonAlert.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', resolvedAt: null, kind: { in: ['GOODS_RETURNED'] } },
      data: { resolvedAt: expect.any(Date), resolvedById: null },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'o1',
        OR: [
          { pancakeAttention: { startsWith: 'Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển' } },
          { pancakeAttention: { startsWith: 'Pancake đã huỷ nhưng đơn Tubu còn hiệu lực' } },
          { pancakeAttention: { startsWith: 'Pancake báo ĐANG HOÀN' } },
        ],
      },
      data: { pancakeAttention: null, pancakeAttentionAt: null },
    });
  });

  it('Pancake báo huỷ (actor PANCAKE) → không hỏi/huỷ ngược lại Pancake', async () => {
    const { svc, pancakeHooks } = make(makeOrder());
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'PANCAKE' });
    expect(pancakeHooks.precheckCancel).not.toHaveBeenCalled();
    expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
  });

  it('huỷ hệ thống không cổng (Gomdon…) → không hỏi trước nhưng vẫn xếp job huỷ Pancake', async () => {
    const { svc, pancakeHooks } = make(makeOrder());
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM' });
    expect(pancakeHooks.precheckCancel).not.toHaveBeenCalled();
    expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', undefined);
  });
});

describe('OrderStatusService.markPaid → Pancake (PANCAKE-1, MONEY-1)', () => {
  it('lật PAID → xếp job báo Pancake "đã thanh toán, không thu COD"', async () => {
    const order = makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const { svc, prisma, pancakeHooks } = make(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CONFIRMED', paymentStatus: 'PAID' });
    const r = await svc.markPaid('o1', { actorType: 'ADMIN', actorId: 'a1' });
    expect(r.outcome).not.toBe('ALREADY_PAID');
    expect(pancakeHooks.afterPaid).toHaveBeenCalledWith('o1');
  });
});

describe('OrderStatusService — Pancake đã huỷ nhưng lần huỷ ở Tubu trượt/lỗi (SYNC-1)', () => {
  const decision = { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' };
  const expiring = () => makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
  const cron = { actorType: 'SYSTEM', pancakeGate: true, onlyIfUnpaid: true, expectedStatus: 'PENDING_PAYMENT' } as const;
  const attention = (m: jest.Mock) =>
    m.mock.calls.map((c) => c[0].data?.pancakeAttention).filter((a): a is string => typeof a === 'string');

  function lose(current: Record<string, unknown>, overrides: Record<string, jest.Mock> = {}) {
    const ctx = make(expiring(), { precheckCancel: jest.fn().mockResolvedValue(decision), ...overrides });
    ctx.tx.order.updateMany.mockResolvedValue({ count: 0 });
    ctx.prisma.order.findUniqueOrThrow.mockResolvedValue(current);
    (ctx.prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(current);
    return ctx;
  }

  it('cron hết hạn: tiền về chen giữa lúc Pancake huỷ và lúc lật → đơn còn CONFIRMED+PAID, ghi pancakeCancelStatus + "Cần xử lý Pancake" + báo admin', async () => {
    const paid = { ...expiring(), status: 'CONFIRMED', paymentStatus: 'PAID' };
    const { svc, prisma, notifications, pancakeHooks } = lose(paid);
    const after = await svc.setStatus('o1', 'CANCELLED' as never, cron);
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', OR: [{ pancakeOrderId: null }, { pancakeOrderId: 'pk-1' }] },
      data: { pancakeCancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' },
    });
    const [reason] = attention(prisma.order.updateMany);
    expect(reason).toContain('Pancake đã huỷ nhưng đơn Tubu còn hiệu lực');
    expect(reason).toContain('#pk-1');
    expect(reason).toContain('nay CONFIRMED + PAID');
    expect(notifications.notify).toHaveBeenCalledWith('admin1', 'OPS_PANCAKE_ALERT', expect.objectContaining({ order_code: 'TUBU1' }));
  });

  it('mã vận đơn hãng được gán chen giữa → lỗi bàn giao giữ nguyên cho người bấm, và vẫn ghi dấu lệch', async () => {
    const shipped = { ...makeOrder({ status: 'PACKED' }), shippingCode: 'GHN1', shippingPartner: 'GHN' };
    const ctx = make(makeOrder({ status: 'PACKED' }), { precheckCancel: jest.fn().mockResolvedValue(decision) });
    ctx.tx.order.updateMany.mockResolvedValue({ count: 0 });
    ctx.prisma.order.findUniqueOrThrow.mockResolvedValue(shipped);
    (ctx.prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(shipped);
    await expect(ctx.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'a1' })).rejects.toBeInstanceOf(CancelAfterHandoverError);
    expect(attention(ctx.prisma.order.updateMany)[0]).toContain('Pancake đã huỷ nhưng đơn Tubu còn hiệu lực');
  });

  it('lần lật + hoàn tiền ném lỗi (DB) → lỗi ném tiếp nguyên vẹn, đơn còn sống được ghi dấu lệch', async () => {
    const live = expiring();
    const ctx = make(live, { precheckCancel: jest.fn().mockResolvedValue(decision) });
    (ctx.prisma.$transaction as jest.Mock).mockRejectedValue(new Error('deadlock detected'));
    (ctx.prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(live);
    await expect(ctx.svc.setStatus('o1', 'CANCELLED' as never, cron)).rejects.toThrow('deadlock detected');
    const [reason] = attention(ctx.prisma.order.updateMany);
    expect(reason).toContain('lần huỷ ở Tubu lỗi: deadlock detected');
  });

  it('request khác (hay webhook Pancake "Đã huỷ") đã huỷ đơn xong → không còn lệch, không ghi dấu', async () => {
    const { svc, prisma } = lose({ ...expiring(), status: 'CANCELLED' });
    await svc.setStatus('o1', 'CANCELLED' as never, cron);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['Pancake chưa nhận lệnh huỷ (DEFERRED)', { kind: 'DEFERRED', reason: 'timeout' }],
    ['không có gì bên Pancake (NONE)', { kind: 'NONE' }],
    ['Pancake không có đơn (NOT_FOUND)', { kind: 'CONFIRMED', cancelStatus: 'NOT_FOUND', pancakeOrderId: null }],
  ])('%s → Pancake còn đơn sống hoặc chưa từng có, không phải lệch', async (_label, d) => {
    const paid = { ...expiring(), status: 'CONFIRMED', paymentStatus: 'PAID' };
    const { svc, prisma } = lose(paid, { precheckCancel: jest.fn().mockResolvedValue(d) });
    await svc.setStatus('o1', 'CANCELLED' as never, cron);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('lần huỷ thắng → không ghi dấu lệch (đường bình thường không đổi)', async () => {
    const { svc, prisma, pancakeHooks } = make(expiring(), { precheckCancel: jest.fn().mockResolvedValue(decision) });
    await svc.setStatus('o1', 'CANCELLED' as never, cron);
    expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', decision);
    expect(attention(prisma.order.updateMany)).toEqual([]);
  });
});

describe('OrderStatusService — huỷ gặp "Đã bàn giao" của Pancake trên đơn có vận đơn Gomdon sống (SYNC-2)', () => {
  const recycling = (over: Record<string, unknown> = {}) =>
    makeOrder({ status: 'CONFIRMED', hasRecyclingPickup: true, gomdonOrderId: 'GM1', gomdonStatus: '1', gomdonCancelStatus: null, ...over });
  const handedOver = (code: number) => ({ precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(code)) });
  const attention = (m: jest.Mock) =>
    m.mock.calls.map((c) => c[0].data?.pancakeAttention).filter((a): a is string => typeof a === 'string');

  it.each([
    ['Đã nhận (3) → DELIVERED', 3],
    ['Đã gửi hàng (2) → SHIPPING', 2],
  ])('Pancake báo %s: KHÔNG đổi trạng thái đơn (không cộng điểm, không khoá hoa hồng), vào "Cần xử lý" kèm lý do Gomdon', async (_label, code) => {
    const { svc, tx, prisma } = make(recycling(), handedOver(code));
    const err = (await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'a1' }).catch((e: Error) => e)) as Error;
    expect(err.message).toContain('không huỷ được nữa');
    expect(err.message).toContain('vận đơn Gomdon đang chạy');
    expect(err.message).not.toContain('đã đồng bộ');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(attention(prisma.order.updateMany)[0]).toContain('trạng thái đang giao/đã giao chỉ theo Gomdon');
  });

  it('khách bấm huỷ → vẫn nhận câu "liên hệ CSKH", đơn không bị chốt DELIVERED', async () => {
    const { svc, tx } = make(recycling(), handedOver(3));
    await expect(svc.precheckPancakeCancel(recycling() as never, 'CUSTOMER')).rejects.toThrow('vui lòng liên hệ CSKH');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('vận đơn Gomdon đã huỷ (Gomdon hết sở hữu) → Pancake vẫn được đồng bộ về DELIVERED như trước', async () => {
    const { svc, tx } = make(recycling({ gomdonStatus: '2' }), handedOver(3));
    await expect(svc.precheckPancakeCancel(recycling({ gomdonStatus: '2' }) as never, 'CUSTOMER')).rejects.toThrow();
    expect(tx.order.updateMany.mock.calls.map((c) => c[0].data.status)).toEqual(['DELIVERED']);
  });

  it('đơn không thu gom (không có vận đơn Gomdon) → đồng bộ như trước', async () => {
    const { svc, tx } = make(makeOrder({ status: 'PACKED' }), handedOver(3));
    await expect(svc.precheckPancakeCancel(makeOrder({ status: 'PACKED' }) as never, 'CUSTOMER')).rejects.toThrow();
    expect(tx.order.updateMany.mock.calls.map((c) => c[0].data.status)).toEqual(['DELIVERED']);
  });
});
