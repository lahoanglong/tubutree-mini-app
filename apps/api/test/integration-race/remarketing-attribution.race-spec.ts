import { randomBytes } from 'node:crypto';
import type { RemarketingAttributionDTO, RemarketingAttributionRow } from '@tubutree/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NOTIFICATION_SUPPRESSED_EVENT, PROMO_MONTHLY_REASON, remarketingAttribution } from '../../src/modules/lifecycle/remarketing-attribution';
import { COD_SWITCH_HISTORY_NOTE } from '../../src/modules/orders/cod-switch';
import { PILOT_CLEANUP_ACTION } from '../../src/modules/admin/golive/golive-pilot';
import { createOrder, createUser, deleteItData } from './helpers';
import './setup-env';

/**
 * "Tin nào ra đơn" trên Postgres THẬT: spec đơn vị chỉ mock `$queryRaw`, đây là bằng chứng luật gán 72 giờ chạy đúng (tin cuối thắng, nhắc
 * chuyển khoản theo mã đơn và lúc trả tiền, gộp đơn tách theo nhà bán, tin trước kỳ không tính, tiền theo luật Doanh thu). Kỳ ở năm 2051,
 * sau mọi mốc của spec khác, nên số tin đếm toàn bảng chỉ gồm tin dựng ở đây.
 */
const SINCE = new Date('2051-03-13T17:00:00.000Z'); // 00:00 ngày 14/03 giờ VN
const UNTIL = new Date('2051-03-20T05:00:00.000Z');
const at = (iso: string) => new Date(`2051-03-${iso}Z`);

