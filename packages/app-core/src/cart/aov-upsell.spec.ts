import { describe, expect, it } from 'vitest';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { FREESHIP_BOOSTER_WINDOW, freeshipProgress, type FreeshipAddonCandidate } from '../commerce/freeship-progress';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { AOV_ADDON_MAX, AOV_ADDON_MAX_PRICE, AOV_ADDON_MIN, aovGiftExclusions, aovGiftLockedRowShown, aovUpsellGoal, pickAovAddons } from './aov-upsell';

const c = (slug: string, price: number, over: Partial<FreeshipAddonCandidate> = {}): FreeshipAddonCandidate => ({
  slug,
  variationId: `v-${slug}`,
  price,
  inStock: true,
  ...over,
});

const gift = (over: Partial<GiftTrialSummaryDTO> = {}): GiftTrialSummaryDTO => ({
  base: 257_000,
  minOrder: 299_000,
  nextMinOrder: 299_000,
  shortfall: 42_000,
  options: [
    { variationId: 'v-fuwa', productName: 'Fuwa3e', variationName: '100ml', slug: 'fuwa3e', thumbnail: null, minOrder: 299_000, unlocked: false },
  ],
  selectedVariationId: null,
  declined: false,
  ...over,
});

/** Thanh Miễn phí giao hàng như hai app dựng: cùng `freeshipProgress`. */
const bar = (base: number, threshold = 199_000) => ({ ...freeshipProgress({ base, threshold }), threshold });

describe('aovUpsellGoal', () => {
  it('chưa đạt Miễn phí giao hàng: nhắm mốc giao hàng, dòng nói đúng số còn thiếu', () => {
    expect(aovUpsellGoal({ base: 164_000, freeship: bar(164_000), giftTrial: gift() })).toEqual({
      stage: 'freeship',
      shortfall: 35_000,
      target: 199_000,
      headline: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng',
    });
  });

  it('đã Miễn phí giao hàng, chưa đủ mốc quà: nhắm quà dùng thử 0đ theo mốc máy chủ trả (không ghi cứng 299.000đ)', () => {
    expect(aovUpsellGoal({ base: 257_000, freeship: bar(257_000), giftTrial: gift() })).toEqual({
      stage: 'gift',
      shortfall: 42_000,
      target: 299_000,
      headline: 'Thêm 42.000đ nữa để nhận quà dùng thử 0đ',
    });
    const moved = aovUpsellGoal({ base: 257_000, freeship: bar(257_000, 150_000), giftTrial: gift({ minOrder: 350_000 }) });
    expect(moved).toMatchObject({ stage: 'gift', shortfall: 93_000, target: 350_000 });
  });

  it('mốc quà tính theo tiền hàng của app (giỏ tạm vừa thêm món), không chờ cờ `unlocked` của máy chủ', () => {
    expect(aovUpsellGoal({ base: 300_000, freeship: bar(300_000), giftTrial: gift() })).toBeNull();
    expect(aovUpsellGoal({ base: 299_000, freeship: bar(299_000), giftTrial: gift() })).toBeNull();
    expect(aovUpsellGoal({ base: 298_999, freeship: bar(298_999), giftTrial: gift() })).toMatchObject({ stage: 'gift', shortfall: 1 });
  });

  it('không có gì để nhắm: không có quà, quà rỗng, khách đã chọn không nhận quà, hay giỏ không có phần Tubu Tree giao', () => {
    expect(aovUpsellGoal({ base: 257_000, freeship: bar(257_000), giftTrial: null })).toBeNull();
    expect(aovUpsellGoal({ base: 257_000, freeship: bar(257_000) })).toBeNull();
    expect(aovUpsellGoal({ base: 257_000, freeship: bar(257_000), giftTrial: gift({ options: [] }) })).toBeNull();
    expect(aovUpsellGoal({ base: 257_000, freeship: bar(257_000), giftTrial: gift({ declined: true }) })).toBeNull();
    expect(aovUpsellGoal({ base: 0, freeship: null, giftTrial: gift() })).toBeNull();
  });

  it('chưa đạt Miễn phí giao hàng thì không nói "Đã Miễn phí giao hàng", kể cả khi mốc quà thấp hơn (cấu hình lạ)', () => {
    const goal = aovUpsellGoal({ base: 120_000, freeship: bar(120_000, 199_000), giftTrial: gift({ minOrder: 100_000 }) });
    expect(goal).toMatchObject({ stage: 'freeship', shortfall: 79_000 });
    expect(goal?.headline).not.toContain('Đã Miễn phí');
  });

  it('ngưỡng giao hàng 0 (mọi đơn miễn phí): đi thẳng tới mốc quà', () => {
    expect(aovUpsellGoal({ base: 50_000, freeship: bar(50_000, 0), giftTrial: gift() })).toMatchObject({ stage: 'gift', shortfall: 249_000 });
  });

  it('mốc giao hàng: dòng đầu không nhắc số còn thiếu, vì thanh tiến độ ngay trên dải đã nói số đó', () => {
    const goal = aovUpsellGoal({ base: 164_000, freeship: bar(164_000), giftTrial: gift() });
    expect(goal?.headline).not.toMatch(/\d/);
    expect(aovUpsellGoal({ base: 164_000, freeship: bar(164_000), tubuOnly: true })?.headline).toBe(goal?.headline);
  });

  it('giỏ có hàng gian hàng tự giao, mốc quà: dòng nói rõ chỉ hàng Tubu Tree giao được tính', () => {
    expect(aovUpsellGoal({ base: 257_000, freeship: bar(257_000), giftTrial: gift(), tubuOnly: true })?.headline).toBe('Thêm 42.000đ hàng Tubu Tree giao để nhận quà dùng thử 0đ');
  });

  it('số lẻ làm tròn lên (không hứa thiếu một đồng), chữ không dính thuật ngữ cấm', () => {
    const goal = aovUpsellGoal({ base: 164_000.4, freeship: bar(164_000.4), giftTrial: gift() });
    expect(goal?.shortfall).toBe(35_000);
    for (const g of [goal, aovUpsellGoal({ base: 257_000, freeship: bar(257_000), giftTrial: gift() })]) {
      expect(FORBIDDEN_TERMS.filter((t) => t.pattern.test(g!.headline))).toEqual([]);
    }
  });
});

