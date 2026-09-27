import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AffiliateService, CTV_MONTHLY_MILESTONES } from './affiliate.service';
import { CTV_TIERS, milestoneProgressPct, vnMonthBounds } from './ctv-milestones';
import { CoinsService } from '../wallet/coins.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

function makeService(prisma: unknown, coins?: unknown) {
  const pricing = {} as unknown as PricingService;
  const pancake = {} as unknown as PancakeOrderService;
  const coinsSvc = (coins ?? { grantCoins: jest.fn().mockResolvedValue(undefined) }) as CoinsService;
  // Không test nào ở file này chạm recordTouch/placeOrderForCustomer (chỉ getCtvTiers/
  // getMilestones/claimMilestone) — no-op mặc định, chỉ để đủ tham số bắt buộc thứ 6 (Task 10).
  const analytics = {
    record: jest.fn().mockResolvedValue(undefined),
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  } as unknown as AnalyticsEventsService;
  return new AffiliateService(prisma as PrismaService, config, pricing, pancake, coinsSvc, analytics);
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

// 2026-09-30 18:00 UTC = 2026-10-01 01:00 giờ VN → tháng VN là 10, KHÔNG phải 09 (giờ máy chủ UTC).
const NOW_VN_OCT = new Date('2026-09-30T18:00:00.000Z');
// Giữa tháng 9 giờ VN — dùng cho đa số test.
const NOW_SEP = new Date('2026-09-15T05:00:00.000Z');

/** where "doanh số đã chốt" dùng chung mọi nơi — chỉ commission không thể đảo nữa. */
function expectConfirmedWhere(where: Record<string, unknown>, start: Date, end: Date) {
  expect(where.status).toEqual({ in: ['APPROVED', 'PAID'] });
  expect(where.approvedAt).toEqual({ gte: start, lt: end });
  // KHÔNG còn lọc theo createdAt + "khác REJECTED" (PENDING của đơn còn huỷ được lọt vào).
  expect(where.createdAt).toBeUndefined();
}

describe('vnMonthBounds (tháng theo giờ VN, độc lập TZ máy chủ)', () => {
  it('01:00 ngày 1/10 giờ VN (= 18:00 30/9 UTC) thuộc tháng 2026-10', () => {
    const m = vnMonthBounds(NOW_VN_OCT);
    expect(m.key).toBe('2026-10');
    expect(m.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(m.end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('offset -1 → tháng trước; qua ranh giới năm đúng', () => {
    expect(vnMonthBounds(NOW_VN_OCT, -1).key).toBe('2026-09');
    const jan = vnMonthBounds(new Date('2027-01-10T00:00:00.000Z'), -1);
    expect(jan.key).toBe('2026-12');
    expect(jan.start.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(jan.end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});

describe('milestoneProgressPct', () => {
  it('chưa đạt thì KHÔNG bao giờ hiện 100% (làm tròn lên từng khiến 99,7% hiện thành 100%)', () => {
    expect(milestoneProgressPct(2_990_000, 3_000_000)).toBe(99);
    expect(milestoneProgressPct(2_999_999, 3_000_000)).toBe(99);
  });
  it('đạt/vượt → 100; 0 → 0', () => {
    expect(milestoneProgressPct(3_000_000, 3_000_000)).toBe(100);
    expect(milestoneProgressPct(9_000_000, 3_000_000)).toBe(100);
    expect(milestoneProgressPct(0, 3_000_000)).toBe(0);
  });
});

describe('AffiliateService — CTV Tiers & Milestones', () => {
  describe('getCtvTiers', () => {
    it('bậc theo doanh số ĐÃ CHỐT (commissionableTotal, APPROVED/PAID, approvedAt trong tháng VN)', async () => {
      const aggregate = jest.fn().mockResolvedValue({ _sum: { commissionableTotal: 15_000_000 } });
      const svc = makeService({ commission: { aggregate } });
      const res = await svc.getCtvTiers('ctv-1', NOW_SEP);

      expect(res.revenue).toBe(15_000_000);
      expect(res.tier.name).toBe('Bạc');
      expect(res.tier.nextName).toBe('Vàng');
      expect(res.tier.toNext).toBe(15_000_000);
      const month = vnMonthBounds(NOW_SEP);
      const call = aggregate.mock.calls[0][0];
      expect(call._sum).toEqual({ commissionableTotal: true });
      expectConfirmedWhere(call.where, month.start, month.end);
    });

    it('bảng 5 bậc KHÔNG hứa "+X% bonus" (không có code nào trả bonus) — chỉ nêu thưởng mốc xu thật', async () => {
      const svc = makeService({
        commission: { aggregate: jest.fn().mockResolvedValue({ _sum: { commissionableTotal: 0 } }) },
      });
      const res = await svc.getCtvTiers('ctv-1', NOW_SEP);
      expect(res.allTiers).toHaveLength(5);
      for (const t of res.allTiers) expect(t).not.toHaveProperty('bonusPct');
      expect(res.tier).not.toHaveProperty('bonusPct');
      // Tân binh (0đ) không có mốc; các bậc còn lại khớp đúng mốc thưởng xu cùng ngưỡng.
      expect(res.allTiers[0]!.milestoneRewardXu).toBeNull();
      for (const t of res.allTiers.slice(1)) {
        const m = CTV_MONTHLY_MILESTONES.find((x) => x.threshold === t.min);
        expect(t.milestoneRewardXu).toBe(m!.rewardXu);
      }
      expect(CTV_TIERS.map((t) => t.min)).toEqual([0, 3_000_000, 10_000_000, 30_000_000, 80_000_000]);
    });
  });

  describe('getMilestones', () => {
    function prismaFor(opts: {
      current: number;
      previous?: number;
      pending?: number;
      claims?: { milestoneId: string; monthKey: string }[];
    }) {
      const cur = vnMonthBounds(NOW_SEP);
      const aggregate = jest.fn(async (args: { where: { status: unknown; approvedAt?: { gte: Date } } }) => {
        const st = args.where.status as { in: string[] };
        if (st.in.includes('PENDING')) return { _sum: { commissionableTotal: opts.pending ?? 0 } };
        const isCurrent = args.where.approvedAt?.gte.getTime() === cur.start.getTime();
        return { _sum: { commissionableTotal: isCurrent ? opts.current : (opts.previous ?? 0) } };
      });
      const findMany = jest.fn().mockResolvedValue(opts.claims ?? []);
      return { prisma: { commission: { aggregate }, ctvMilestoneClaim: { findMany } }, aggregate, findMany };
    }

    it('achieved/claimed/canClaim theo doanh số đã chốt + bảng claim (không quét coin_transactions)', async () => {
      const { prisma, findMany } = prismaFor({
        current: 12_000_000,
        pending: 40_000_000,
        claims: [{ milestoneId: 'milestone-3m', monthKey: '2026-09' }],
      });
      const res = await makeService(prisma).getMilestones('ctv-1', NOW_SEP);

      expect(res.monthKey).toBe('2026-09');
      expect(res.currentRevenue).toBe(12_000_000);
      // Doanh số chờ chốt hiển thị riêng, KHÔNG cộng vào điều kiện nhận thưởng.
      expect(res.pendingRevenue).toBe(40_000_000);
      expect(res.holdDays).toBe(20);
      expect(res.milestones).toHaveLength(CTV_MONTHLY_MILESTONES.length);
      expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'ctv-1', monthKey: { in: ['2026-09', '2026-08'] } });

      const byId = Object.fromEntries(res.milestones.map((m) => [m.id, m]));
      expect(byId['milestone-3m']).toMatchObject({ achieved: true, claimed: true, canClaim: false, progressPct: 100 });
      expect(byId['milestone-10m']).toMatchObject({ achieved: true, claimed: false, canClaim: true });
      // 40tr đang chờ chốt KHÔNG làm mốc 30tr đạt.
      expect(byId['milestone-30m']).toMatchObject({ achieved: false, canClaim: false, progressPct: 40 });
      expect(res.previousMonth).toBeNull();
    });

    it('tháng trước còn mốc đạt mà chưa nhận → trả previousMonth để CTV nhận nốt (không mất thưởng khi qua tháng)', async () => {
      const { prisma } = prismaFor({
        current: 0,
        previous: 11_000_000,
        claims: [{ milestoneId: 'milestone-3m', monthKey: '2026-08' }],
      });
      const res = await makeService(prisma).getMilestones('ctv-1', NOW_SEP);
      expect(res.previousMonth?.monthKey).toBe('2026-08');
      expect(res.previousMonth?.revenue).toBe(11_000_000);
      // Chỉ liệt kê mốc còn nhận được (10tr); 3tr đã nhận, 30tr/80tr chưa đạt.
      expect(res.previousMonth?.milestones.map((m) => m.id)).toEqual(['milestone-10m']);
    });
  });

  describe('claimMilestone', () => {
    function txWith(revenue: number, claimCreate = jest.fn().mockResolvedValue({ id: 'claim-1' })) {
      return {
        commission: { aggregate: jest.fn().mockResolvedValue({ _sum: { commissionableTotal: revenue } }) },
        ctvMilestoneClaim: { create: claimCreate },
        user: { update: jest.fn() },
        coinTransaction: { create: jest.fn() },
      };
    }

    it('ném NotFoundException nếu milestoneId không tồn tại', async () => {
      await expect(makeService({}).claimMilestone('ctv-1', 'fake-id')).rejects.toThrow(NotFoundException);
    });

    it('tháng không phải tháng này/tháng trước → BadRequest, không mở transaction', async () => {
      const $transaction = jest.fn();
      await expect(
        makeService({ $transaction }).claimMilestone('ctv-1', 'milestone-3m', '2026-06', NOW_SEP),
      ).rejects.toThrow(BadRequestException);
      expect($transaction).not.toHaveBeenCalled();
    });

    it('chưa đạt ngưỡng (theo doanh số ĐÃ CHỐT) → BadRequest, không tạo claim, không cộng xu', async () => {
      const tx = txWith(1_000_000);
      const coins = { grantCoins: jest.fn() };
      const svc = makeService({ $transaction: jest.fn((cb) => cb(tx)) }, coins);
      await expect(svc.claimMilestone('ctv-1', 'milestone-3m', undefined, NOW_SEP)).rejects.toThrow(
        BadRequestException,
      );
      const month = vnMonthBounds(NOW_SEP);
      expectConfirmedWhere(tx.commission.aggregate.mock.calls[0][0].where, month.start, month.end);
      expect(tx.ctvMilestoneClaim.create).not.toHaveBeenCalled();
      expect(coins.grantCoins).not.toHaveBeenCalled();
    });

    it('đủ điều kiện → ghi claim + cộng TubuXu qua CoinsService.grantCoins CÙNG tx (coinsBalance), KHÔNG đụng walletBalance', async () => {
      const tx = txWith(5_000_000);
      const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) };
      const svc = makeService({ $transaction: jest.fn((cb) => cb(tx)) }, coins);
      const res = await svc.claimMilestone('ctv-1', 'milestone-3m', undefined, NOW_SEP);

      expect(res).toMatchObject({ success: true, rewardXu: 50_000, monthKey: '2026-09' });
      expect(tx.ctvMilestoneClaim.create).toHaveBeenCalledWith({
        data: { userId: 'ctv-1', milestoneId: 'milestone-3m', monthKey: '2026-09', rewardXu: 50_000, revenue: 5_000_000 },
      });
      expect(coins.grantCoins).toHaveBeenCalledWith(
        'ctv-1',
        50_000,
        'CTV_MILESTONE:milestone-3m:2026-09',
        'AFFILIATE_MILESTONE',
        'claim-1',
        tx,
      );
      // Tiền rút được (walletBalance) tuyệt đối không bị cộng.
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('nhận thưởng tháng trước (còn trong hạn) → dùng biên tháng trước', async () => {
      const tx = txWith(3_500_000);
      const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) };
      const svc = makeService({ $transaction: jest.fn((cb) => cb(tx)) }, coins);
      const res = await svc.claimMilestone('ctv-1', 'milestone-3m', '2026-08', NOW_SEP);
      expect(res.monthKey).toBe('2026-08');
      const prev = vnMonthBounds(NOW_SEP, -1);
      expectConfirmedWhere(tx.commission.aggregate.mock.calls[0][0].where, prev.start, prev.end);
      expect(coins.grantCoins.mock.calls[0][2]).toBe('CTV_MILESTONE:milestone-3m:2026-08');
    });

    it('claim trùng (unique userId+milestoneId+monthKey → P2002) → BadRequest "đã nhận", không cộng xu', async () => {
      const tx = txWith(5_000_000, jest.fn().mockRejectedValue(p2002()));
      const coins = { grantCoins: jest.fn() };
      const svc = makeService({ $transaction: jest.fn((cb) => cb(tx)) }, coins);
      await expect(svc.claimMilestone('ctv-1', 'milestone-3m', undefined, NOW_SEP)).rejects.toThrow(
        'Bạn đã nhận thưởng mốc này rồi.',
      );
      expect(coins.grantCoins).not.toHaveBeenCalled();
    });

    /**
     * Mô phỏng Postgres READ COMMITTED + unique index: 2 tx cùng chạy, cả 2 đều đọc "đủ doanh số"
     * trước khi bên nào insert; insert trùng khoá của tx đang bay phải CHỜ tx kia xong — commit
     * → P2002, rollback → insert được. Mỗi tx chỉ áp ghi khi commit. Dùng CoinsService THẬT để
     * chứng minh sổ xu (SUM delta) và coinsBalance luôn khớp nhau.
     */
    it('2 request claim đồng thời → đúng 1 lần cộng xu; ledger == coinsBalance; walletBalance không đổi', async () => {
      const committedKeys = new Set<string>();
      const inflight = new Map<string, Promise<boolean>>(); // key → resolve(true nếu commit)
      const state = { coinsBalance: 0, walletBalance: 0, ledger: [] as number[] };
      const tick = () => new Promise((r) => setImmediate(r));

      const $transaction = async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
        let settle!: (committed: boolean) => void;
        const done = new Promise<boolean>((r) => (settle = r));
        const myKeys: string[] = [];
        const pending = { coins: 0, wallet: 0, ledger: [] as number[] };
        const tx = {
          commission: {
            aggregate: async () => {
              await tick(); // nhường lượt để 2 tx cùng qua bước kiểm tra doanh số
              return { _sum: { commissionableTotal: 90_000_000 } };
            },
          },
          ctvMilestoneClaim: {
            create: async ({ data }: { data: { userId: string; milestoneId: string; monthKey: string } }) => {
              const key = `${data.userId}|${data.milestoneId}|${data.monthKey}`;
              for (;;) {
                if (committedKeys.has(key)) throw p2002();
                const other = inflight.get(key);
                if (!other) break;
                await other; // chờ tx đang giữ khoá unique kết thúc rồi kiểm tra lại
              }
              inflight.set(key, done);
              myKeys.push(key);
              await tick();
              return { id: `claim-${key}` };
            },
          },
          coinTransaction: {
            create: async ({ data }: { data: { delta: number } }) => {
              pending.ledger.push(data.delta);
              return {};
            },
          },
          user: {
            update: async ({ data }: { data: Record<string, { increment: number }> }) => {
              if (data.coinsBalance) pending.coins += data.coinsBalance.increment;
              if (data.walletBalance) pending.wallet += data.walletBalance.increment;
              return {};
            },
          },
        };
        try {
          const out = await cb(tx);
          myKeys.forEach((k) => committedKeys.add(k));
          state.coinsBalance += pending.coins;
          state.walletBalance += pending.wallet;
          state.ledger.push(...pending.ledger);
          return out;
          // lỗi → ném ra nguyên trạng = rollback: mọi ghi đang chờ (pending) bị bỏ
        } finally {
          myKeys.forEach((k) => inflight.delete(k));
          settle(committedKeys.has(myKeys[0] ?? '__none__'));
        }
      };

      const prisma = { $transaction };
      const coins = new CoinsService(prisma as unknown as PrismaService, config);
      const svc = makeService(prisma, coins);

      const results = await Promise.allSettled([
        svc.claimMilestone('ctv-1', 'milestone-80m', undefined, NOW_SEP),
        svc.claimMilestone('ctv-1', 'milestone-80m', undefined, NOW_SEP),
      ]);

      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.reason).toBeInstanceOf(BadRequestException);
      expect(state.coinsBalance).toBe(2_000_000);
      expect(state.ledger.reduce((s, d) => s + d, 0)).toBe(state.coinsBalance);
      expect(state.walletBalance).toBe(0);
    });
  });
});
