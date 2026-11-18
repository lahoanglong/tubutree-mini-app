import {
  allocateGreenBox,
  applyGreenBox,
  comboKeyIds,
  GREEN_BOX_ENABLED_KEY,
  GREEN_BOX_OFF,
  GREEN_BOX_TIERS_DEFAULT,
  GREEN_BOX_TIERS_KEY,
  greenBoxLineOf,
  isGreenBoxEligible,
  loadGreenBoxSettings,
  parseGreenBoxTiers,
  yieldGreenBoxToCoupon,
  type GreenBoxLine,
  type GreenBoxSettings,
} from './green-box';
import { BadRequestException } from '@nestjs/common';
import { goodsAfterComboOf } from '../storefront/combo.service';
import { CouponMinOrderError } from '../coupons/coupons.service';
import { allocateLineAmounts } from '../checkout/checkout-split';
import { pointsForGoods } from '../pricing/points-earn';
import type { SystemConfigService } from '../system-config/system-config.service';

const TIERS = [...GREEN_BOX_TIERS_DEFAULT];
const ON: GreenBoxSettings = { enabled: true, tiers: TIERS };
const line = (n: number, o: Partial<GreenBoxLine> = {}): GreenBoxLine => ({
  variationId: `v${n}`,
  productId: `p${n}`,
  total: 100_000,
  quantity: 1,
  isFlash: false,
  tubu: true,
  inStock: true,
  ...o,
});
const lines = (count: number) => Array.from({ length: count }, (_, i) => line(i + 1));
const NO_COMBO = { total: 0, perLine: {} as Record<string, number> };

describe('parseGreenBoxTiers', () => {
  it('bảng mặc định 3/5/7 đọc nguyên, đã sắp tăng dần', () => {
    expect(parseGreenBoxTiers([{ minItems: 7, pct: 7 }, { minItems: 3, pct: 3 }, { minItems: 5, pct: 5 }], 50)).toEqual(TIERS);
  });

  it.each([
    ['không phải mảng', { minItems: 3, pct: 3 }],
    ['mảng rỗng', []],
    ['null', null],
    ['chuỗi JSON', '[{"minItems":3,"pct":3}]'],
    ['thiếu pct', [{ minItems: 3 }]],
    ['pct là chuỗi', [{ minItems: 3, pct: '3' }]],
    ['pct âm', [{ minItems: 3, pct: -3 }]],
    ['pct NaN', [{ minItems: 3, pct: Number.NaN }]],
    ['minItems lẻ', [{ minItems: 3.5, pct: 3 }]],
    ['minItems 1 (mã giảm % trá hình)', [{ minItems: 1, pct: 3 }]],
    ['minItems trùng', [{ minItems: 3, pct: 3 }, { minItems: 3, pct: 5 }]],
    ['bậc sau giảm ít hơn bậc trước', [{ minItems: 3, pct: 5 }, { minItems: 5, pct: 3 }]],
    ['một phần tử null', [{ minItems: 3, pct: 3 }, null]],
  ])('sai dạng (%s) thì không có bậc', (_label, raw) => {
    expect(parseGreenBoxTiers(raw, 50)).toEqual([]);
  });

  it('trần cứng 10% trong mã, dù cấu hình ghi 40%', () => {
    expect(parseGreenBoxTiers([{ minItems: 3, pct: 40 }], 50)).toEqual([{ minItems: 3, pct: 10 }]);
  });

  it('trần bundle.max_pct thấp hơn 10% thì kẹp theo nó', () => {
    expect(parseGreenBoxTiers(TIERS, 4)).toEqual([{ minItems: 3, pct: 3 }, { minItems: 5, pct: 4 }, { minItems: 7, pct: 4 }]);
  });

  it('bundle.max_pct 0 hoặc không phải số thì không giảm', () => {
    expect(parseGreenBoxTiers(TIERS, 0)).toEqual([]);
    expect(parseGreenBoxTiers(TIERS, Number.NaN)).toEqual([]);
  });
});

