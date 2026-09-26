import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService, DEFAULT_REWARD_CATALOG } from '../../src/modules/loyalty/loyalty.service';
import { barrierOnFirstCalls, createOrder, createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * LoyaltyService trên Postgres thật: điểm danh, đổi quà, tích điểm POS dưới N request đồng thời.
 */
describe('LoyaltyService race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;

  const MEMBER_DAILY_CAP = 100;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, LoyaltyService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    loyalty = moduleRef.get(LoyaltyService);

    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'loyalty.pos_credit_enabled', true);
    await setConfig(prisma, 'loyalty.pos_member_daily_points_cap', MEMBER_DAILY_CAP);
    await setConfig(prisma, 'loyalty.pos_staff_daily_points_cap', 3000);
    await setConfig(prisma, 'loyalty.pos_max_order_total', 5_000_000);
    await setConfig(prisma, 'loyalty.vnd_per_point', 10000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('(a) dailyCheckIn: 10 concurrent calls by one user -> exactly 1 check-in, 1 ledger row, balance +once', async () => {
    const user = await createUser(prisma, { pointsBalance: 0 });

    // Rào chắn: cả 10 cùng chạy pre-check lastCheckIn (findFirst ngoài tx) → đều thấy "chưa điểm
    // danh" → cả 10 mở transaction ghi. Đếm $transaction = 10 chứng minh chính unique DB
    // (loyalty_check_ins userId+dayKey) chặn 9 kẻ thua, không phải pre-check.
    const gate = barrierOnFirstCalls(prisma.loyaltyCheckIn, 'findFirst', 10);
    const txSpy = jest.spyOn(prisma, '$transaction');
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => loyalty.dailyCheckIn(user.id)));
    const txCalls = txSpy.mock.calls.length;
    txSpy.mockRestore();
    gate.mockRestore();
    const s = summarize(results);

    const checkIns = await prisma.loyaltyCheckIn.findMany({ where: { userId: user.id } });
    const ledger = await prisma.pointsTransaction.findMany({ where: { userId: user.id, refType: 'CHECKIN' } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    // eslint-disable-next-line no-console
    console.log('[a] fulfilled=%d rejected=%d txOpened=%d errors=%j', s.fulfilled.length, s.rejected.length, txCalls, [...new Set(s.errors)]);

    expect(txCalls).toBe(10); // cả 10 lọt pre-check → race thật sự chạm unique DB
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(9);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(checkIns).toHaveLength(1);
    expect(ledger).toHaveLength(1);
    const earned = s.fulfilled[0]!.value.pointsEarned;
    expect(earned).toBeGreaterThan(0);
    expect(ledger[0]!.delta).toBe(earned);
    expect(after.pointsBalance).toBe(earned);
  });

  it('(b) redeemReward: exactly enough points for one reward, 5 concurrent redeems -> 1 coupon, balance 0', async () => {
    const reward = DEFAULT_REWARD_CATALOG.find((r) => r.id === 'reward-discount-50k')!;
    const user = await createUser(prisma, { pointsBalance: reward.pointsCost });

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => loyalty.redeemReward(user.id, reward.id)));
    const s = summarize(results);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const coupons = await prisma.coupon.findMany({ where: { scopeMeta: { path: ['userId'], equals: user.id } } });
    const ledger = await prisma.pointsTransaction.findMany({
      where: { userId: user.id, reason: { startsWith: 'LOYALTY_REDEEM_VOUCHER:' } },
    });

    // eslint-disable-next-line no-console
    console.log('[b] fulfilled=%d rejected=%d balance=%d errors=%j', s.fulfilled.length, s.rejected.length, after.pointsBalance, [...new Set(s.errors)]);

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(4);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(coupons).toHaveLength(1);
    expect(ledger).toHaveLength(1);
    expect(after.pointsBalance).toBe(0);
    expect(after.pointsBalance).toBeGreaterThanOrEqual(0);
  });

  it('(d) redeemReward: điểm đơn còn có thể bị trả hàng bị khoá (SQL thật) + 5 request song song không đụng phần khoá', async () => {
    const reward = DEFAULT_REWARD_CATALOG.find((r) => r.id === 'reward-discount-50k')!; // 50 điểm
    const user = await createUser(prisma, { pointsBalance: 150 });
    const DAY = 864e5;
    const now = Date.now();
    const credit = async (
      status: 'DELIVERED' | 'RETURNED',
      deliveredDaysAgo: number,
      points: number,
      extra: { openReturn?: boolean; reversed?: boolean } = {},
    ) => {
      const deliveredAt = new Date(now - deliveredDaysAgo * DAY);
      const o = await createOrder(prisma, { userId: user.id, status, deliveredAt, pointsEarned: points, paymentStatus: 'PAID' });
      await prisma.pointsTransaction.create({
        data: { userId: user.id, delta: points, reason: `ORDER_DELIVERED:${o.code}`, refType: 'ORDER', refId: o.id, createdAt: deliveredAt },
      });
      if (extra.reversed) {
        await prisma.pointsTransaction.create({
          data: { userId: user.id, delta: -points, reason: `ORDER_REVERSED:${o.code}`, refType: 'ORDER', refId: o.id },
        });
      }
      if (extra.openReturn) {
        await prisma.returnRequest.create({ data: { orderId: o.id, userId: user.id, reason: 'Hàng lỗi' } });
      }
      return o;
    };
    await credit('DELIVERED', 2, 60); // còn trong hạn đổi/trả 7 ngày → KHOÁ
    await credit('DELIVERED', 30, 40); // hết hạn → dùng được
    await credit('DELIVERED', 30, 30, { openReturn: true }); // hết hạn nhưng đang có yêu cầu đổi/trả → KHOÁ
    await credit('RETURNED', 3, 20, { reversed: true }); // đã trả + đã trừ điểm → không khoá nữa
    await credit('RETURNED', 3, 15); // đã trả, reverseOrderPoints CHƯA chạy → KHOÁ

    const ov = await loyalty.getOverview(user.id);
    expect(ov).toMatchObject({ pointsBalance: 150, lockedPoints: 105, lockedReturnPoints: 45, redeemablePoints: 45 });
    // Chỉ đơn trong hạn đổi/trả mới có mốc ngày: giao 2 ngày trước + 7 ngày.
    expect(Math.abs(new Date(ov.lockedUntil!).getTime() - (now + 5 * DAY))).toBeLessThan(5_000);

    // Dùng được 45 < 50 → từ chối rõ ràng, không trừ gì.
    await expect(loyalty.redeemReward(user.id, reward.id)).rejects.toThrow(/60 điểm từ đơn mới giao sẽ dùng được sau ngày/);

    // Cộng thêm 60 điểm "cũ" (không khoá) → dùng được 105 → 5 request song song đổi quà 50: đúng 2 thành công.
    await prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: 60 } } });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => loyalty.redeemReward(user.id, reward.id)));
    const s = summarize(results);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    // eslint-disable-next-line no-console
    console.log('[d] fulfilled=%d rejected=%d balance=%d errors=%j', s.fulfilled.length, s.rejected.length, after.pointsBalance, [...new Set(s.errors)]);

    expect(s.fulfilled).toHaveLength(2);
    expect(s.rejected).toHaveLength(3);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(after.pointsBalance).toBe(110); // 210 − 2×50; KHÔNG đụng 105 điểm đang khoá
    expect(after.pointsBalance).toBeGreaterThanOrEqual(105);
  });

  it('(c1) creditPosPoints: 5 concurrent credits with the same receiptId -> 1 pos_point_credits row, points once', async () => {
    const staff = await createUser(prisma, { role: 'STAFF' });
    const member = await createUser(prisma, { pointsBalance: 0 });
    const receiptId = `RC-SAME-${member.id}`;
    const orderTotal = 300_000; // 30 điểm ở 10.000đ/điểm, hệ số 1

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        loyalty.creditPosPoints(staff.id, { memberCode: `TUBU${member.referralCode}`, orderTotal, receiptId }),
      ),
    );
    const s = summarize(results);

    const credits = await prisma.posPointCredit.findMany({ where: { receiptId } });
    const ledger = await prisma.pointsTransaction.findMany({ where: { userId: member.id, refType: 'POS' } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });

    // eslint-disable-next-line no-console
    console.log(
      '[c1] fulfilled=%d rejected=%d replayed=%j errors=%j',
      s.fulfilled.length,
      s.rejected.length,
      s.fulfilled.map((f) => f.value.replayed),
      [...new Set(s.errors)],
    );

    expect(credits).toHaveLength(1);
    expect(ledger).toHaveLength(1);
    expect(credits[0]!.points).toBe(30);
    expect(after.pointsBalance).toBe(30);
    // Idempotent replay: mọi request cùng hoá đơn đều thành công, chỉ 1 cái thật sự cộng.
    expect(s.fulfilled).toHaveLength(5);
    expect(s.fulfilled.filter((f) => !f.value.replayed)).toHaveLength(1);
  });

  it('(c2) creditPosPoints: concurrent credits with different receipts exceeding member daily cap -> total <= cap', async () => {
    const staff = await createUser(prisma, { role: 'STAFF' });
    const member = await createUser(prisma, { pointsBalance: 0 });
    const orderTotal = 300_000; // 30 điểm/hoá đơn; 6 hoá đơn = 180 > cap 100 → tối đa 3 hoá đơn (90)
    const N = 6;

    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        loyalty.creditPosPoints(staff.id, {
          memberCode: `TUBU${member.referralCode}`,
          orderTotal,
          receiptId: `RC-CAP-${member.id}-${i}`,
        }),
      ),
    );
    const s = summarize(results);

    const agg = await prisma.posPointCredit.aggregate({ where: { memberId: member.id }, _sum: { points: true }, _count: true });
    const ledgerAgg = await prisma.pointsTransaction.aggregate({
      where: { userId: member.id, refType: 'POS' },
      _sum: { delta: true },
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    const total = agg._sum.points ?? 0;

    // eslint-disable-next-line no-console
    console.log('[c2] fulfilled=%d rejected=%d credited=%d cap=%d errors=%j', s.fulfilled.length, s.rejected.length, total, MEMBER_DAILY_CAP, [...new Set(s.errors)]);

    expect(total).toBeLessThanOrEqual(MEMBER_DAILY_CAP);
    expect(total).toBe(90); // cap chặn đúng ở biên: 3 × 30
    expect(agg._count).toBe(3);
    expect(s.fulfilled).toHaveLength(3);
    expect(s.rejected).toHaveLength(N - 3);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(ledgerAgg._sum.delta ?? 0).toBe(total);
    expect(after.pointsBalance).toBe(total);
  });
});