describe('aovGiftLockedRowShown', () => {
  const giftGoal = () => aovUpsellGoal({ base: 257_000, freeship: bar(257_000), giftTrial: gift() });

  it('dải mốc quà đang hiện hay còn chờ nguồn món: ô quà khoá không nói lại số còn thiếu (không hiện rồi biến mất lúc dải tải xong)', () => {
    expect(aovGiftLockedRowShown({ goal: giftGoal(), railShown: true, base: 257_000, giftTrial: gift() })).toBe(false);
    expect(aovGiftLockedRowShown({ goal: giftGoal(), railShown: null, base: 257_000, giftTrial: gift() })).toBe(false);
  });

  it('dải mốc quà không hiện (dưới 2 món, nguồn lỗi): ô quà khoá nói số còn thiếu như cũ', () => {
    expect(aovGiftLockedRowShown({ goal: giftGoal(), railShown: false, base: 257_000, giftTrial: gift() })).toBe(true);
  });

  it('mốc giao hàng: dải không nói chuyện quà nên ô quà khoá vẫn hiện dù dải đang hiện', () => {
    const goal = aovUpsellGoal({ base: 150_000, freeship: bar(150_000), giftTrial: gift({ base: 150_000, shortfall: 149_000 }) });
    expect(goal?.stage).toBe('freeship');
    expect(aovGiftLockedRowShown({ goal, railShown: true, base: 150_000, giftTrial: gift({ base: 150_000, shortfall: 149_000 }) })).toBe(true);
  });

  it('giỏ tạm vừa thêm món đủ mốc mà khối quà của máy chủ còn khoá: không nói "Thêm …" lúc khách đã đủ', () => {
    expect(aovGiftLockedRowShown({ goal: null, railShown: false, base: 302_000, giftTrial: gift() })).toBe(false);
    expect(aovGiftLockedRowShown({ goal: null, railShown: false, base: 299_000, giftTrial: gift() })).toBe(false);
  });

  it('khối quà đã mở, không có quà hay không có khối quà: không chặn (ô tự lo trạng thái của nó)', () => {
    const open = gift({ options: [{ ...gift().options[0]!, unlocked: true }] });
    expect(aovGiftLockedRowShown({ goal: null, railShown: false, base: 302_000, giftTrial: open })).toBe(true);
    expect(aovGiftLockedRowShown({ goal: null, railShown: false, base: 302_000, giftTrial: gift({ options: [] }) })).toBe(true);
    expect(aovGiftLockedRowShown({ goal: null, railShown: null, base: 302_000, giftTrial: null })).toBe(true);
  });
});

