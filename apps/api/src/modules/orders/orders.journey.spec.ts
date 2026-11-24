import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { MssOrderEventRecorder } from '../integrations/mss/mss-order-event.recorder';
import { ORDER_ZALO_CONSENT_TEXT_VERSION } from '../integrations/mss/mss-order-event-types';

/**
 * Chi tiết đơn một dòng thời gian và bật Zalo từ chi tiết đơn. Prisma giả: chỉ kiểm hình dạng truy vấn và dữ liệu trả khách;
 * đua/idempotent trên Postgres thật ở test/integration-race/order-zalo-late-consent.race-spec.ts.
 */

const VERIFIED = { phone: '0901234567', phoneVerifiedAt: new Date('2026-10-01T00:00:00Z'), notifyOrderZalo: false };
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  status: 'SHIPPING',
  type: 'RETAIL',
  platform: 'miniapp',
  placedForCustomer: false,
  orderZaloConsent: null,
  paymentMethod: 'COD',
  shippingAddress: { recipient: 'An', phone: '0901 234 567' },
  items: [],
  // Giao từ lâu: thẻ "Đơn này thế nào?" (order-csat.spec) không hỏi nên detailView không đọc analyticsEvent/returnRequest.
  deliveredAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const gateOn = { enabled: true, open: true, rolloutPct: 100, at: Date.now() };
const gateOff = { enabled: false, open: false, rolloutPct: 0, at: Date.now() };

function cfg(values: Record<string, unknown> = {}) {
  return { get: jest.fn(async (k: string, fb?: unknown) => (k in values ? values[k] : fb)) } as unknown as SystemConfigService;
}

function build(opts: { order?: Record<string, unknown>; gate?: typeof gateOn | null; config?: Record<string, unknown>; outbox?: unknown[]; user?: unknown } = {}) {
  const o = order(opts.order);
  const outboxFindMany = jest.fn().mockResolvedValue(opts.outbox ?? []);
  const userFindUnique = jest.fn().mockResolvedValue(opts.user === undefined ? VERIFIED : opts.user);
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(o), findMany: jest.fn().mockResolvedValue([]) },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    flashSaleItem: { findMany: jest.fn().mockResolvedValue([]) },
    orderStatusHistory: { findMany: jest.fn().mockResolvedValue([]) },
    mssOrderEventOutbox: { findMany: outboxFindMany },
    user: { findUnique: userFindUnique },
    pointsTransaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { delta: null } }) },
  } as unknown as PrismaService;
  const recorder = opts.gate === null ? undefined : ({ gate: () => opts.gate ?? gateOff } as unknown as MssOrderEventRecorder);
  const svc = new OrdersService(prisma, {} as never, {} as never, {} as never, cfg(opts.config), {} as never, {} as never, undefined, undefined, undefined, undefined, recorder);
  return { svc, outboxFindMany, userFindUnique };
}

