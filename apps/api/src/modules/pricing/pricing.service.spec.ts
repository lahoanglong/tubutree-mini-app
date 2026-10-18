import { pointsForGoods } from './points-earn';
import { firstOrderFreeShipFrom, firstOrderShippingFee, freeShipThreshold, PricingService } from './pricing.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/** Stub SystemConfig với map giá trị cố định. */
function makeConfig(values: Record<string, unknown>): SystemConfigService {
  return {
    get: async <T>(key: string, fallback?: T): Promise<T> =>
      (key in values ? values[key] : fallback) as T,
  } as unknown as SystemConfigService;
}

const DEFAULTS = {
  'shipping.free_threshold': 200000,
  'shipping.flat_fee_below_threshold': 19000,
  'shipping.tier_freeship_overrides': { LOC_BIEC: 99000, DAI_THU: 0, CO_THU: 0 },
  'loyalty.vnd_per_point': 10000,
  'loyalty.vnd_per_point_redeem': 1000,
  'loyalty.max_redeem_pct': 0.2,
};

describe('PricingService', () => {
  const svc = new PricingService(makeConfig(DEFAULTS));

  describe('calcShippingFee', () => {
    it('miễn phí khi đơn ≥ 200k', async () => {
      expect(await svc.calcShippingFee({ subtotal: 200000 })).toBe(0);
      expect(await svc.calcShippingFee({ subtotal: 350000 })).toBe(0);
    });

    it('thu 19k khi đơn < 200k', async () => {
      expect(await svc.calcShippingFee({ subtotal: 199999 })).toBe(19000);
      expect(await svc.calcShippingFee({ subtotal: 50000 })).toBe(19000);
    });

    it('Lộc Biếc freeship từ 99k', async () => {
      expect(await svc.calcShippingFee({ subtotal: 99000, tierId: 'LOC_BIEC' })).toBe(0);
      expect(await svc.calcShippingFee({ subtotal: 98000, tierId: 'LOC_BIEC' })).toBe(19000);
    });

    it('Cổ Thụ freeship toàn shop', async () => {
      expect(await svc.calcShippingFee({ subtotal: 10000, tierId: 'CO_THU' })).toBe(0);
    });
  });

  describe('calcPointsEarned', () => {
    it('10k = 1 điểm, multiplier 1x', async () => {
      expect(await svc.calcPointsEarned(250000, 1)).toBe(25);
    });
    it('áp multiplier 1.5x (Đại Thụ)', async () => {
      expect(await svc.calcPointsEarned(200000, 1.5)).toBe(30);
    });
    // Miniapp (PDP "Nhận N Điểm Xanh") dùng chung công thức qua pointsForGoods: đổi một bên phải khớp bên kia.
    it('calcPointsEarned đúng bằng pointsForGoods với cấu hình đang dùng, kể cả mốc làm tròn xuống và cấu hình hỏng', async () => {
      for (const vnd of [10000, 7500, 1, 0, -5]) {
        const s = new PricingService(makeConfig({ ...DEFAULTS, 'loyalty.vnd_per_point': vnd }));
        for (const goods of [0, 1, 9999, 10000, 19999, 20000, 249999, 1_000_000]) {
          for (const mult of [undefined, 1, 1.2, 1.5, 2]) {
            expect(await s.calcPointsEarned(goods, mult)).toBe(pointsForGoods(goods, vnd, mult));
          }
        }
      }
    });
    it('pointsForGoods: làm tròn xuống, nhân hệ số hạng, mốc ≤ 0 thì không tích', () => {
      expect(pointsForGoods(19999, 10000)).toBe(1);
      expect(pointsForGoods(19999, 10000, 1.5)).toBe(2);
      expect(pointsForGoods(9999, 10000, 1.2)).toBe(1);
      expect(pointsForGoods(500000, 0, 2)).toBe(0);
    });
  });

  describe('resolvePointsRedemption', () => {
    it('kẹp theo trần 20% giá trị đơn', async () => {
      // đơn 100k → max trừ 20k = 20 điểm; user có 50 điểm, muốn dùng 50 → chỉ 20
      const r = await svc.resolvePointsRedemption(50, 50, 100000);
      expect(r.pointsUsed).toBe(20);
      expect(r.discount).toBe(20000);
    });
    it('kẹp theo số điểm sẵn có', async () => {
      const r = await svc.resolvePointsRedemption(100, 8, 1000000);
      expect(r.pointsUsed).toBe(8);
      expect(r.discount).toBe(8000);
    });
  });

  // PD-3 (spec 2.3): lô STANDARD chịu trần max_redeem_pct, lô CONVERTED (xu cũ) trả tới 100% giá trị hàng.
  describe('resolvePointsRedemptionByLot (PD-3, T8/T9)', () => {
    it('T8: đơn 500.000đ, STANDARD 1.000, CONVERTED 1.000, dùng 1.000 → s = 100, c = 400, giảm đủ 500.000đ', async () => {
      const r = await svc.resolvePointsRedemptionByLot(1000, 1000, 1000, 500000);
      expect(r).toEqual({ pointsUsed: 500, pointsUsedStandard: 100, pointsUsedConverted: 400, discount: 500000 });
    });

    it('T8: phần lẻ dưới 1.000đ không trả bằng điểm (redeemBase 123.456đ → s + c = 123)', async () => {
      const r = await svc.resolvePointsRedemptionByLot(1000, 1000, 1000, 123456);
      expect(r.pointsUsedStandard).toBe(24); // floor(floor(123.456 × 0,2) / 1.000)
      expect(r.pointsUsedConverted).toBe(123 - 24);
      expect(r.discount).toBe(123000);
      expect(r.discount).toBeLessThanOrEqual(123456);
    });

    it('T9: STANDARD tiêu tới trần trước rồi mới tới CONVERTED', async () => {
      const r = await svc.resolvePointsRedemptionByLot(30, 1000, 1000, 100000);
      expect(r).toMatchObject({ pointsUsedStandard: 20, pointsUsedConverted: 10, pointsUsed: 30, discount: 30000 });
    });

    it('T9: dùng ít hơn trần STANDARD → không đụng CONVERTED', async () => {
      const r = await svc.resolvePointsRedemptionByLot(15, 1000, 1000, 100000);
      expect(r).toMatchObject({ pointsUsedStandard: 15, pointsUsedConverted: 0 });
    });

    it('T9: STANDARD dùng được = 0 (đang khoá) → chỉ CONVERTED, vẫn giảm được 100% giá trị hàng', async () => {
      const r = await svc.resolvePointsRedemptionByLot(1000, 0, 1000, 250000);
      expect(r).toEqual({ pointsUsed: 250, pointsUsedStandard: 0, pointsUsedConverted: 250, discount: 250000 });
    });

    it('kẹp theo số dư CONVERTED, không bao giờ âm', async () => {
      const r = await svc.resolvePointsRedemptionByLot(1000, 5, 7, 1000000);
      expect(r).toMatchObject({ pointsUsedStandard: 5, pointsUsedConverted: 7, pointsUsed: 12 });
      const z = await svc.resolvePointsRedemptionByLot(0, 5, 7, 1000000);
      expect(z).toEqual({ pointsUsed: 0, pointsUsedStandard: 0, pointsUsedConverted: 0, discount: 0 });
      const neg = await svc.resolvePointsRedemptionByLot(10, -3, -4, 1000000);
      expect(neg).toEqual({ pointsUsed: 0, pointsUsedStandard: 0, pointsUsedConverted: 0, discount: 0 });
    });

    it('giá trị hàng 0 hoặc tỉ giá lỗi → không giảm', async () => {
      expect((await svc.resolvePointsRedemptionByLot(10, 10, 10, 0)).pointsUsed).toBe(0);
      const bad = new PricingService(makeConfig({ ...DEFAULTS, 'loyalty.vnd_per_point_redeem': 0 }));
      expect((await bad.resolvePointsRedemptionByLot(10, 10, 10, 100000)).pointsUsed).toBe(0);
    });
  });

  // P0 A3-05: MembershipTier.discountPct đã có sẵn trong DB (seed.ts: CO_THU=0.05) nhưng chưa từng
  // được pricing/checkout đọc — hạng "Cổ Thụ" hứa "giảm 5% mọi đơn" nhưng thực tế nhận giá giống hệt
  // Mầm Xanh. calcTierDiscount là hàm thuần CheckoutService.compute() dùng để áp phần trăm này.
  describe('calcTierDiscount (P0 A3-05: hạng giảm % mọi đơn tự động)', () => {
    it('Cổ Thụ 5% trên 300.000đ → giảm đúng 15.000đ', () => {
      expect(svc.calcTierDiscount(300000, 0.05)).toBe(15000);
    });

    it('hạng không có discountPct (0, VD Mầm Xanh/Lộc Biếc/Đại Thụ) → không giảm gì (regression: hành vi cũ)', () => {
      expect(svc.calcTierDiscount(300000, 0)).toBe(0);
    });

    it('làm tròn XUỐNG khi lẻ đồng (100.001 × 5% = 5.000,05 → 5.000)', () => {
      expect(svc.calcTierDiscount(100001, 0.05)).toBe(5000);
    });

    it('giá trị hàng ≤ 0 → không giảm, không trả số âm', () => {
      expect(svc.calcTierDiscount(0, 0.05)).toBe(0);
      expect(svc.calcTierDiscount(-100, 0.05)).toBe(0);
    });

    it('discountPct âm (misconfig) → không giảm (không cộng ngược tiền vào đơn)', () => {
      expect(svc.calcTierDiscount(300000, -0.05)).toBe(0);
    });
  });
});

