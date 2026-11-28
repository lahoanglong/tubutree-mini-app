import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { describe, expect, it } from 'vitest';
import {
  CART_PROGRESS_COPY,
  CART_PROGRESS_COPY_MAX,
  cartGoalPick,
  cartGiftThreshold,
  cartProgressCopy,
  computeCartThresholdProgress,
  computeRefillValueComparison,
  type CartProgressCopyKey,
} from './cart-progress';
import { freeshipProgress } from './freeship-progress';

const T = { freeshipThreshold: 199_000, giftThreshold: 299_000 };

describe('computeCartThresholdProgress: hai mốc 199.000đ Miễn phí giao hàng → 299.000đ Quà dùng thử', () => {
  it('0đ: chưa đạt mốc nào, thanh rỗng, câu nói số còn thiếu tới Miễn phí giao hàng', () => {
    const p = computeCartThresholdProgress(0, T);
    expect(p.pct).toBe(0);
    expect(p.next).toBe('freeship');
    expect(p.done).toBe(false);
    expect(p.freeship).toEqual(expect.objectContaining({ reached: false, remaining: 199_000, threshold: 199_000 }));
    expect(p.gift).toEqual(expect.objectContaining({ reached: false, remaining: 299_000, threshold: 299_000, at: 100 }));
    expect(p.headline).toBe('Mua thêm 199.000đ để được Miễn phí giao hàng 🚚');
  });

  it('198.999đ: còn đúng 1đ, thanh chưa chạm vạch mốc đầu (199/299 = 66,55% → vạch ở 66,5%)', () => {
    const p = computeCartThresholdProgress(198_999, T);
    expect(p.freeship.reached).toBe(false);
    expect(p.freeship.remaining).toBe(1);
    expect(p.freeship.at).toBe(66.5);
    expect(p.pct).toBe(66);
    expect(p.pct).toBeLessThan(p.freeship.at);
    expect(p.headline).toBe('Mua thêm 1đ để được Miễn phí giao hàng 🚚');
  });

  it('199.000đ: đạt Miễn phí giao hàng, mốc kế là quà; câu đầu chỉ chúc mừng (số còn thiếu tới quà do dải mua thêm nói, không nói hai lần)', () => {
    const p = computeCartThresholdProgress(199_000, T);
    expect(p.freeship).toEqual(expect.objectContaining({ reached: true, remaining: 0 }));
    expect(p.gift).toEqual(expect.objectContaining({ reached: false, remaining: 100_000 }));
    expect(p.next).toBe('gift');
    expect(p.done).toBe(false);
    expect(p.pct).toBe(66);
    expect(p.headline).toBe('🎉 Đơn hàng đã được Miễn phí giao hàng');
    expect(p.headline).not.toContain('100.000đ');
  });

  it('298.999đ: chưa có quà, thanh tối đa 99% (không đầy khi còn thiếu vài đồng)', () => {
    const p = computeCartThresholdProgress(298_999, T);
    expect(p.gift?.reached).toBe(false);
    expect(p.gift?.remaining).toBe(1);
    expect(p.pct).toBe(99);
  });

  it('299.000đ và hơn: đạt cả hai mốc, thanh đầy, khối co về dòng chúc mừng', () => {
    for (const base of [299_000, 450_000]) {
      const p = computeCartThresholdProgress(base, T);
      expect(p.pct).toBe(100);
      expect(p.next).toBeNull();
      expect(p.done).toBe(true);
      expect(p.gift).toEqual(expect.objectContaining({ reached: true, remaining: 0 }));
    }
  });

  it('nhãn mốc đọc số từ cấu hình, không ghi cứng 199.000/299.000', () => {
    const p = computeCartThresholdProgress(50_000, T);
    expect(p.freeship.label).toBe('199.000đ Miễn phí giao hàng');
    expect(p.gift?.label).toBe('299.000đ Quà dùng thử');
    const q = computeCartThresholdProgress(50_000, { freeshipThreshold: 250_000, giftThreshold: 500_000 });
    expect(q.freeship.label).toBe('250.000đ Miễn phí giao hàng');
    expect(q.freeship.at).toBe(50);
    expect(q.gift?.label).toBe('500.000đ Quà dùng thử');
    expect(q.pct).toBe(10);
  });

  it('không có mốc quà (cờ tắt, hết quà, đã từ chối quà) hay mốc quà không cao hơn mốc giao hàng: một mốc, cùng số với freeshipProgress', () => {
    for (const giftThreshold of [null, undefined, 0, 199_000, 150_000, Number.NaN]) {
      for (const base of [0, 120_000, 198_999, 199_000, 260_000]) {
        const p = computeCartThresholdProgress(base, { freeshipThreshold: 199_000, giftThreshold });
        const single = freeshipProgress({ base, threshold: 199_000 });
        expect(p.gift).toBeNull();
        expect(p.pct).toBe(single.pct);
        expect(p.freeship.reached).toBe(single.reached);
        expect(p.freeship.remaining).toBe(single.remaining);
        expect(p.freeship.at).toBe(100);
        expect(p.done).toBe(single.reached);
      }
    }
  });

  it('máy chủ báo đã Miễn phí giao hàng (tin được): mốc đầu đạt dù tiền hàng thấp hơn, thanh vẫn đo đúng tiền hàng tới quà', () => {
    const p = computeCartThresholdProgress(150_000, { ...T, serverFreeship: true });
    expect(p.freeship.reached).toBe(true);
    expect(p.next).toBe('gift');
    expect(p.pct).toBe(50);
    expect(computeCartThresholdProgress(150_000, { freeshipThreshold: 199_000, serverFreeship: true }).done).toBe(true);
  });

  it('giỏ có hàng gian hàng tự giao: câu nói rõ phần Tubu Tree giao', () => {
    expect(computeCartThresholdProgress(100_000, { ...T, tubuOnly: true }).headline).toBe(
      'Mua thêm 99.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao 🚚',
    );
    expect(computeCartThresholdProgress(200_000, { ...T, tubuOnly: true }).headline).toBe('🎉 Phần hàng Tubu Tree giao đã được Miễn phí giao hàng');
  });

  it('tiền hàng âm, NaN hay ngưỡng 0: không vỡ, ngưỡng 0 nghĩa là đơn nào cũng được miễn phí', () => {
    expect(computeCartThresholdProgress(-5, T).pct).toBe(0);
    expect(computeCartThresholdProgress(Number.NaN, T).freeship.remaining).toBe(199_000);
    const free = computeCartThresholdProgress(10_000, { freeshipThreshold: 0, giftThreshold: 299_000 });
    expect(free.freeship.reached).toBe(true);
    expect(free.gift).toBeNull();
    expect(free.done).toBe(true);
  });

  it('nhãn đọc của thanh: một mốc nói Miễn phí giao hàng, hai mốc nói quà', () => {
    expect(computeCartThresholdProgress(99_500, { freeshipThreshold: 199_000 }).barAria).toBe('Đã đạt 50% để được Miễn phí giao hàng');
    expect(computeCartThresholdProgress(149_500, T).barAria).toBe('Đã đạt 50% chặng tới Quà dùng thử, mốc Miễn phí giao hàng ở 199.000đ');
  });
});