describe('OrdersService.detailView: phần dòng thời gian một khối', () => {
  it('mọi cờ tắt (mặc định PROD): timelineV2 false, notices rỗng, không có nút Zalo, không đọc outbox hay người dùng', async () => {
    const { svc, outboxFindMany, userFindUnique } = build();
    const view = await svc.detailView('u1', 'TUBU1');
    expect(view).toMatchObject({ timelineV2: false, trackingStaleHours: 72, notices: [], orderZaloAvailable: false, orderZaloOn: false });
    expect(outboxFindMany).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('API dựng không có recorder MSS (test cũ, module thiếu): như cờ MSS tắt', async () => {
    const { svc } = build({ gate: null, config: { 'orders.timeline_v2_enabled': true } });
    expect(await svc.detailView('u1', 'TUBU1')).toMatchObject({ timelineV2: true, notices: [], orderZaloAvailable: false });
  });

  it('cờ dòng thời gian bật nhưng cờ MSS tắt: notices rỗng, không đọc outbox', async () => {
    const { svc, outboxFindMany } = build({ config: { 'orders.timeline_v2_enabled': true } });
    const view = await svc.detailView('u1', 'TUBU1');
    expect(view.notices).toEqual([]);
    expect(outboxFindMany).not.toHaveBeenCalled();
  });

  it('cả hai cờ bật: chỉ tin đã tới khách (RESULT_SENT → Zalo, đường lui ZNS → ZNS), chỉ ba trường, không lộ trạng thái nội bộ hay lý do lỗi', async () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 5, h));
    const { svc, outboxFindMany } = build({
      gate: gateOn,
      config: { 'orders.timeline_v2_enabled': true, 'orders.tracking_stale_hours': 48 },
      outbox: [
        { eventType: 'order.created', status: 'RESULT_SENT', resultAt: at(1), deliveredAt: at(0), occurredAt: at(0), fallbackChannel: null, fallbackAt: null },
        { eventType: 'order.shipping', status: 'RESULT_FAILED', resultAt: at(3), deliveredAt: null, occurredAt: at(2), fallbackChannel: 'ZNS', fallbackAt: at(4) },
        { eventType: 'order.delivered', status: 'RESULT_SKIPPED', resultAt: at(5), deliveredAt: null, occurredAt: at(5), fallbackChannel: 'IN_APP_ONLY', fallbackAt: at(6) },
      ],
    });
    const view = await svc.detailView('u1', 'TUBU1');
    expect(view.trackingStaleHours).toBe(48);
    expect(view.notices).toEqual([
      { event: 'order.created', channel: 'ZALO', at: at(1).toISOString() },
      { event: 'order.shipping', channel: 'ZNS', at: at(4).toISOString() },
    ]);
    const q = outboxFindMany.mock.calls[0][0];
    expect(q.where).toEqual({ orderId: 'o1', OR: [{ status: 'RESULT_SENT' }, { fallbackChannel: 'ZNS', fallbackAt: { not: null } }] });
    expect(JSON.stringify(view.notices)).not.toMatch(/RESULT|reason|eventId|body|lastError/);
  });

  it('số giờ đứng yên admin lưu sai kiểu hoặc ngoài 1..720: dùng 72', async () => {
    for (const bad of ['72', 0, 721, 1.5, null]) {
      const { svc } = build({ config: { 'orders.tracking_stale_hours': bad } });
      expect((await svc.detailView('u1', 'TUBU1')).trackingStaleHours).toBe(72);
    }
  });

  it('nút Zalo: đơn đang đi của chính khách, giao tới số đã xác minh, chưa đồng ý → có', async () => {
    const { svc } = build({ gate: gateOn });
    expect((await svc.detailView('u1', 'TUBU1')).orderZaloAvailable).toBe(true);
  });

  it.each([
    ['đơn đã giao', { status: 'DELIVERED' }, undefined],
    ['đơn đã huỷ', { status: 'CANCELLED' }, undefined],
    ['đơn đã có đồng ý', { orderZaloConsent: true }, undefined],
    ['đơn tặng (giao tới số khác)', { shippingAddress: { phone: '0987654321' } }, undefined],
    ['đơn CTV lên hộ', { placedForCustomer: true }, undefined],
    ['đơn đại lý', { type: 'DEALER' }, undefined],
    ['đơn không rõ nền tảng', { platform: null }, undefined],
    ['số chưa xác minh', {}, { phone: '0901234567', phoneVerifiedAt: null }],
  ])('nút Zalo: %s → không', async (_label, over, user) => {
    const { svc } = build({ gate: gateOn, order: over, user });
    expect((await svc.detailView('u1', 'TUBU1')).orderZaloAvailable).toBe(false);
  });

  it('dòng "Sẽ báo qua Zalo": chỉ khi đơn có đồng ý VÀ khách chưa tắt lựa chọn VÀ bộ ghi sự kiện không bỏ qua đơn', async () => {
    const on = build({ gate: gateOn, order: { orderZaloConsent: true }, user: { ...VERIFIED, notifyOrderZalo: true } });
    expect(await on.svc.detailView('u1', 'TUBU1')).toMatchObject({ orderZaloOn: true, orderZaloAvailable: false });
    expect(on.userFindUnique.mock.calls[0][0].select).toEqual({ phone: true, phoneVerifiedAt: true, notifyOrderZalo: true });
  });

  it.each([
    ['khách đã tắt ở Cài đặt hoặc nhắn dừng trên Zalo', {}, { ...VERIFIED, notifyOrderZalo: false }],
    ['đơn tặng (giao tới số khác)', { shippingAddress: { phone: '0987654321' } }, { ...VERIFIED, notifyOrderZalo: true }],
    ['số chưa xác minh', {}, { phone: '0901234567', phoneVerifiedAt: null, notifyOrderZalo: true }],
    ['đơn đã giao', { status: 'DELIVERED' }, { ...VERIFIED, notifyOrderZalo: true }],
  ])('dòng "Sẽ báo qua Zalo": %s → không, và không có nút bật lại', async (_label, over, user) => {
    const { svc } = build({ gate: gateOn, order: { orderZaloConsent: true, ...over }, user });
    expect(await svc.detailView('u1', 'TUBU1')).toMatchObject({ orderZaloOn: false, orderZaloAvailable: false });
  });

  it('dòng "Sẽ báo qua Zalo": cờ MSS tắt → không, không đọc người dùng', async () => {
    const { svc, userFindUnique } = build({ order: { orderZaloConsent: true }, user: { ...VERIFIED, notifyOrderZalo: true } });
    expect((await svc.detailView('u1', 'TUBU1')).orderZaloOn).toBe(false);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('nút Zalo: đơn đã đóng không tốn truy vấn người dùng', async () => {
    const { svc, userFindUnique } = build({ gate: gateOn, order: { status: 'DELIVERED' } });
    await svc.detailView('u1', 'TUBU1');
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('khách khác xem đơn: 404 như cũ, không đọc outbox', async () => {
    const { svc, outboxFindMany } = build({ gate: gateOn, config: { 'orders.timeline_v2_enabled': true } });
    await expect(svc.detailView('u2', 'TUBU1')).rejects.toBeInstanceOf(NotFoundException);
    expect(outboxFindMany).not.toHaveBeenCalled();
  });
});

describe('OrdersService.enableOrderZalo (POST /orders/:code/order-zalo-consent)', () => {
  function tx(o: Record<string, unknown> | null, opts: { updateCount?: number; fresh?: boolean; user?: unknown } = {}) {
    const orderUpdateMany = jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 });
    const userUpdate = jest.fn().mockResolvedValue({});
    const outboxCreate = jest.fn();
    const client = {
      order: {
        findUnique: jest.fn().mockResolvedValue(o),
        updateMany: orderUpdateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue({ orderZaloConsent: opts.fresh ?? false }),
      },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue(opts.user ?? VERIFIED), update: userUpdate },
      mssOrderEventOutbox: { createMany: outboxCreate, create: outboxCreate },
    };
    const prisma = { $transaction: jest.fn(async (fn: (t: typeof client) => unknown) => fn(client)) } as unknown as PrismaService;
    return { prisma, orderUpdateMany, userUpdate, outboxCreate };
  }
  const svcOf = (prisma: PrismaService, gate: typeof gateOn | null = gateOn) =>
    new OrdersService(prisma, {} as never, {} as never, {} as never, cfg(), {} as never, {} as never, undefined, undefined, undefined, undefined, gate ? ({ gate: () => gate } as unknown as MssOrderEventRecorder) : undefined);

  it('bật: ghi đồng ý của đơn (nguồn order_detail) và lựa chọn gần nhất của khách (nguồn, phiên bản câu chữ); không ghi outbox', async () => {
    const t = tx(order());
    await expect(svcOf(t.prisma).enableOrderZalo('u1', 'TUBU1')).resolves.toEqual({ orderZaloConsent: true });
    const upd = t.orderUpdateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: 'o1', userId: 'u1', status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] }, OR: [{ orderZaloConsent: null }, { orderZaloConsent: false }] });
    expect(upd.data).toMatchObject({ orderZaloConsent: true, orderZaloConsentSource: 'order_detail' });
    expect(upd.data.orderZaloConsentAt).toBeInstanceOf(Date);
    expect(t.userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.objectContaining({ notifyOrderZalo: true, notifyOrderZaloSource: 'order_detail', notifyOrderZaloTextVersion: ORDER_ZALO_CONSENT_TEXT_VERSION }),
    });
    expect(t.outboxCreate).not.toHaveBeenCalled();
  });

  it('đã bật rồi (bấm đúp): trả cùng kết quả, không ghi gì thêm', async () => {
    const t = tx(order({ orderZaloConsent: true }));
    await expect(svcOf(t.prisma).enableOrderZalo('u1', 'TUBU1')).resolves.toEqual({ orderZaloConsent: true });
    expect(t.orderUpdateMany).not.toHaveBeenCalled();
    expect(t.userUpdate).not.toHaveBeenCalled();
  });

  it('yêu cầu đồng thời thua lượt UPDATE nhưng đơn đã được bật: trả thành công, không ghi người dùng lần hai', async () => {
    const t = tx(order(), { updateCount: 0, fresh: true });
    await expect(svcOf(t.prisma).enableOrderZalo('u1', 'TUBU1')).resolves.toEqual({ orderZaloConsent: true });
    expect(t.userUpdate).not.toHaveBeenCalled();
  });

  it('đơn vừa kết thúc giữa chừng (UPDATE không trúng, chưa bật): 409, không ghi người dùng', async () => {
    const t = tx(order(), { updateCount: 0, fresh: false });
    await expect(svcOf(t.prisma).enableOrderZalo('u1', 'TUBU1')).rejects.toBeInstanceOf(ConflictException);
    expect(t.userUpdate).not.toHaveBeenCalled();
  });

  it('khách khác, đơn không có: 404', async () => {
    await expect(svcOf(tx(order()).prisma).enableOrderZalo('u2', 'TUBU1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svcOf(tx(null).prisma).enableOrderZalo('u1', 'NOPE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cờ MSS tắt hoặc thiếu recorder: 404, không mở transaction', async () => {
    const t = tx(order());
    await expect(svcOf(t.prisma, gateOff).enableOrderZalo('u1', 'TUBU1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svcOf(t.prisma, null).enableOrderZalo('u1', 'TUBU1')).rejects.toBeInstanceOf(NotFoundException);
    expect((t.prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });

  it.each(['DELIVERED', 'CANCELLED', 'RETURNED'])('đơn %s: 409 lời rõ, không ghi gì', async (status) => {
    const t = tx(order({ status }));
    await expect(svcOf(t.prisma).enableOrderZalo('u1', 'TUBU1')).rejects.toThrow('Đơn này đã kết thúc');
    expect(t.orderUpdateMany).not.toHaveBeenCalled();
  });

  it('đơn tặng, số chưa xác minh: 409, không ghi gì', async () => {
    const gift = tx(order({ shippingAddress: { phone: '0987654321' } }));
    await expect(svcOf(gift.prisma).enableOrderZalo('u1', 'TUBU1')).rejects.toBeInstanceOf(ConflictException);
    const unverified = tx(order(), { user: { phone: '0901234567', phoneVerifiedAt: null } });
    await expect(svcOf(unverified.prisma).enableOrderZalo('u1', 'TUBU1')).rejects.toBeInstanceOf(ConflictException);
    expect(gift.orderUpdateMany).not.toHaveBeenCalled();
    expect(unverified.orderUpdateMany).not.toHaveBeenCalled();
  });
});
