import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { createUser, deleteItData, randCode, summarize, warmPool } from './helpers';
import { cleanupWaste, createWasteGift, raceWithHold } from './fixtures/waste-fixtures';

const phone = () => '09' + String(randomInt(10_000_000, 99_999_999));
const key = () => `rk-${randCode(12)}`;
function noDeadlock(results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
}

const SOLD_OUT = 'Quà này đã hết hoặc đã ngừng đổi';

/**
 * LoyaltyService.redeemReward trên Postgres thật: tồn kho quà, số dư vừa đủ và gọi lại cùng khoá.
 */
describe('waste-gift-redeem race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  const userIds: string[] = [];
  const giftIds: string[] = [];

  const newUser = async (pointsBalance: number, withPhone = true) => {
    const u = await createUser(prisma, withPhone ? { pointsBalance, phone: phone() } : { pointsBalance });
    userIds.push(u.id);
    return u;
  };
  const newGift = async (over: Parameters<typeof createWasteGift>[1] = {}) => {
    const g = await createWasteGift(prisma, over);
    giftIds.push(g.id);
    return g;
  };
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { pointsBalance: true } })).pointsBalance;
  const stockOf = async (id: string) => (await prisma.wasteGift.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, LoyaltyService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    loyalty = moduleRef.get(LoyaltyService);
  });

  afterAll(async () => {
    await cleanupWaste(prisma, { giftIds });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  it('stock 1 × 8 người dùng thật đổi cùng lúc → đúng 1 lượt READY, stock 0, 7 lỗi "Quà này đã hết hoặc đã ngừng đổi"', async () => {
    const gift = await newGift({ stock: 1, pointsCost: 10_000 });
    const users = await Promise.all(Array.from({ length: 8 }, () => newUser(100_000)));

    const results = await Promise.allSettled(users.map((u) => loyalty.redeemReward(u.id, gift.id, key())));
    const s = summarize(results);

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(7);
    for (const r of s.rejected) {
      expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((r.reason as BadRequestException).message).toBe(SOLD_OUT);
    }
    expect(await prisma.wasteGiftRedemption.count({ where: { giftId: gift.id } })).toBe(1);
    expect(await prisma.wasteGiftRedemption.count({ where: { giftId: gift.id, status: 'READY' } })).toBe(1);
    expect(await stockOf(gift.id)).toBe(0);
    const balances = await Promise.all(users.map((u) => balanceOf(u.id)));
    expect(balances.reduce((a, b) => a + b, 0)).toBe(790_000);
    noDeadlock(results);
  });

  it('số dư vừa đủ: 30.000 điểm, quà 30.000 điểm, 5 lượt song song khác khoá → 1 thành công, số dư 0, không âm', async () => {
    const u = await newUser(30_000);
    const gift = await newGift({ pointsCost: 30_000, stock: null });

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => loyalty.redeemReward(u.id, gift.id, key())));
    const s = summarize(results);

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(4);
    for (const r of s.rejected) {
      expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((r.reason as BadRequestException).message).toMatch(/Bạn cần 30\.?000 Điểm Xanh/);
    }
    expect(await balanceOf(u.id)).toBe(0);
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id, reason: `GIFT_REDEEM:${gift.id}` } })).toBe(1);
    noDeadlock(results);
  });

  it('cùng khoá ×5 song song → một lượt đổi, trừ một lần, mọi lời gọi trả cùng redemption.id', async () => {
    const u = await newUser(100_000);
    const gift = await newGift({ pointsCost: 10_000, stock: 5 });
    const k = key();

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => loyalty.redeemReward(u.id, gift.id, k)));
    const s = summarize(results);

    expect(s.errors).toEqual([]);
    expect(s.fulfilled).toHaveLength(5);
    expect(new Set(s.fulfilled.map((r) => r.value.redemption.id)).size).toBe(1);
    expect(await balanceOf(u.id)).toBe(90_000);
    expect(await stockOf(gift.id)).toBe(4);
    expect(await prisma.wasteGiftRedemption.count({ where: { giftId: gift.id } })).toBe(1);
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id, reason: `GIFT_REDEEM:${gift.id}` } })).toBe(1);
    noDeadlock(results);
  });

  it('redeem user A then redeem user B (quà còn 1)', async () => {
    const gift = await newGift({ stock: 1, pointsCost: 10_000 });
    const a = await newUser(100_000);
    const b = await newUser(100_000);

    const results = await raceWithHold(
      prisma,
      Prisma.sql`SELECT "id" FROM "waste_gifts" WHERE "id" = ${gift.id} FOR UPDATE`,
      () => loyalty.redeemReward(a.id, gift.id, key()),
      () => loyalty.redeemReward(b.id, gift.id, key()),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    const err = (results[1] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(SOLD_OUT);
    expect(await stockOf(gift.id)).toBe(0);
    expect(await balanceOf(a.id)).toBe(90_000);
    expect(await balanceOf(b.id)).toBe(100_000);
    noDeadlock(results);
  });

  it('redeem user B then redeem user A (quà còn 1)', async () => {
    const gift = await newGift({ stock: 1, pointsCost: 10_000 });
    const a = await newUser(100_000);
    const b = await newUser(100_000);

    const results = await raceWithHold(
      prisma,
      Prisma.sql`SELECT "id" FROM "waste_gifts" WHERE "id" = ${gift.id} FOR UPDATE`,
      () => loyalty.redeemReward(b.id, gift.id, key()),
      () => loyalty.redeemReward(a.id, gift.id, key()),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    const err = (results[1] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(SOLD_OUT);
    expect(await stockOf(gift.id)).toBe(0);
    expect(await balanceOf(b.id)).toBe(90_000);
    expect(await balanceOf(a.id)).toBe(100_000);
    noDeadlock(results);
  });

  it('câu trừ tồn kho: stock null giữ null, 1 về 0, 0 và HIDDEN không trúng', async () => {
    const unlimited = await newGift({ stock: null });
    const last = await newGift({ stock: 1 });
    const empty = await newGift({ stock: 0 });
    const hidden = await newGift({ stock: 5, status: 'HIDDEN' });
    const u = await newUser(1_000_000);

    const outcomes: PromiseSettledResult<unknown>[] = [];
    for (const g of [unlimited, last, empty, hidden]) {
      const [r] = await Promise.allSettled([loyalty.redeemReward(u.id, g.id, key())]);
      outcomes.push(r!);
    }

    expect(outcomes[0]!.status).toBe('fulfilled');
    expect(outcomes[1]!.status).toBe('fulfilled');
    for (const r of [outcomes[2]!, outcomes[3]!]) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
      expect(((r as PromiseRejectedResult).reason as BadRequestException).getStatus()).toBe(400);
    }
    expect(await stockOf(unlimited.id)).toBeNull();
    expect(await stockOf(last.id)).toBe(0);
    expect(await stockOf(empty.id)).toBe(0);
    expect(await stockOf(hidden.id)).toBe(5);
    noDeadlock(outcomes);
  });

  it('voucher hết tồn kho đổi thẳng (danh sách cũ trong bộ nhớ đệm) → 400, không trừ điểm', async () => {
    const gift = await newGift({ kind: 'VOUCHER', pointsCost: 20_000, stock: 0, voucherType: 'FREESHIP', voucherValue: 0, voucherValidDays: 30 });
    const u = await newUser(100_000, false);

    const [r] = await Promise.allSettled([loyalty.redeemReward(u.id, gift.id, key())]);

    expect(r!.status).toBe('rejected');
    const err = (r as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(SOLD_OUT);
    expect(await balanceOf(u.id)).toBe(100_000);
    const coupons = await prisma.coupon.count({ where: { scopeMeta: { path: ['userId'], equals: u.id } } });
    expect(coupons).toBe(0);
  });

  it('đã trừ tồn kho rồi thiếu điểm → cả giao dịch huỷ: tồn kho giữ nguyên, không có lượt đổi, số dư nguyên', async () => {
    const gift = await newGift({ stock: 2, pointsCost: 30_000 });
    const u = await newUser(10_000);

    await expect(loyalty.redeemReward(u.id, gift.id, key())).rejects.toThrow(/Bạn cần 30\.?000 Điểm Xanh/);

    expect(await stockOf(gift.id)).toBe(2);
    expect(await prisma.wasteGiftRedemption.count({ where: { giftId: gift.id } })).toBe(0);
    expect(await balanceOf(u.id)).toBe(10_000);
  });
});
