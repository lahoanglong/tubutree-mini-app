import { PricingService } from './pricing.service';
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