describe('cartGiftThreshold: mốc quà của thanh hai mốc chỉ khi khách còn nhận được quà', () => {
  const gift = (over: Partial<GiftTrialSummaryDTO> = {}): GiftTrialSummaryDTO => ({
    base: 120_000,
    minOrder: 299_000,
    nextMinOrder: 299_000,
    shortfall: 179_000,
    options: [{ variationId: 'v-gift', productName: 'Khăn tre', variationName: 'Gói 3', slug: 'khan-tre', thumbnail: null, minOrder: 299_000, unlocked: false }],
    selectedVariationId: null,
    declined: false,
    ...over,
  });
  it('đọc `minOrder` của khối quà máy chủ trả', () => {
    expect(cartGiftThreshold(gift())).toBe(299_000);
    expect(cartGiftThreshold(gift({ minOrder: 350_000 }))).toBe(350_000);
  });
  it('không có khối quà, hết quà hay khách đã chọn không nhận: không có mốc quà', () => {
    expect(cartGiftThreshold(null)).toBeNull();
    expect(cartGiftThreshold(undefined)).toBeNull();
    expect(cartGiftThreshold(gift({ options: [] }))).toBeNull();
    expect(cartGiftThreshold(gift({ declined: true }))).toBeNull();
    expect(cartGiftThreshold(gift({ minOrder: 0 }))).toBeNull();
  });
});

