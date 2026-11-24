import { PURCHASE_FUNNEL_STEPS, toGrowthWindowDays, type PurchaseFunnelDTO, type PurchaseFunnelWindowDTO } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PurchaseFunnelService } from '../analytics/purchase-funnel.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { FIRST_ORDER_REFERRER_PREFIX } from '../referral/first-order-reasons';
import { NOT_PILOT_CLEANED_SQL } from '../admin/admin-revenue';
import { AdminGrowthService, vnDayRange } from './admin-growth.service';

const win = (n: number): PurchaseFunnelWindowDTO => ({
  rows: PURCHASE_FUNNEL_STEPS.map((step) => ({ step, web: n, miniapp: 0, total: n })),
  sessions: { web: n, miniapp: 0, total: n },
});
const funnel: PurchaseFunnelDTO = { generatedAt: 'x', windows: { h72: win(1), d7: win(7), d30: win(30) } };

/**
 * Thứ tự truy vấn của compute: mua lần 2, game, đơn theo ngày, người chơi theo ngày, chặn thưởng đơn đầu, lượt gửi link mời, rồi ba truy vấn của
 * "Tin nào ra đơn" (tin đã gửi, ZNS bị trần, đơn được gán).
 */
function makeService(answers: unknown[][], rewarded = 0) {
  const $queryRaw = jest.fn();
  for (const a of answers) $queryRaw.mockResolvedValueOnce(a);
  const getSnapshot = jest.fn().mockResolvedValue(funnel);
  const findMany = jest.fn().mockResolvedValue(Array.from({ length: rewarded }, (_, i) => ({ reason: `${FIRST_ORDER_REFERRER_PREFIX}u${i}` })));
  const count = jest.fn().mockResolvedValue(0);
  const config = { get: jest.fn(async (_key: string, fallback: unknown) => fallback) } as unknown as SystemConfigService;
  const svc = new AdminGrowthService(
    { $queryRaw, pointsTransaction: { findMany, count } } as unknown as PrismaService,
    { getSnapshot } as unknown as PurchaseFunnelService,
    config,
  );
  return { svc, $queryRaw, getSnapshot, findMany };
}

const NO_BLOCKS = { SELF: 0, PHONE: 0, ZALO: 0, ADDRESS: 0, IP: 0 };

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