describe('remarketingAttribution — SQL trên Postgres thật', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const auditIds: string[] = [];
  const tag = randomBytes(4).toString('hex');
  let dto: RemarketingAttributionDTO;
  const row = (notice: RemarketingAttributionRow['notice']) => dto.rows.find((r) => r.notice === notice)!;

  async function user() {
    const u = await createUser(prisma);
    userIds.push(u.id);
    return u.id;
  }

  async function log(userId: string, templateCode: string, sentAt: string, opts: { channel?: 'INAPP' | 'ZNS'; status?: string; data?: Record<string, string> } = {}) {
    await prisma.notificationLog.create({
      data: { userId, templateCode, channel: opts.channel ?? 'INAPP', status: opts.status ?? 'SENT', payload: { body: 'x', data: opts.data ?? {} }, sentAt: at(sentAt) },
    });
  }

  const paid = (total: number, createdAt: string) => ({ total, subtotal: total, paymentMethod: 'BANK_TRANSFER' as const, paymentStatus: 'PAID' as const, paidAt: at(createdAt), createdAt: at(createdAt) });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // A: nhắc giỏ, 4 giờ sau đặt đơn COD chưa giao → có đơn, chưa có doanh thu. Bản ZNS đã tới Zalo.
    const a = await user();
    await log(a, 'CART_ABANDONED', '15T01:00:00');
    await log(a, 'CART_ABANDONED', '15T01:00:00', { channel: 'ZNS' });
    await createOrder(prisma, { userId: a, createdAt: at('15T05:00:00') });
    // L: nhắc giỏ rồi đặt đơn đã trả tiền → doanh thu 120.000.
    const l = await user();
    await log(l, 'CART_ABANDONED', '19T00:00:00');
    await createOrder(prisma, { userId: l, ...paid(120_000, '19T01:00:00') });

    // B: mã quay lại rồi giá món Yêu thích giảm, đơn sau cả hai → gán cho tin cuối (giá giảm). Bản ZNS của mã quay lại lỗi, không đếm.
    const b = await user();
    await log(b, 'WINBACK_VOUCHER', '15T00:00:00');
    await log(b, 'WINBACK_VOUCHER', '15T00:00:00', { channel: 'ZNS', status: 'FAILED' });
    await log(b, 'PRICE_DROP_ALERT', '16T00:00:00');
    await createOrder(prisma, { userId: b, ...paid(300_000, '16T03:00:00') });

    // C: nhắc Refill, đơn tới sau 73 giờ → ngoài cửa sổ.
    const c = await user();
    await log(c, 'REORDER_REMINDER_REFILL', '14T00:00:00');
    await createOrder(prisma, { userId: c, ...paid(90_000, '17T01:00:00') });
    // H: nhắc Refill rồi một lần đặt tách hai đơn theo nhà bán → một đơn, doanh thu cộng hai phần.
    const h = await user();
    await log(h, 'REORDER_REMINDER_REFILL', '18T00:00:00');
    await createOrder(prisma, { userId: h, checkoutGroup: `it-rm-${tag}`, ...paid(100_000, '18T02:00:00') });
    await createOrder(prisma, { userId: h, checkoutGroup: `it-rm-${tag}`, ...paid(80_000, '18T02:00:01') });

    // D: đơn chuyển khoản đặt TRƯỚC kỳ, nhắc chuyển khoản trong kỳ, trả tiền 2 giờ sau tin → gán cho nhắc chuyển khoản. Nhắc giỏ trước kỳ
    // của D không được tính.
    const d = await user();
    await log(d, 'CART_ABANDONED', '13T08:00:00');
    const dOrder = await createOrder(prisma, { userId: d, ...paid(150_000, '13T10:00:00'), paidAt: at('14T02:00:00') });
    await log(d, 'ORDER_PAYMENT_REMINDER', '14T00:00:00', { data: { order_code: dOrder.code } });
    // E: đơn đã trả tiền TRƯỚC tin nhắc chuyển khoản → không gán.
    const e = await user();
    const eOrder = await createOrder(prisma, { userId: e, ...paid(70_000, '14T03:00:00'), paidAt: at('14T23:00:00') });
    await log(e, 'ORDER_PAYMENT_REMINDER', '15T00:00:00', { data: { order_code: eOrder.code } });
    // M: tin nhắc chuyển khoản trỏ đơn của khách khác (dữ liệu hỏng) → không gán, không lấy đơn của E.
    const m = await user();
    await log(m, 'ORDER_PAYMENT_REMINDER', '14T22:00:00', { data: { order_code: eOrder.code } });

    // F: nhắc giỏ trước kỳ, đơn trong kỳ → không tính (tin cuối gửi trước kỳ).
    const f = await user();
    await log(f, 'CART_ABANDONED', '13T15:00:00');
    await createOrder(prisma, { userId: f, ...paid(60_000, '13T18:00:00') });
    // G: nhắc giỏ, đơn bị huỷ → không tính. I: đơn đặt trước tin → không tính.
    const g = await user();
    await log(g, 'CART_ABANDONED', '17T00:00:00');
    await createOrder(prisma, { userId: g, status: 'CANCELLED', createdAt: at('17T02:00:00') });
    const i = await user();
    await createOrder(prisma, { userId: i, ...paid(50_000, '18T00:00:00') });
    await log(i, 'CART_ABANDONED', '18T01:00:00');

    // J: bản ZNS nhắc giỏ bị trần tin chủ động bỏ một lần, trần tin khuyến mãi tháng bỏ một lần.
    const j = await user();
    for (const [i, reason] of ['day_cap', PROMO_MONTHLY_REASON].entries()) {
      await prisma.analyticsEvent.create({
        data: {
          eventId: `it-rm-${tag}-capped-${i}`,
          eventName: NOTIFICATION_SUPPRESSED_EVENT,
          occurredAt: at('16T05:00:00'),
          receivedAt: at('16T05:00:00'),
          userId: j,
          platform: 'system',
          props: { templateCode: 'CART_ABANDONED', category: 'cart', reason, channel: 'ZNS' },
        },
      });
    }

    // N: nhắc giỏ TRONG kỳ, đặt đơn chuyển khoản, nhắc chuyển khoản rồi trả tiền → đơn về nhắc chuyển khoản (tin cuối), không về nhắc giỏ.
    const n = await user();
    await log(n, 'CART_ABANDONED', '16T00:00:00');
    const nOrder = await createOrder(prisma, { userId: n, ...paid(210_000, '16T01:00:00'), paidAt: at('16T21:00:00') });
    await log(n, 'ORDER_PAYMENT_REMINDER', '16T20:00:00', { data: { order_code: nOrder.code } });
    // P: nhắc chuyển khoản rồi khách bấm đổi sang trả tiền khi nhận (không có paidAt) → vẫn gán cho nhắc chuyển khoản; COD chưa giao nên chưa
    // có doanh thu.
    const pUser = await user();
    const pOrder = await createOrder(prisma, { userId: pUser, createdAt: at('17T00:00:00') });
    await log(pUser, 'ORDER_PAYMENT_REMINDER', '17T20:00:00', { data: { order_code: pOrder.code } });
    await prisma.orderStatusHistory.create({
      data: { orderId: pOrder.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', actorType: 'CUSTOMER', actorId: pUser, note: COD_SWITCH_HISTORY_NOTE, createdAt: at('17T21:00:00') },
    });

    // Q: giá món Yêu thích giảm, đơn 200.000 đã trả rồi trả hàng một phần được duyệt 50.000 → doanh thu 150.000.
    const q = await user();
    await log(q, 'PRICE_DROP_ALERT', '18T00:00:00');
    const qOrder = await createOrder(prisma, { userId: q, ...paid(200_000, '18T05:00:00') });
    await prisma.returnRequest.create({ data: { orderId: qOrder.id, userId: q, reason: 'IT', status: 'APPROVED', refundAmount: 50_000 } });
    // R: mã quay lại; đơn đặt hộ khách, đơn còn chờ thanh toán và đơn thử Giờ G đã dọn đều không tính.
    const r = await user();
    await log(r, 'WINBACK_VOUCHER', '18T00:00:00');
    await createOrder(prisma, { userId: r, placedForCustomer: true, endCustomerKey: '0912345678', ...paid(80_000, '18T02:00:00') });
    await createOrder(prisma, { userId: r, status: 'PENDING_PAYMENT', createdAt: at('18T03:00:00') });
    const pilot = await createOrder(prisma, { userId: r, ...paid(90_000, '18T04:00:00') });
    const audit = await prisma.adminAuditLog.create({
      data: { actorId: r, action: PILOT_CLEANUP_ACTION, targetType: 'ORDER', targetIds: [pilot.code], payload: { archived: [pilot.code] } },
      select: { id: true },
    });
    auditIds.push(audit.id);

    dto = await remarketingAttribution(prisma, undefined, SINCE, UNTIL);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "notification_logs" WHERE "userId" = ANY(${userIds}::text[])`;
    await prisma.$executeRaw`DELETE FROM "analytics_events" WHERE "userId" = ANY(${userIds}::text[])`;
    await prisma.$executeRaw`DELETE FROM "order_status_history" WHERE "orderId" IN (SELECT id FROM "orders" WHERE "userId" = ANY(${userIds}::text[]))`;
    await prisma.adminAuditLog.deleteMany({ where: { id: { in: auditIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  it('đủ 5 dòng theo thứ tự, trần tắt khi không có cấu hình', () => {
    expect(dto.windowHours).toBe(72);
    expect(dto.rows.map((r) => r.notice)).toEqual(['abandoned_cart', 'winback', 'wishlist_price_drop', 'refill_21d', 'payment_reminder']);
    expect(dto.proactiveCap).toBeNull();
  });

  it('nhắc giỏ: tin trong kỳ (A, L, G, I, N), ZNS đã tới 1, bị trần mỗi loại 1; đơn A (COD chưa giao, chưa có tiền) và L; đơn N về nhắc chuyển khoản', () => {
    expect(row('abandoned_cart')).toEqual({ notice: 'abandoned_cart', sent: 5, znsSent: 1, znsCapped: 1, znsMonthlyCapped: 1, orders: 2, revenue: 120_000 });
  });

  it('tin cuối thắng: đơn của B về giá giảm; đặt hộ, chờ thanh toán, đơn thử đã dọn không tính; trả hàng một phần trừ vào doanh thu', () => {
    expect(row('winback')).toEqual({ notice: 'winback', sent: 2, znsSent: 0, znsCapped: 0, znsMonthlyCapped: 0, orders: 0, revenue: 0 });
    expect(row('wishlist_price_drop')).toEqual({ notice: 'wishlist_price_drop', sent: 2, znsSent: 0, znsCapped: 0, znsMonthlyCapped: 0, orders: 2, revenue: 450_000 });
  });

  it('Refill: quá 72 giờ không gán; một lần đặt tách hai đơn là một đơn, tiền cộng hai phần', () => {
    expect(row('refill_21d')).toEqual({ notice: 'refill_21d', sent: 2, znsSent: 0, znsCapped: 0, znsMonthlyCapped: 0, orders: 1, revenue: 180_000 });
  });

  it('nhắc chuyển khoản: trả tiền (D, N) hoặc đổi sang COD (P) trong 72 giờ sau tin; trả trước tin hay đơn của khách khác thì không', () => {
    expect(row('payment_reminder')).toEqual({ notice: 'payment_reminder', sent: 5, znsSent: 0, znsCapped: 0, znsMonthlyCapped: 0, orders: 3, revenue: 360_000 });
  });
});