describe('computeRefillValueComparison: túi/can Refill so với chai trên cùng lượng', () => {
  it('chai 500ml 68.000đ, Refill 10L 890.000đ: tiết kiệm đúng số đồng, ~34%, thay 20 chai', () => {
    expect(computeRefillValueComparison(68_000, 500, 890_000, 10_000)).toEqual({ savedVnd: 470_000, savedPct: 34, bottlesReplaced: 20 });
  });

  it('số đồng làm tròn xuống, số chai là phần nguyên (không nói quá)', () => {
    // 3,8L / 500ml = 7,6 chai: 89.000 × 7,6 = 676.400 − 499.000 = 177.400đ; 26,2% → 26%.
    expect(computeRefillValueComparison(89_000, 500, 499_000, 3_800)).toEqual({ savedVnd: 177_400, savedPct: 26, bottlesReplaced: 7 });
    // 1/3 đồng lẻ: 100.000 × 2000/300 = 666.666,67 − 600.000 → 66.666đ.
    expect(computeRefillValueComparison(100_000, 300, 600_000, 2_000)?.savedVnd).toBe(66_666);
  });

  it('Refill nhỏ hơn một chai (dù rẻ hơn mỗi ml): null, không nêu số tiết kiệm so với nửa chai', () => {
    expect(computeRefillValueComparison(100_000, 1_000, 40_000, 500)).toBeNull();
    expect(computeRefillValueComparison(100_000, 1_000, 95_000, 1_000)).toEqual({ savedVnd: 5_000, savedPct: 5, bottlesReplaced: 1 });
  });

  it('Refill đắt hơn hay bằng chai mỗi ml: null', () => {
    expect(computeRefillValueComparison(68_000, 500, 1_500_000, 10_000)).toBeNull();
    expect(computeRefillValueComparison(68_000, 500, 1_360_000, 10_000)).toBeNull();
  });

  it('rẻ hơn dưới 1%: null (không hứa "~0%")', () => {
    expect(computeRefillValueComparison(100_000, 1_000, 995_000, 10_000)).toBeNull();
  });

  it('thiếu lượng hay giá (0, âm, NaN, vô cực, null): null', () => {
    const bad = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined] as unknown as number[];
    for (const v of bad) {
      expect(computeRefillValueComparison(v, 500, 890_000, 10_000)).toBeNull();
      expect(computeRefillValueComparison(68_000, v, 890_000, 10_000)).toBeNull();
      expect(computeRefillValueComparison(68_000, 500, v, 10_000)).toBeNull();
      expect(computeRefillValueComparison(68_000, 500, 890_000, v)).toBeNull();
    }
  });
});

describe('CART_PROGRESS_COPY', () => {
  it('mọi khoá có trần độ dài, chữ điền số vẫn trong trần', () => {
    const vars = { amount: '1.000.000đ', pct: 99, mark: '1.000.000đ' };
    for (const key of Object.keys(CART_PROGRESS_COPY) as CartProgressCopyKey[]) {
      expect(CART_PROGRESS_COPY_MAX[key], key).toBeGreaterThan(0);
      expect(cartProgressCopy(key, vars).length, key).toBeLessThanOrEqual(CART_PROGRESS_COPY_MAX[key]);
    }
  });
});

describe('cartGoalPick (một thanh mốc ở đầu giỏ)', () => {
  const p = (base: number, gift?: number) => computeCartThresholdProgress(base, { freeshipThreshold: 199_000, giftThreshold: gift });
  it('không có mã sắp mở khoá: thanh mốc', () => {
    expect(cartGoalPick(p(100_000), null)).toBe('progress');
  });
  it('mã gần hơn mốc Miễn phí giao hàng thì nói mã; xa hơn hay hoà thì nói mốc', () => {
    expect(cartGoalPick(p(100_000), { missing: 50_000 })).toBe('voucher');
    expect(cartGoalPick(p(100_000), { missing: 120_000 })).toBe('progress');
    expect(cartGoalPick(p(100_000), { missing: 99_000 })).toBe('progress');
  });
  it('đã Miễn phí giao hàng, còn mốc quà: so với mốc quà', () => {
    expect(cartGoalPick(p(200_000, 299_000), { missing: 50_000 })).toBe('voucher');
    expect(cartGoalPick(p(200_000, 299_000), { missing: 150_000 })).toBe('progress');
  });
  it('đạt hết mốc mà còn mã sắp mở khoá: nói mã', () => {
    expect(cartGoalPick(p(300_000), { missing: 20_000 })).toBe('voucher');
  });
});