describe('loadGreenBoxSettings', () => {
  const config = (values: Record<string, unknown>) => {
    const get = jest.fn(async (k: string, d: unknown) => (k in values ? values[k] : d));
    return { get, svc: { get } as unknown as Pick<SystemConfigService, 'get'> };
  };

  it('không có config hoặc cờ chưa bật thì tắt, không đọc bảng bậc', async () => {
    expect(await loadGreenBoxSettings(undefined)).toBe(GREEN_BOX_OFF);
    const off = config({});
    expect(await loadGreenBoxSettings(off.svc)).toBe(GREEN_BOX_OFF);
    expect(off.get).toHaveBeenCalledTimes(1);
  });

  it('cờ là chuỗi "true" (ghi tay sai kiểu) vẫn coi là tắt', async () => {
    expect(await loadGreenBoxSettings(config({ [GREEN_BOX_ENABLED_KEY]: 'true' }).svc)).toBe(GREEN_BOX_OFF);
  });

  it('cờ bật: bảng bậc mặc định khi chưa có dòng, kẹp theo bundle.max_pct', async () => {
    expect(await loadGreenBoxSettings(config({ [GREEN_BOX_ENABLED_KEY]: true }).svc)).toEqual({ enabled: true, tiers: TIERS });
    expect(await loadGreenBoxSettings(config({ [GREEN_BOX_ENABLED_KEY]: true, 'bundle.max_pct': 5 }).svc)).toEqual({
      enabled: true,
      tiers: [{ minItems: 3, pct: 3 }, { minItems: 5, pct: 5 }, { minItems: 7, pct: 5 }],
    });
  });

  it('cờ bật mà bảng bậc sai dạng: bật nhưng không bậc nào (không giảm, không ném)', async () => {
    expect(await loadGreenBoxSettings(config({ [GREEN_BOX_ENABLED_KEY]: true, [GREEN_BOX_TIERS_KEY]: { bad: 1 } }).svc)).toEqual({ enabled: true, tiers: [] });
  });
});

describe('allocateGreenBox: bậc theo số sản phẩm khác nhau', () => {
  it.each([
    [2, null, 3, 0],
    [3, 3, 5, 9_000],
    [5, 5, 7, 25_000],
    [7, 7, null, 49_000],
    [9, 7, null, 63_000],
  ])('%i món → bậc %s, bậc kế %s, giảm %i', (count, tier, next, total) => {
    const r = allocateGreenBox(lines(count), TIERS);
    expect(r.items).toBe(count);
    expect(r.tier?.minItems ?? null).toBe(tier);
    expect(r.next?.minItems ?? null).toBe(next);
    expect(r.total).toBe(total);
    expect(Object.values(r.perLine).reduce((s, d) => s + d, 0)).toBe(r.total);
  });

  it('hai phân loại của một sản phẩm tính 1: 3 dòng mà chỉ 2 sản phẩm thì chưa đạt bậc', () => {
    const r = allocateGreenBox([line(1), line(2), line(3, { productId: 'p1' })], TIERS);
    expect(r.items).toBe(2);
    expect(r.total).toBe(0);
  });

  it('đủ bậc thì mọi dòng đủ điều kiện đều được giảm, kể cả phân loại thứ hai của cùng sản phẩm', () => {
    const r = allocateGreenBox([line(1), line(2), line(3), line(4, { productId: 'p1' })], TIERS);
    expect(r.items).toBe(3);
    expect(r.perLine).toEqual({ v1: 3_000, v2: 3_000, v3: 3_000, v4: 3_000 });
  });

  it('mỗi dòng giảm tối đa 2 đơn vị', () => {
    const r = allocateGreenBox([line(1, { quantity: 5, total: 500_000 }), line(2), line(3)], TIERS);
    expect(r.perLine.v1).toBe(6_000);
  });

  it('làm tròn xuống từng dòng, không bao giờ vượt tiền của dòng', () => {
    const input = [line(1, { total: 33_333 }), line(2, { total: 1 }), line(3, { total: 99_999, quantity: 3 })];
    const r = allocateGreenBox(input, TIERS);
    expect(r.perLine).toEqual({ v1: 999, v3: 1_999 });
    for (const l of input) expect(r.perLine[l.variationId] ?? 0).toBeLessThanOrEqual(l.total);
  });

  it('cùng một số dù thứ tự dòng khác nhau', () => {
    const a = allocateGreenBox(lines(5), TIERS);
    const b = allocateGreenBox([...lines(5)].reverse(), TIERS);
    expect(b).toEqual(a);
  });

  it('không có bậc thì không giảm', () => {
    expect(allocateGreenBox(lines(9), []).total).toBe(0);
  });
});

