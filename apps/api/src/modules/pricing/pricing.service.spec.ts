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
});