describe('freeShipThreshold (R2-ENGAGE-16: giỏ và checkout cùng một ngưỡng freeship)', () => {
  const config = makeConfig(DEFAULTS);
  it('không hạng / hạng không có override → ngưỡng toàn cục', async () => {
    expect(await freeShipThreshold(config, null)).toBe(200000);
    expect(await freeShipThreshold(config, 'MAM_NON')).toBe(200000);
  });
  it('hạng có override → ngưỡng của hạng (Lộc Biếc 99k, Cổ Thụ 0)', async () => {
    expect(await freeShipThreshold(config, 'LOC_BIEC')).toBe(99000);
    expect(await freeShipThreshold(config, 'CO_THU')).toBe(0);
  });
  it('override null (admin lỡ lưu) → ngưỡng toàn cục', async () => {
    expect(await freeShipThreshold(makeConfig({ ...DEFAULTS, 'shipping.tier_freeship_overrides': null }), 'LOC_BIEC')).toBe(200000);
  });
});

describe('Freeship đơn đầu (D2-08)', () => {
  const REAL = { phone: '0912345678', zaloId: 'z1' };
  function db(user: unknown = REAL, priorOrder = false) {
    const findUser = jest.fn().mockResolvedValue(user);
    const findOrder = jest.fn().mockResolvedValue(priorOrder ? { id: 'o0' } : null);
    const prisma = { user: { findUnique: findUser }, order: { findFirst: findOrder } } as unknown as PrismaService;
    return { prisma, findUser, findOrder };
  }
  const ON = { 'shipping.first_order_free_enabled': true };

  it('mặc định BẬT từ 199.000đ (chưa có dòng cấu hình): khách thật chưa có đơn được áp', async () => {
    await expect(firstOrderFreeShipFrom(makeConfig({}), db().prisma, 'u1')).resolves.toBe(199_000);
  });

  it('cờ tắt tường minh: không áp, không đọc thêm DB', async () => {
    const { prisma, findUser, findOrder } = db();
    await expect(firstOrderFreeShipFrom(makeConfig({ 'shipping.first_order_free_enabled': false }), prisma, 'u1')).resolves.toBeNull();
    expect(findUser).not.toHaveBeenCalled();
    expect(findOrder).not.toHaveBeenCalled();
  });

  it('chỉ nhận đúng true: chuỗi "true" hay số 1 lưu nhầm không bật', async () => {
    for (const v of ['true', 1, 'false']) {
      await expect(firstOrderFreeShipFrom(makeConfig({ 'shipping.first_order_free_enabled': v }), db().prisma, 'u1')).resolves.toBeNull();
    }
  });

  it('không có SystemConfig (dựng tay trong test cũ) → không áp', async () => {
    await expect(firstOrderFreeShipFrom(undefined, db().prisma, 'u1')).resolves.toBeNull();
  });

  it('bật + khách thật chưa có đơn → ngưỡng tiền hàng (mặc định 199.000, 0 = mọi đơn đầu)', async () => {
    const { prisma, findOrder } = db();
    await expect(firstOrderFreeShipFrom(makeConfig(ON), prisma, 'u1')).resolves.toBe(199_000);
    await expect(firstOrderFreeShipFrom(makeConfig({ ...ON, 'shipping.first_order_free_min_subtotal': 0 }), db().prisma, 'u1')).resolves.toBe(0);
    expect(findOrder.mock.calls[0][0].where).toEqual({ userId: 'u1', status: { not: 'CANCELLED' } });
    await expect(
      firstOrderFreeShipFrom(makeConfig({ ...ON, 'shipping.first_order_free_min_subtotal': 99000 }), db().prisma, 'u1'),
    ).resolves.toBe(99000);
  });

  it('bật nhưng khách vãng lai (chưa SĐT, zaloId guest_) → không áp, như voucher chào mừng', async () => {
    await expect(firstOrderFreeShipFrom(makeConfig(ON), db({ phone: null, zaloId: 'guest_abc' }).prisma, 'u1')).resolves.toBeNull();
    await expect(firstOrderFreeShipFrom(makeConfig(ON), db(null).prisma, 'u1')).resolves.toBeNull();
  });

  it('bật nhưng khách đã có đơn (khác đơn huỷ) → không áp', async () => {
    await expect(firstOrderFreeShipFrom(makeConfig(ON), db(REAL, true).prisma, 'u1')).resolves.toBeNull();
  });

  it('ngưỡng lưu sai kiểu → không áp (không tự hiểu thành 0đ = miễn mọi đơn đầu)', async () => {
    for (const v of [null, '99000', -1, Number.NaN]) {
      await expect(
        firstOrderFreeShipFrom(makeConfig({ ...ON, 'shipping.first_order_free_min_subtotal': v }), db().prisma, 'u1'),
      ).resolves.toBeNull();
    }
  });

  it('firstOrderShippingFee: miễn khi đạt ngưỡng, giữ phí khi chưa đạt hoặc không áp', () => {
    expect(firstOrderShippingFee(19000, 150000, 0)).toBe(0);
    expect(firstOrderShippingFee(19000, 99000, 99000)).toBe(0);
    expect(firstOrderShippingFee(19000, 98999, 99000)).toBe(19000);
    expect(firstOrderShippingFee(19000, 150000, null)).toBe(19000);
    expect(firstOrderShippingFee(0, 250000, 0)).toBe(0);
  });
});
