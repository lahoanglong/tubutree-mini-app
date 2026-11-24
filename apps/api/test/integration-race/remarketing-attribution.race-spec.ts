import { randomBytes } from 'node:crypto';
import type { RemarketingAttributionDTO, RemarketingAttributionRow } from '@tubutree/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NOTIFICATION_SUPPRESSED_EVENT, remarketingAttribution } from '../../src/modules/lifecycle/remarketing-attribution';
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

    // J: bản ZNS nhắc giỏ bị trần tin chủ động bỏ.
    const j = await user();
    await prisma.analyticsEvent.create({
      data: {
        eventId: `it-rm-${tag}-capped`,
        eventName: NOTIFICATION_SUPPRESSED_EVENT,
        occurredAt: at('16T05:00:00'),
        receivedAt: at('16T05:00:00'),
        userId: j,
        platform: 'system',
        props: { templateCode: 'CART_ABANDONED', category: 'cart', reason: 'day_cap', channel: 'ZNS' },
      },
    });

    dto = await remarketingAttribution(prisma, undefined, SINCE, UNTIL);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "notification_logs" WHERE "userId" = ANY(${userIds}::text[])`;
    await prisma.$executeRaw`DELETE FROM "analytics_events" WHERE "userId" = ANY(${userIds}::text[])`;
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  it('đủ 5 dòng theo thứ tự, trần tắt khi không có cấu hình', () => {
    expect(dto.windowHours).toBe(72);
    expect(dto.rows.map((r) => r.notice)).toEqual(['abandoned_cart', 'winback', 'wishlist_price_drop', 'refill_21d', 'payment_reminder']);
    expect(dto.proactiveCap).toBeNull();
  });

  it('nhắc giỏ: tin trong kỳ (A, L, G, I), ZNS đã tới 1, bị trần 1; đơn A (COD chưa giao, chưa có tiền) và L', () => {
    expect(row('abandoned_cart')).toEqual({ notice: 'abandoned_cart', sent: 4, znsSent: 1, znsCapped: 1, orders: 2, revenue: 120_000 });
  });

  it('tin cuối thắng: đơn của B về giá giảm, mã quay lại không có đơn; ZNS lỗi không đếm', () => {
    expect(row('winback')).toEqual({ notice: 'winback', sent: 1, znsSent: 0, znsCapped: 0, orders: 0, revenue: 0 });
    expect(row('wishlist_price_drop')).toEqual({ notice: 'wishlist_price_drop', sent: 1, znsSent: 0, znsCapped: 0, orders: 1, revenue: 300_000 });
  });

  it('Refill: quá 72 giờ không gán; một lần đặt tách hai đơn là một đơn, tiền cộng hai phần', () => {
    expect(row('refill_21d')).toEqual({ notice: 'refill_21d', sent: 2, znsSent: 0, znsCapped: 0, orders: 1, revenue: 180_000 });
  });

  it('nhắc chuyển khoản: gán theo mã đơn và lúc trả tiền, kể cả đơn đặt trước kỳ; trả trước tin hay đơn của khách khác thì không', () => {
    expect(row('payment_reminder')).toEqual({ notice: 'payment_reminder', sent: 3, znsSent: 0, znsCapped: 0, orders: 1, revenue: 150_000 });
  });
});
