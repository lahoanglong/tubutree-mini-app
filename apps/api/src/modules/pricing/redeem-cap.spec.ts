import { combinedRedeemCap, couponCapNote, loadRedeemPct, MAX_REDEEM_PCT_DEFAULT, parseRedeemPct, pointsCapNote } from './redeem-cap';
import { PricingService } from './pricing.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const configOf = (values: Record<string, unknown>) =>
  ({ get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? values[k] : fb) as T }) as unknown as SystemConfigService;

describe('redeem-cap: trần giảm gộp voucher + Điểm Xanh', () => {
  it('parseRedeemPct: phân số [0, 1] giữ nguyên; sai dạng về 20%', () => {
    expect(parseRedeemPct(0.2)).toBe(0.2);
    expect(parseRedeemPct(0)).toBe(0);
    expect(parseRedeemPct(1)).toBe(1);
    for (const bad of [null, undefined, '0.2', -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseRedeemPct(bad)).toBe(MAX_REDEEM_PCT_DEFAULT);
    }
  });

  it('loadRedeemPct đọc loyalty.max_redeem_pct, thiếu dòng thì 20%', async () => {
    expect(await loadRedeemPct(configOf({ 'loyalty.max_redeem_pct': 0.15 }))).toBe(0.15);
    expect(await loadRedeemPct(configOf({}))).toBe(0.2);
  });

  it('combinedRedeemCap làm tròn xuống, không âm, 0 khi tạm tính hoặc tỉ lệ ≤ 0', () => {
    expect(combinedRedeemCap(299_000, 0.2)).toBe(59_800);
    expect(combinedRedeemCap(199_999, 0.2)).toBe(39_999);
    expect(combinedRedeemCap(100_001, 0.2)).toBe(20_000);
    expect(combinedRedeemCap(0, 0.2)).toBe(0);
    expect(combinedRedeemCap(-5, 0.2)).toBe(0);
    expect(combinedRedeemCap(500_000, 0)).toBe(0);
    // Mọi tạm tính nguyên tới 2 triệu: trần ≤ 20% chính xác (không lệch lên vì số thực).
    for (let s = 1; s <= 2_000_000; s += 997) expect(combinedRedeemCap(s, 0.2) * 5).toBeLessThanOrEqual(s);
  });

  it('câu giải thích tiếng Việt có số tiền, số điểm và phần trăm', () => {
    expect(couponCapNote(59_800, 0.2)).toBe('Voucher và Điểm Xanh giảm tối đa 20% tạm tính mỗi đơn, nên mã giảm 59.800đ cho đơn này.');
    expect(pointsCapNote(23_800, 0.2)).toBe('Đơn này dùng tối đa 23.800 Điểm Xanh: voucher và Điểm Xanh giảm tối đa 20% tạm tính mỗi đơn.');
    expect(pointsCapNote(0, 0.15)).toBe('Voucher đã dùng hết mức giảm 15% tạm tính của đơn này, nên chưa dùng thêm được Điểm Xanh.');
  });
});

describe('PricingService: trần VND thêm cho lô STANDARD (phần trần gộp còn lại sau mã)', () => {
  const svc = new PricingService(configOf({ 'loyalty.vnd_per_point_redeem': 1, 'loyalty.max_redeem_pct': 0.2 }));

  it('không truyền trần thêm → như cũ: 20% giá trị hàng', async () => {
    expect(await svc.resolvePointsRedemption(1_000_000, 1_000_000, 400_000)).toEqual({ pointsUsed: 80_000, discount: 80_000 });
  });

  it('trần thêm nhỏ hơn 20% giá trị hàng → kẹp theo trần thêm; âm coi như 0', async () => {
    expect(await svc.resolvePointsRedemption(1_000_000, 1_000_000, 400_000, 40_000)).toEqual({ pointsUsed: 40_000, discount: 40_000 });
    expect(await svc.resolvePointsRedemption(1_000_000, 1_000_000, 400_000, -1)).toEqual({ pointsUsed: 0, discount: 0 });
  });

  it('trần thêm chỉ áp lô STANDARD; lô CONVERTED vẫn trả tới giá trị hàng', async () => {
    const r = await svc.resolvePointsRedemptionByLot(1_100_000, 1_000_000, 100_000, 400_000, 0);
    expect(r).toEqual({ pointsUsed: 100_000, pointsUsedStandard: 0, pointsUsedConverted: 100_000, discount: 100_000 });
  });

  it('maxRedeemPct đọc cùng khoá với trần Điểm Xanh', async () => {
    expect(await svc.maxRedeemPct()).toBe(0.2);
  });
});
