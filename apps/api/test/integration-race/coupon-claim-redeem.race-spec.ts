import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CouponClaimService } from '../../src/modules/coupons/coupon-claim.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createRealUser, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Nhận mã thẻ (`CouponClaimService.claim`) và ghi nhận dùng mã (`CouponsService.redeem`/`release`) trên Postgres thật. Chỗ giữ lượt
 * là khoá advisory theo mã (nhận) và theo (mã, khách) (dùng), cộng `updateMany usedCount < usageLimit` và unique `(mã, khách)` /
 * `(mã, đơn)`. `RaceDb` giả khoá advisory bằng handler nên không chứng minh được khoá thật; spec này dùng cùng service trên DB thật.
 */
describe('Nhận mã thẻ và dùng mã song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let claim: CouponClaimService;
  let coupons: CouponsService;
  const created: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [CouponClaimService, CouponsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    claim = moduleRef.get(CouponClaimService);
    coupons = moduleRef.get(CouponsService);
  });

  // Mã PUBLIC còn hiệu lực làm đầy danh sách xem trước của khách khác: spec chạy sau (coupon-preview-equals-quote) tìm mã của nó
  // trong danh sách có trần nên phải dọn hết mã của spec này.
  afterAll(async () => {
    await prisma?.couponRedemption.deleteMany({ where: { couponId: { in: created } } });
    await prisma?.coupon.deleteMany({ where: { id: { in: created } } });
    await moduleRef?.close();
  });

  async function makeCoupon(data: Partial<Prisma.CouponUncheckedCreateInput> = {}) {
    const coupon = await prisma.coupon.create({
      data: {
        code: `IT-${randCode(10)}`.toUpperCase(),
        type: 'AMOUNT',
        value: 30000,
        minOrder: null,
        startAt: new Date(Date.now() - 3600_000),
        endAt: new Date(Date.now() + 30 * 864e5),
        scope: 'PUBLIC',
        perUserLimit: 1,
        ...data,
      },
    });
    created.push(coupon.id);
    return coupon;
  }

  const realUsers = (n: number) => Promise.all(Array.from({ length: n }, () => createRealUser(prisma)));
  const claimRows = (couponId: string) => prisma.couponClaim.count({ where: { couponId } });
  const redemptionRows = (couponId: string) => prisma.couponRedemption.count({ where: { couponId } });
  const usedOf = async (couponId: string) => (await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } })).usedCount;

  describe('CouponClaimService.claim', () => {
    it('thẻ riêng (tổng 1 lượt) 8 khách cùng quét: đúng 1 người nhận, 7 báo đã có tài khoản khác nhận, đúng 1 dòng', async () => {
      const c = await makeCoupon({ scope: 'CLAIM', usageLimit: 1 });
      const users = await realUsers(8);
      const s = summarize(await Promise.allSettled(users.map((u) => claim.claim(u.id, c.code))));
      expect(s.fulfilled).toHaveLength(1);
      expect(s.rejected).toHaveLength(7);
      for (const e of s.errors) expect(e).toContain('Mã giảm giá này đã được tài khoản khác nhận.');
      expect(await claimRows(c.id)).toBe(1);
    });

    it('mã chung tổng 3 lượt, 10 khách cùng nhận: đúng 3 người nhận, 7 báo hết lượt nhận, đúng 3 dòng', async () => {
      const c = await makeCoupon({ scope: 'CLAIM', usageLimit: 3 });
      const users = await realUsers(10);
      const s = summarize(await Promise.allSettled(users.map((u) => claim.claim(u.id, c.code))));
      expect(s.fulfilled).toHaveLength(3);
      for (const e of s.errors) expect(e).toContain('Mã giảm giá đã hết lượt nhận.');
      expect(await claimRows(c.id)).toBe(3);
    });

    it('cùng một khách nhận 8 lần song song (tổng 5 lượt): không lượt nào lỗi, đúng 1 dòng, các lượt sau báo đã nhận', async () => {
      const c = await makeCoupon({ scope: 'CLAIM', usageLimit: 5 });
      const [u] = await realUsers(1);
      const s = summarize(await Promise.allSettled(Array.from({ length: 8 }, () => claim.claim(u!.id, c.code))));
      expect(s.errors).toEqual([]);
      expect(await claimRows(c.id)).toBe(1);
    });

    it('mã không giới hạn tổng lượt: 10 khách đều nhận đủ 10 dòng, một khách nhận 6 lần song song chỉ có 1 dòng', async () => {
      const c = await makeCoupon({ scope: 'CLAIM' });
      const users = await realUsers(10);
      expect(summarize(await Promise.allSettled(users.map((u) => claim.claim(u.id, c.code)))).errors).toEqual([]);
      expect(await claimRows(c.id)).toBe(10);
      const d = await makeCoupon({ scope: 'CLAIM' });
      expect(summarize(await Promise.allSettled(Array.from({ length: 6 }, () => claim.claim(users[0]!.id, d.code)))).errors).toEqual([]);
      expect(await claimRows(d.id)).toBe(1);
    });

    it('gõ mã thẻ ở giỏ (claimHiddenForCart) 6 lần song song cùng khách (tổng 2 lượt): không lỗi, đúng 1 dòng', async () => {
      const c = await makeCoupon({ scope: 'CLAIM', usageLimit: 2 });
      const [u] = await realUsers(1);
      const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => claim.claimHiddenForCart(u!.id, c.code))));
      expect(s.errors).toEqual([]);
      expect(await claimRows(c.id)).toBe(1);
    });

    it('tài khoản khách vãng lai không giữ chỗ: 3 lượt song song đều bị từ chối, không có dòng nào', async () => {
      const c = await makeCoupon({ scope: 'CLAIM', usageLimit: 1 });
      const guest = await createUser(prisma, { zaloId: `guest_${randCode(8)}` });
      const s = summarize(await Promise.allSettled(Array.from({ length: 3 }, () => claim.claim(guest.id, c.code))));
      expect(s.fulfilled).toHaveLength(0);
      expect(await claimRows(c.id)).toBe(0);
    });
  });

  describe('CouponsService.redeem / release', () => {
    it('tổng 3 lượt dùng, 8 đơn của 8 khách đặt cùng lúc: đúng 3 đơn ghi nhận, 5 đơn báo hết lượt, usedCount = số dòng = 3', async () => {
      const c = await makeCoupon({ usageLimit: 3 });
      const users = await realUsers(8);
      const s = summarize(await Promise.allSettled(users.map((u, i) => coupons.redeem(c.code, u.id, `ord-${c.id}-${i}`))));
      expect(s.fulfilled).toHaveLength(3);
      for (const e of s.errors) expect(e).toContain('Mã giảm giá đã hết lượt sử dụng.');
      expect(await usedOf(c.id)).toBe(3);
      expect(await redemptionRows(c.id)).toBe(3);
    });

    // perUserLimit 0 = không giới hạn theo khách nên không có khoá (mã, khách) xếp hàng: chỉ ON CONFLICT DO NOTHING giữ một dòng.
    it.each([1, 0])('cùng một đơn ghi nhận 6 lần song song (retry), perUserLimit %i: mọi lượt thành công, đúng 1 dòng, usedCount 1', async (perUserLimit) => {
      const c = await makeCoupon({ usageLimit: 5, perUserLimit });
      const [u] = await realUsers(1);
      const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => coupons.redeem(c.code, u!.id, `ord-${c.id}-same`))));
      expect(s.errors).toEqual([]);
      expect(await redemptionRows(c.id)).toBe(1);
      expect(await usedOf(c.id)).toBe(1);
    });

    it('mỗi khách 1 lượt (perUserLimit 1): một khách đặt 6 đơn khác nhau cùng lúc → đúng 1 đơn dùng được mã, 5 đơn báo hết lượt', async () => {
      const c = await makeCoupon({ perUserLimit: 1 });
      const [u] = await realUsers(1);
      const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, (_, i) => coupons.redeem(c.code, u!.id, `ord-${c.id}-${i}`))));
      expect(s.fulfilled).toHaveLength(1);
      for (const e of s.errors) expect(e).toContain('Bạn đã dùng hết lượt cho mã này.');
      expect(await redemptionRows(c.id)).toBe(1);
    });

    it('hoàn mã của cùng một đơn 5 lần song song: usedCount chỉ giảm 1, không âm, dòng ghi nhận của đơn kia còn nguyên', async () => {
      const c = await makeCoupon({ usageLimit: 5, perUserLimit: 0 });
      const [u] = await realUsers(1);
      await coupons.redeem(c.code, u!.id, `ord-${c.id}-a`);
      await coupons.redeem(c.code, u!.id, `ord-${c.id}-b`);
      expect(await usedOf(c.id)).toBe(2);
      await Promise.all(Array.from({ length: 5 }, () => coupons.release(c.code, `ord-${c.id}-a`)));
      expect(await usedOf(c.id)).toBe(1);
      expect(await redemptionRows(c.id)).toBe(1);
    });

    it('lượt cuối còn lại: hoàn mã của đơn A cùng lúc đơn C tranh lượt → usedCount luôn bằng số dòng và không vượt tổng lượt', async () => {
      const c = await makeCoupon({ usageLimit: 2, perUserLimit: 0 });
      const users = await realUsers(3);
      await coupons.redeem(c.code, users[0]!.id, `ord-${c.id}-a`);
      await coupons.redeem(c.code, users[1]!.id, `ord-${c.id}-b`);
      await Promise.allSettled([
        coupons.release(c.code, `ord-${c.id}-a`),
        coupons.redeem(c.code, users[2]!.id, `ord-${c.id}-c`),
      ]);
      const used = await usedOf(c.id);
      expect(used).toBe(await redemptionRows(c.id));
      expect(used).toBeLessThanOrEqual(2);
    });
  });
});
