import { REMARKETING_NOTICES } from '@tubutree/shared-types';
import type { SystemConfigService } from '../system-config/system-config.service';
import { NOT_PILOT_CLEANED_SQL, REVENUE_ORDER_SQL } from '../admin/admin-revenue';
import { NOTIFICATION_DELIVERY } from '../notifications/notification-delivery';
import { PROACTIVE_CAP_ENABLED_KEY, PROACTIVE_PER_DAY_KEY, PROACTIVE_PER_WEEK_KEY } from '../notifications/notification-proactive-cap';
import { ORDER_PAYMENT_REMINDER_TEMPLATE } from '../orders/pending-payment-expiry.cron';
import { NOTIFICATION_SUPPRESSED_EVENT, REMARKETING_TEMPLATES, remarketingAttribution } from './remarketing-attribution';

const since = new Date('2026-11-11T17:00:00.000Z');
const until = new Date('2026-11-18T15:00:00.000Z');

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
/** Prisma.join đặt mỗi mã một tham số: gom lại để so danh sách mã. */
const paramsOf = (call: unknown[]): unknown[] =>
  call.slice(1).flatMap((v) => (v && typeof v === 'object' && 'values' in v ? (v as { values: unknown[] }).values : [v]));

function config(values: Record<string, unknown> = {}): SystemConfigService {
  return { get: jest.fn(async (key: string, fallback: unknown) => (key in values ? values[key] : fallback)) } as unknown as SystemConfigService;
}

describe('remarketingAttribution', () => {
  it('mỗi dòng ứng với đúng mẫu tin đang gửi; nhắc chuyển khoản khớp hằng của cron huỷ đơn', () => {
    expect(REMARKETING_TEMPLATES.payment_reminder).toBe(ORDER_PAYMENT_REMINDER_TEMPLATE);
    expect(Object.keys(REMARKETING_TEMPLATES)).toEqual([...REMARKETING_NOTICES]);
    // Mẫu tin phải là mã đã khai loại gửi (mã gõ sai sẽ rơi vào TRANSACTIONAL mặc định và bảng luôn 0).
    for (const code of Object.values(REMARKETING_TEMPLATES)) expect(NOTIFICATION_DELIVERY[code]).toBeDefined();
    // Bốn loại tin kéo khách chịu trần tin chủ động; nhắc chuyển khoản là tin giao dịch.
    expect(NOTIFICATION_DELIVERY[REMARKETING_TEMPLATES.payment_reminder]).toEqual({ kind: 'TRANSACTIONAL' });
    for (const n of ['abandoned_cart', 'winback', 'wishlist_price_drop', 'refill_21d'] as const) {
      expect(NOTIFICATION_DELIVERY[REMARKETING_TEMPLATES[n]]!.kind).toBe('PROACTIVE');
    }
  });

  it('đủ 5 dòng theo thứ tự, bigint thành số, dòng không có dữ liệu là 0; trần tắt thì proactiveCap null', async () => {
    const $queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        { code: 'CART_ABANDONED', sent: 120n, zns_sent: 30n },
        { code: 'ORDER_PAYMENT_REMINDER', sent: 9n, zns_sent: 0n },
      ])
      .mockResolvedValueOnce([{ code: 'CART_ABANDONED', n: 7n }])
      .mockResolvedValueOnce([
        { code: 'CART_ABANDONED', orders: 6n, revenue: 1_800_000n },
        { code: 'ORDER_PAYMENT_REMINDER', orders: 4n, revenue: 960_000n },
      ]);
    const dto = await remarketingAttribution({ $queryRaw } as never, config(), since, until);
    expect(dto.windowHours).toBe(72);
    expect(dto.proactiveCap).toBeNull();
    expect(dto.rows).toEqual([
      { notice: 'abandoned_cart', sent: 120, znsSent: 30, znsCapped: 7, orders: 6, revenue: 1_800_000 },
      { notice: 'winback', sent: 0, znsSent: 0, znsCapped: 0, orders: 0, revenue: 0 },
      { notice: 'wishlist_price_drop', sent: 0, znsSent: 0, znsCapped: 0, orders: 0, revenue: 0 },
      { notice: 'refill_21d', sent: 0, znsSent: 0, znsCapped: 0, orders: 0, revenue: 0 },
      { notice: 'payment_reminder', sent: 9, znsSent: 0, znsCapped: 0, orders: 4, revenue: 960_000 },
    ]);
  });

  it('trần tin chủ động bật: trả số tin mỗi ngày/tuần đang áp', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    const cfg = config({ [PROACTIVE_CAP_ENABLED_KEY]: true, [PROACTIVE_PER_DAY_KEY]: 2, [PROACTIVE_PER_WEEK_KEY]: 5 });
    const dto = await remarketingAttribution({ $queryRaw } as never, cfg, since, until);
    expect(dto.proactiveCap).toEqual({ perDay: 2, perWeek: 5 });
  });

  it('truy vấn: tin đếm theo log trong app, ZNS chỉ log SENT, trần theo sự kiện bỏ ZNS; đơn cùng bộ lọc trang và luật Doanh thu', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    await remarketingAttribution({ $queryRaw } as never, config(), since, until);
    expect($queryRaw).toHaveBeenCalledTimes(3);
    const [sentCall, cappedCall, orderCall] = $queryRaw.mock.calls as unknown[][];
    const codes = Object.values(REMARKETING_TEMPLATES);

    const sentSql = sqlOf(sentCall!);
    expect(sentSql).toContain("count(*) FILTER (WHERE l.channel = 'INAPP') AS sent");
    expect(sentSql).toContain("l.channel = 'ZNS' AND l.status = 'SENT'");
    expect(paramsOf(sentCall!)).toEqual([...codes, since.toISOString(), until.toISOString()]);

    expect(sqlOf(cappedCall!)).toContain('e."occurredAt" >=');
    expect(paramsOf(cappedCall!)).toEqual([NOTIFICATION_SUPPRESSED_EVENT, since.toISOString(), until.toISOString(), ...codes]);

    const orderSql = sqlOf(orderCall!);
    expect(orderCall).toContain(NOT_PILOT_CLEANED_SQL);
    expect(orderCall).toContain(REVENUE_ORDER_SQL);
    expect(orderSql).toContain("o.status NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')");
    expect(orderSql).toContain("o.type = 'RETAIL'");
    expect(orderSql).toContain('o."placedForCustomer" = false');
    expect(orderSql).toContain('COALESCE(o."checkoutGroup", o.id)');
    expect(orderSql).toContain("l.channel = 'INAPP'");
    // Nhắc chuyển khoản gán theo mã đơn trong tin và lúc trả tiền; tin khác gán theo lúc đặt đơn, tin cuối thắng.
    expect(orderSql).toContain("l.payload->'data'->>'order_code'");
    expect(orderSql).toContain('o.paid_at > t.sent_at');
    expect(orderSql).toContain('t.sent_at < g.created_at');
    expect(orderSql).toContain('ORDER BY g.user_id, g.grp, t.sent_at DESC');
    expect(orderSql).toContain('COALESCE(p.code, q.code)');
    expect(paramsOf(orderCall!)).toEqual(expect.arrayContaining([72, ORDER_PAYMENT_REMINDER_TEMPLATE, since.toISOString(), until.toISOString()]));
  });

  it('lỗi truy vấn ném ra cho nơi gọi quyết định', async () => {
    const $queryRaw = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(remarketingAttribution({ $queryRaw } as never, config(), since, until)).rejects.toThrow('db down');
  });
});