describe('aovGiftExclusions', () => {
  it('slug và phân loại của mọi quà dùng thử; không có khối quà thì rỗng', () => {
    const ex = aovGiftExclusions(gift());
    expect([...ex.slugs]).toEqual(['fuwa3e']);
    expect([...ex.variationIds]).toEqual(['v-fuwa']);
    expect(aovGiftExclusions(null).slugs.size).toBe(0);
  });
});

describe('pickAovAddons', () => {
  it('tối đa 2 thẻ gọn (tubu-w13-01): món vừa đủ bù khoảng thiếu đứng trước, rẻ trước (vượt mốc ít tiền nhất)', () => {
    expect(AOV_ADDON_MAX).toBe(2);
    const picked = pickAovAddons([c('a', 10_000), c('b', 50_000), c('d', 38_000), c('e', 30_000), c('f', 36_000), c('g', 20_000)], { shortfall: 35_000 });
    expect(picked.map((p) => p.slug)).toEqual(['f', 'd']);
    expect(picked).toHaveLength(AOV_ADDON_MAX);
  });

  it('không món nào bù đủ một mình: món gần đủ nhất (đắt trước) lấp khoảng thiếu', () => {
    const picked = pickAovAddons([c('a', 10_000), c('e', 30_000), c('g', 20_000)], { shortfall: 35_000 });
    expect(picked.map((p) => p.slug)).toEqual(['e', 'g']);
  });

  it('nguồn đã xếp ở máy chủ: giữ thứ tự nguồn trong nhóm bù đủ', () => {
    const picked = pickAovAddons([c('hot', 70_000), c('cheap', 36_000), c('near', 30_000)], { shortfall: 35_000, window: FREESHIP_BOOSTER_WINDOW, ranked: true });
    expect(picked.map((p) => p.slug)).toEqual(['hot', 'cheap']);
  });

  it('trần món nhỏ 120.000đ: khoảng thiếu lớn vẫn không gợi ý món đắt', () => {
    const picked = pickAovAddons([c('edge', AOV_ADDON_MAX_PRICE), c('dear', AOV_ADDON_MAX_PRICE + 1), c('small', 60_000)], { shortfall: 100_000, window: FREESHIP_BOOSTER_WINDOW });
    expect(picked.map((p) => p.slug)).toEqual(['edge', 'small']);
  });

  it('cửa sổ trên số còn thiếu: món vượt quá xa mốc bị bỏ', () => {
    const picked = pickAovAddons([c('ok', 10_000 + FREESHIP_BOOSTER_WINDOW), c('far', 10_001 + FREESHIP_BOOSTER_WINDOW), c('x', 5_000)], { shortfall: 10_000, window: FREESHIP_BOOSTER_WINDOW });
    expect(picked.map((p) => p.slug)).toEqual(['ok', 'x']);
  });

  it('bỏ món hết hàng, thiếu phân loại, giá 0, trùng sản phẩm, đã trong giỏ (slug hay phân loại) và quà dùng thử 0đ', () => {
    const ex = aovGiftExclusions(gift());
    const picked = pickAovAddons(
      [
        c('out', 40_000, { inStock: false }),
        c('novar', 40_000, { variationId: null }),
        c('free', 0),
        c('dup', 40_000),
        c('dup', 41_000, { variationId: 'v-dup-2' }),
        c('in-cart', 40_000),
        c('in-cart-var', 40_000, { variationId: 'v-cart' }),
        c('fuwa3e', 40_000, { variationId: 'v-fuwa-big' }),
        c('other', 40_000, { variationId: 'v-fuwa' }),
        c('keep', 45_000),
      ],
      { shortfall: 42_000, inCartSlugs: new Set(['in-cart']), inCartVariationIds: new Set(['v-cart']), excludeSlugs: ex.slugs, excludeVariationIds: ex.variationIds },
    );
    expect(picked.map((p) => p.slug)).toEqual(['keep', 'dup']);
  });

  it(`dưới ${AOV_ADDON_MIN} món thì rỗng (sàn = trần: dải luôn đúng 2 thẻ hay không có); đã đạt mốc (số còn thiếu 0, âm, NaN) cũng rỗng`, () => {
    expect(AOV_ADDON_MIN).toBe(2);
    expect(pickAovAddons([c('only', 40_000)], { shortfall: 35_000 })).toEqual([]);
    expect(pickAovAddons([c('out', 40_000, { inStock: false })], { shortfall: 35_000 })).toEqual([]);
    for (const shortfall of [0, -1, Number.NaN]) expect(pickAovAddons([c('a', 1_000), c('b', 2_000)], { shortfall })).toEqual([]);
    expect(pickAovAddons(null, { shortfall: 35_000 })).toEqual([]);
  });
});