describe('isGreenBoxEligible', () => {
  const none = { perLine: {} };
  it.each([
    ['Giờ vàng', line(1, { isFlash: true })],
    ['hàng đối tác / gian hàng tự giao', line(1, { tubu: false })],
    ['hết hàng', line(1, { inStock: false })],
    ['quà 0đ', line(1, { total: 0 })],
    ['số lượng 0', line(1, { quantity: 0 })],
  ])('không tính dòng %s', (_l, l) => {
    expect(isGreenBoxEligible(l, none)).toBe(false);
  });

  it('không tính dòng đang có giảm combo, hay là dòng khoá của bộ mua kèm đang áp', () => {
    expect(isGreenBoxEligible(line(1), { perLine: { v1: 5_000 } })).toBe(false);
    expect(isGreenBoxEligible(line(1), { perLine: {}, keyVariationIds: new Set(['v1']) })).toBe(false);
    expect(isGreenBoxEligible(line(1), { perLine: { v1: 0 } })).toBe(true);
  });
});

describe('greenBoxLineOf và comboKeyIds', () => {
  it('Tubu giao và không phải hàng đối tác; tồn phải đủ cho số lượng', () => {
    const base = { variationId: 'v', productId: 'p', total: 1, quantity: 2, isFlash: false, stock: 2, fulfiller: { kind: 'TUBU' } };
    expect(greenBoxLineOf(base)).toMatchObject({ tubu: true, inStock: true });
    expect(greenBoxLineOf({ ...base, partnerOwned: true }).tubu).toBe(false);
    expect(greenBoxLineOf({ ...base, fulfiller: { kind: 'MERCHANT' } }).tubu).toBe(false);
    expect(greenBoxLineOf({ ...base, stock: 1 }).inStock).toBe(false);
  });

  it('chỉ lấy dòng khoá của nhóm có giảm', () => {
    expect(comboKeyIds([{ keyVariationIds: ['a'], discount: 1 }, { keyVariationIds: ['b'], discount: 0 }])).toEqual(new Set(['a']));
  });
});

describe('applyGreenBox: gộp vào đường combo', () => {
  it('cờ tắt: trả lại đúng đối tượng combo, không giảm thêm', () => {
    const combo = { total: 5_000, perLine: { v9: 5_000 } };
    const r = applyGreenBox(combo, lines(9), GREEN_BOX_OFF);
    expect(r.combo).toBe(combo);
    expect(r.greenBox).toBeNull();
  });

  it('bật mà chưa đủ bậc: combo giữ nguyên, có tiến độ để vẽ', () => {
    const r = applyGreenBox(NO_COMBO, lines(2), ON);
    expect(r.combo).toBe(NO_COMBO);
    expect(r.greenBox).toMatchObject({ items: 2, tier: null, next: { minItems: 3, pct: 3 }, total: 0 });
  });

  it('dòng có combo không được giảm hai lần, và không được đếm', () => {
    const combo = { total: 10_000, perLine: { v1: 10_000 } };
    const r = applyGreenBox(combo, lines(3), ON);
    expect(r.greenBox?.items).toBe(2);
    expect(r.combo).toBe(combo);
    const r4 = applyGreenBox(combo, lines(4), ON);
    expect(r4.combo.perLine).toEqual({ v1: 10_000, v2: 3_000, v3: 3_000, v4: 3_000 });
    expect(r4.combo.total).toBe(19_000);
  });

  it('giữ trường khác của kết quả combo (nhóm của giỏ) nguyên vẹn', () => {
    const combo = { total: 0, perLine: {}, groups: [{ id: 'bundle:x' }] };
    expect(applyGreenBox(combo, lines(3), ON).combo.groups).toBe(combo.groups);
  });
});