describe('AdminGrowthService', () => {
  // 15:00 UTC = 22:00 ngày 18/11 giờ VN.
  const now = new Date('2026-11-18T15:00:00.000Z');

  it('7 ngày: kỳ bắt đầu 00:00 VN ngày 12/11, phễu lấy cửa sổ d7, bigint thành number, đủ 7 ngày kể cả ngày trống', async () => {
    const { svc, $queryRaw, findMany } = makeService([
      [{ buyers: 10n, returning_buyers: 3n, new_buyers: 7n, new_with_second: 2n }],
      [
        { game: '*', players: 5n, buyers: 2n },
        { game: 'match', players: 2n, buyers: 1n },
        { game: 'sort', players: 4n, buyers: 2n },
      ],
      [{ day: '2026-11-18', n: 4n }, { day: '2026-11-12', n: 1n }],
      [{ day: '2026-11-17', n: 3n }],
      [{ reason: 'IP', n: 4n }, { reason: 'ADDRESS', n: 1n }],
      [{ method: 'share', n: 6n }, { method: 'copy', n: 2n }, { method: null, n: 9n }],
      [{ code: 'CART_ABANDONED', sent: 40n, zns_sent: 12n }],
      [{ code: 'CART_ABANDONED', proactive: 3n, monthly: 1n }],
      [{ code: 'CART_ABANDONED', orders: 5n, revenue: 1_250_000n }],
    ], 9);
    const dto = await svc.overview(7, now);
    expect(dto.days).toBe(7);
    expect(dto.sinceDay).toBe('2026-11-12');
    expect(dto.funnel).toEqual(funnel.windows.d7);
    expect(dto.repeat).toEqual({ buyers: 10, returningBuyers: 3, newBuyers: 7, newBuyersWithSecond: 2 });
    expect(dto.games.players).toBe(5);
    expect(dto.games.buyers).toBe(2);
    // Game đông người chơi đứng trước; dòng tổng '*' không lẫn vào danh sách.
    expect(dto.games.byGame).toEqual([
      { game: 'sort', players: 4, buyers: 2 },
      { game: 'match', players: 2, buyers: 1 },
    ]);
    expect(dto.daily.map((d) => d.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
    expect(dto.daily[0]).toEqual({ day: '2026-11-12', orders: 1, players: 0 });
    expect(dto.daily[5]).toEqual({ day: '2026-11-17', orders: 0, players: 3 });
    expect(dto.daily[6]).toEqual({ day: '2026-11-18', orders: 4, players: 0 });

    // Mốc đầu kỳ là 00:00 giờ VN (17:00 UTC hôm trước), không phải now − 7 ngày.
    const repeatCall = $queryRaw.mock.calls[0]!;
    expect(repeatCall).toContain('2026-11-11T17:00:00.000Z');
    // Cùng bộ lọc đơn với bảng đơn thứ hai: bán lẻ, khách tự đặt, bỏ huỷ/trả/chờ thanh toán, bỏ đơn thử Giờ G đã dọn, gộp theo checkoutGroup.
    const orderCalls = $queryRaw.mock.calls.filter((c) => sqlOf(c).includes('"orders"'));
    // Ba số đơn của trang và đơn được gán cho tin nhắc: cùng một bộ lọc.
    expect(orderCalls).toHaveLength(4);
    for (const call of orderCalls) {
      expect(call).toContain(NOT_PILOT_CLEANED_SQL);
      const sql = sqlOf(call);
      expect(sql).toContain("o.status NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')");
      expect(sql).toContain("o.type = 'RETAIL'");
      expect(sql).toContain('o."placedForCustomer" = false');
      expect(sql).toContain('COALESCE(o."checkoutGroup", o.id)');
    }
    // Người chơi: ván đã nộp, hoặc lượt Chọn Chuẩn Xanh (ghi không có submittedAt).
    const gamesCall = $queryRaw.mock.calls[1]!;
    expect(sqlOf(gamesCall)).toContain('r."submittedAt" IS NOT NULL OR r.game = ?');
    expect(gamesCall).toContain('matcher');
    expect(gamesCall).toContain('2026-11-12');
    // Thưởng mời bạn đơn đầu: cùng kỳ 00:00 VN ngày đầu tới lúc xem.
    expect(dto.referralFirstOrder).toEqual({ rewarded: 9, blocked: { ...NO_BLOCKS, IP: 4, ADDRESS: 1 } });
    expect(findMany.mock.calls[0]![0].where.createdAt).toEqual({ gte: new Date('2026-11-11T17:00:00.000Z'), lte: now });
    expect($queryRaw.mock.calls[4]!).toEqual(expect.arrayContaining(['referral_first_order_blocked', '2026-11-11T17:00:00.000Z', now.toISOString()]));
    // Lượt gửi link mời: chỉ hai cách gửi đã biết, dòng thiếu cách gửi bị bỏ.
    expect(dto.referralShares).toEqual({ share: 6, copy: 2 });
    expect($queryRaw.mock.calls[5]!).toEqual(expect.arrayContaining(['green_card_shared', '2026-11-11T17:00:00.000Z', now.toISOString()]));
    // Lượt bấm lọc theo giờ máy chủ nhận: occurredAt do máy khách gửi, đồng hồ lệch thì rơi khỏi khung.
    const shareSql = ($queryRaw.mock.calls[5]![0] as TemplateStringsArray).join('?');
    expect(shareSql).toContain('e."receivedAt" >=');
    expect(shareSql).not.toContain('occurredAt');
    // Tin nào ra đơn: cùng kỳ 00:00 VN ngày đầu tới lúc xem; trần tin chủ động mặc định tắt.
    expect($queryRaw.mock.calls[6]!).toEqual(expect.arrayContaining(['2026-11-11T17:00:00.000Z', now.toISOString()]));
    expect(dto.remarketing?.proactiveCap).toBeNull();
    expect(dto.remarketing?.rows[0]).toEqual({ notice: 'abandoned_cart', sent: 40, znsSent: 12, znsCapped: 3, znsMonthlyCapped: 1, orders: 5, revenue: 1_250_000 });
  });

  it('30 ngày: lấy cửa sổ d30 của phễu và 30 điểm theo ngày', async () => {
    const { svc } = makeService([[], [], [], [], [], [], [], [], []]);
    const dto = await svc.overview(30, now);
    expect(dto.sinceDay).toBe('2026-10-20');
    expect(dto.funnel).toEqual(funnel.windows.d30);
    expect(dto.daily).toHaveLength(30);
    expect(dto.repeat).toEqual({ buyers: 0, returningBuyers: 0, newBuyers: 0, newBuyersWithSecond: 0 });
    expect(dto.games).toEqual({ players: 0, buyers: 0, byGame: [] });
    expect(dto.referralFirstOrder).toEqual({ rewarded: 0, blocked: NO_BLOCKS });
    expect(dto.referralShares).toEqual({ share: 0, copy: 0 });
    expect(dto.remarketing?.rows.map((r) => r.orders)).toEqual([0, 0, 0, 0, 0]);
  });

  it('bảng Tin nào ra đơn lỗi: trả null, phễu và các số khác vẫn trả về', async () => {
    const { svc, $queryRaw } = makeService([[], [], [], [], [], [{ method: 'share', n: 1n }]]);
    $queryRaw.mockRejectedValueOnce(new Error('statement timeout'));
    const dto = await svc.overview(7, now);
    expect(dto.remarketing).toBeNull();
    expect(dto.referralShares).toEqual({ share: 1, copy: 0 });
    expect(dto.funnel).toEqual(funnel.windows.d7);
  });

  it('đệm 60 giây theo từng kỳ; lỗi thì lần sau tính lại', async () => {
    const { svc, $queryRaw } = makeService([[], [], [], [], [], [], [], [], []]);
    await svc.overview(7, now);
    await svc.overview(7, new Date(now.getTime() + 59_000));
    expect($queryRaw).toHaveBeenCalledTimes(9);
    $queryRaw.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.overview(30, now)).rejects.toThrow('db down');
    $queryRaw.mockResolvedValue([]);
    await expect(svc.overview(30, now)).resolves.toMatchObject({ days: 30 });
    await svc.overview(7, new Date(now.getTime() + 61_000));
    expect($queryRaw.mock.calls.length).toBe(9 + 1 + 9 + 9);
  });
});

describe('vnDayRange', () => {
  it('liệt kê ngày qua cuối tháng, gồm cả hai đầu', () => {
    expect(vnDayRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(vnDayRange('2026-11-02', '2026-11-02')).toEqual(['2026-11-02']);
  });
});

describe('toGrowthWindowDays', () => {
  it('chỉ 30 (số hoặc chuỗi) là 30 ngày; mọi giá trị khác là 7', () => {
    expect(toGrowthWindowDays('30')).toBe(30);
    expect(toGrowthWindowDays(30)).toBe(30);
    for (const v of ['7', undefined, '', '90', 'abc', null, 31]) expect(toGrowthWindowDays(v)).toBe(7);
  });
});
