import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CouponClaimService } from '../../src/modules/coupons/coupon-claim.service';
import { CouponCollectService } from '../../src/modules/coupons/coupon-collect.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Kho mã (P14) trên Postgres thật: nhận lượt cuối của mã `listed` song song không vượt tổng lượt, và `/coupons/collectable`
 * thôi trả mã đã hết lượt. CouponClaimService + CouponCollectService là bản thật. Ràng buộc DB coupons_listed_claim_only_chk
 * chặn bật `listed` trên mã lô thẻ in hoặc mã không phải CLAIM, kể cả khi service bị bỏ qua.
 */
describe('coupon-collectable-last-slot: kho mã (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let claims: CouponClaimService;
  let collect: CouponCollectService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [CouponClaimService, CouponCollectService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    claims = moduleRef.get(CouponClaimService);
    collect = moduleRef.get(CouponCollectService);
  });

  afterAll(async () => {
    // Mã nằm lại sẽ lọt vào /coupons/collectable của spec khác dùng chung DB race.
    if (createdIds.length > 0) await prisma?.coupon.deleteMany({ where: { id: { in: createdIds } } });
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const realUser = () => createUser(prisma, { phone: phone() });

  async function coupon(data: Partial<Parameters<PrismaService['coupon']['create']>[0]['data']> = {}) {
    const now = Date.now();
    const c = await prisma.coupon.create({
      data: {
        code: `KM${randCode(8)}`,
        title: 'Giảm 30K',
        type: 'AMOUNT',
        value: 30_000,
        minOrder: 50_000,
        startAt: new Date(now - 3_600_000),
        endAt: new Date(now + 86_400_000),
        usageLimit: 1,
        perUserLimit: 1,
        scope: 'CLAIM',
        listed: true,
        ...data,
      },
    });
    createdIds.push(c.id);
    return c;
  }

  const collectableCodes = async () => (await collect.collectable()).map((c) => c.code);

  describe('nhận lượt cuối', () => {
    it('mã listed còn 1 lượt, hai khách nhận song song → đúng 1 thành công, không vượt lượt, mã rời khỏi collectable', async () => {
      const c = await coupon({ usageLimit: 1 });
      expect(await collectableCodes()).toContain(c.code);
      const [a, b] = await Promise.all([realUser(), realUser()]);
      const s = summarize(await Promise.allSettled([claims.claim(a.id, c.code), claims.claim(b.id, c.code)]));
      expect(s.fulfilled).toHaveLength(1);
      expect(s.errors).toEqual(['BadRequestException: Mã giảm giá này đã được tài khoản khác nhận.']);
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(1);
      expect(await collectableCodes()).not.toContain(c.code);
    });

    it('mã listed 3 lượt đã nhận 2, sáu khách nhận song song → đúng 1 người nhận thêm, tổng đúng 3', async () => {
      const c = await coupon({ usageLimit: 3 });
      const [first, second] = await Promise.all([realUser(), realUser()]);
      await prisma.couponClaim.createMany({ data: [first, second].map((u) => ({ couponId: c.id, userId: u.id })) });
      const rows = (await collect.collectable()).filter((x) => x.code === c.code);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ claimedCount: 2, usageLimit: 3 });

      const users = await Promise.all(Array.from({ length: 6 }, () => realUser()));
      const s = summarize(await Promise.allSettled(users.map((u) => claims.claim(u.id, c.code))));
      expect(s.fulfilled).toHaveLength(1);
      expect(new Set(s.errors)).toEqual(new Set(['BadRequestException: Mã giảm giá đã hết lượt nhận.']));
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(3);
      expect(await collectableCodes()).not.toContain(c.code);
    });

    it('một khách bấm Nhận hai lần song song trên mã còn lượt → cả hai trả về, chỉ một dòng nhận', async () => {
      const c = await coupon({ usageLimit: 5 });
      const u = await realUser();
      const s = summarize(await Promise.allSettled([claims.claim(u.id, c.code), claims.claim(u.id, c.code)]));
      expect(s.errors).toEqual([]);
      expect(s.fulfilled.filter((r) => !r.value.alreadyClaimed)).toHaveLength(1);
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(1);
    });
  });

  describe('collectable chỉ trả mã đang nhận được', () => {
    it('mã chưa listed, hết hạn, chưa tới giờ bắt đầu hoặc đã tắt không xuất hiện; mã listed hợp lệ xuất hiện', async () => {
      const now = Date.now();
      const ok = await coupon({ usageLimit: null });
      const notListed = await coupon({ listed: false });
      const expired = await coupon({ endAt: new Date(now - 1_000), startAt: new Date(now - 86_400_000) });
      const future = await coupon({ startAt: new Date(now + 3_600_000), endAt: new Date(now + 86_400_000) });
      const off = await coupon({ isActive: false });
      const codes = await collectableCodes();
      expect(codes).toContain(ok.code);
      for (const hidden of [notListed, expired, future, off]) expect(codes).not.toContain(hidden.code);
    });
  });

  describe('ràng buộc DB coupons_listed_claim_only_chk', () => {
    it('bật listed trên mã có lô thẻ in → DB từ chối', async () => {
      const c = await coupon({ listed: false, batch: `LOT-${randCode(6)}` });
      await expect(prisma.coupon.update({ where: { id: c.id }, data: { listed: true } })).rejects.toThrow(/coupons_listed_claim_only_chk/);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).listed).toBe(false);
    });

    it('bật listed trên mã scope PUBLIC → DB từ chối', async () => {
      const c = await coupon({ listed: false, scope: 'PUBLIC' });
      await expect(prisma.coupon.update({ where: { id: c.id }, data: { listed: true } })).rejects.toThrow(/coupons_listed_claim_only_chk/);
    });

    it('tạo thẳng mã listed có lô thẻ in → DB từ chối', async () => {
      await expect(coupon({ listed: true, batch: `LOT-${randCode(6)}` })).rejects.toThrow(/coupons_listed_claim_only_chk/);
    });

    it('mã CLAIM không có lô thẻ bật listed được', async () => {
      const c = await coupon({ listed: false });
      const updated = await prisma.coupon.update({ where: { id: c.id }, data: { listed: true } });
      expect(updated.listed).toBe(true);
    });
  });
});