describe('thứ tự áp: Hộp Xanh → mã → hạng → Điểm Xanh (qua đường combo có sẵn)', () => {
  const cart = lines(3);
  const { combo } = applyGreenBox(NO_COMBO, cart, ON);

  it('nền tính mã (và đơn tối thiểu của mã) là tiền hàng SAU Hộp Xanh', () => {
    expect(goodsAfterComboOf(cart, combo).goodsAfterCombo).toBe(300_000 - 9_000);
  });

  it('mã, hạng và điểm chia trên phần còn lại; tổng các dòng = tiền hàng trừ mọi khoản giảm', () => {
    const split = cart.map((l) => ({ ...l, fulfiller: { kind: 'TUBU' as const, name: 'Tubu Tree', storefrontId: null, ownerUserId: null } }));
    const per = allocateLineAmounts(split as Parameters<typeof allocateLineAmounts>[0], {
      comboPerLine: combo.perLine,
      comboTotal: combo.total,
      couponDiscount: 29_100,
      couponProductIds: null,
      tierDiscount: 0,
      pointsDiscount: 10_000,
      pointsUsed: 10_000,
      pointsUsedConverted: 0,
    });
    expect(per.map((l) => l.combo)).toEqual([3_000, 3_000, 3_000]);
    expect(per.reduce((s, l) => s + l.paid, 0)).toBe(300_000 - 9_000 - 29_100 - 10_000);
    expect(per.every((l) => l.paid >= 0)).toBe(true);
  });

  it('điểm tích tính trên tiền hàng sau Hộp Xanh', () => {
    expect(pointsForGoods(300_000 - combo.total, 2)).toBe(5_820);
  });
});

describe('yieldGreenBoxToCoupon: Hộp Xanh nhường mã mà nó làm hụt đơn tối thiểu', () => {
  const withBox = { goods: 295_850 };
  const withoutBox = { goods: 305_000 };
  const minOrder = (min: number) => async (b: { goods: number }) => {
    if (b.goods < min) throw new CouponMinOrderError(min, b.goods);
  };

  it('mã đạt cả khi đã trừ Hộp Xanh: giữ Hộp Xanh', async () => {
    await expect(yieldGreenBoxToCoupon(withBox, withoutBox, minOrder(200_000))).resolves.toBe(withBox);
  });

  it('mã chỉ hụt vì Hộp Xanh: bỏ Hộp Xanh, khách được mã như khi cờ tắt', async () => {
    await expect(yieldGreenBoxToCoupon(withBox, withoutBox, minOrder(300_000))).resolves.toBe(withoutBox);
  });

  it('mã hụt cả khi chưa trừ Hộp Xanh: giữ Hộp Xanh', async () => {
    await expect(yieldGreenBoxToCoupon(withBox, withoutBox, minOrder(400_000))).resolves.toBe(withBox);
  });

  it('mã hỏng vì lý do khác (hết hạn, hết lượt): giữ Hộp Xanh, không xét lại', async () => {
    const validate = jest.fn(async () => {
      throw new BadRequestException('Mã giảm giá đã hết hạn hoặc chưa hiệu lực.');
    });
    await expect(yieldGreenBoxToCoupon(withBox, withoutBox, validate)).resolves.toBe(withBox);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('lỗi hạ tầng không bị nuốt', async () => {
    await expect(yieldGreenBoxToCoupon(withBox, withoutBox, async () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
  });
});
