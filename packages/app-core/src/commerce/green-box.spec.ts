import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS, SHOP_COPY } from '../shop-copy';
import { claimsIn } from './copy-claims-guard';
import {
  GREEN_BOX_WEB_COPY,
  GREEN_BOX_WEB_COPY_MAX,
  cartProgressStrip,
  comboOnlyDiscount,
  greenBoxBarText,
  greenBoxCartHint,
  greenBoxDiscountOf,
  greenBoxPageIntro,
  greenBoxProgress,
  greenBoxTierRise,
  greenBoxWebCopy,
  pickSubscriptionSuggestion,
  readGreenBox,
  readSubscriptionSuggestions,
  subscriptionSuggestionText,
  type GreenBoxState,
  type GreenBoxWebCopyKey,
  type SubscriptionSuggestion,
} from './green-box';

const TIERS = [
  { minItems: 3, pct: 3 },
  { minItems: 5, pct: 5 },
  { minItems: 7, pct: 7 },
];

const state = (items: number, discount = 0): GreenBoxState => {
  const tier = [...TIERS].reverse().find((t) => t.minItems <= items) ?? null;
  const next = TIERS.find((t) => t.minItems > items) ?? null;
  return { items, tier, next, tiers: TIERS, discount };
};

describe('readGreenBox', () => {
  it('thiếu trường, sai dạng hoặc không có bậc thì null', () => {
    expect(readGreenBox(undefined)).toBeNull();
    expect(readGreenBox({})).toBeNull();
    expect(readGreenBox({ greenBox: 'x' })).toBeNull();
    expect(readGreenBox({ greenBox: { items: 2, tiers: [] } })).toBeNull();
    expect(readGreenBox({ greenBox: { items: -1, tiers: TIERS } })).toBeNull();
  });

  it('đọc đúng dữ liệu máy chủ, bỏ bậc hỏng', () => {
    const r = readGreenBox({ greenBox: { items: 4, tier: TIERS[0], next: TIERS[1], tiers: [...TIERS, { minItems: 'x' }], discount: 12000 } });
    expect(r).toEqual({ items: 4, tier: TIERS[0], next: TIERS[1], tiers: TIERS, discount: 12000 });
  });
});

describe('greenBoxDiscountOf / comboOnlyDiscount', () => {
  it('tách phần Hộp Xanh khỏi comboDiscount', () => {
    expect(greenBoxDiscountOf({ comboDiscount: 30000, greenBoxDiscount: 9000 })).toBe(9000);
    expect(comboOnlyDiscount({ comboDiscount: 30000, greenBoxDiscount: 9000 })).toBe(21000);
  });

  it('API cũ hoặc cờ tắt: Hộp Xanh 0, combo giữ nguyên', () => {
    expect(greenBoxDiscountOf({ comboDiscount: 30000 })).toBe(0);
    expect(comboOnlyDiscount({ comboDiscount: 30000 })).toBe(30000);
    expect(comboOnlyDiscount(null)).toBe(0);
  });

  it('kẹp trong [0, comboDiscount] để dòng combo không âm', () => {
    expect(greenBoxDiscountOf({ comboDiscount: 5000, greenBoxDiscount: 9000 })).toBe(5000);
    expect(comboOnlyDiscount({ comboDiscount: 5000, greenBoxDiscount: 9000 })).toBe(0);
    expect(greenBoxDiscountOf({ comboDiscount: 5000, greenBoxDiscount: -1 })).toBe(0);
  });
});

describe('greenBoxProgress', () => {
  it('chưa đạt bậc nào: còn n món tới bậc đầu', () => {
    const v = greenBoxProgress(state(1))!;
    expect(v.text).toBe('Ghép Hộp Xanh: thêm 2 món nữa giảm 3%');
    expect(v.done).toBe(false);
    expect(v.marksText).toBe('Mốc 3 · 5 · 7 món');
    expect(v.pct).toBe(14);
  });

  it('đang ở bậc giữa: nói mức đang giảm và mức kế tiếp', () => {
    const v = greenBoxProgress(state(4))!;
    expect(v.text).toBe('Hộp Xanh đang giảm 3%. Thêm 1 món nữa giảm 5%');
    expect(v.pct).toBe(57);
  });

  it('bậc cao nhất: một dòng xác nhận, thanh đầy', () => {
    const v = greenBoxProgress(state(9))!;
    expect(v.done).toBe(true);
    expect(v.pct).toBe(100);
    expect(v.text).toBe('Hộp Xanh đã giảm 7%, mức cao nhất');
  });

  it('không có dữ liệu thì null', () => {
    expect(greenBoxProgress(null)).toBeNull();
  });
});

describe('dải tiến độ trong giỏ', () => {
  it('chỉ một dải: chưa miễn phí giao thì dải miễn phí giao', () => {
    expect(cartProgressStrip(false, state(2))).toBe('freeship');
    expect(cartProgressStrip(true, state(2))).toBe('greenBox');
    expect(cartProgressStrip(true, null)).toBe('freeship');
  });

  it('dòng gợi ý dưới tổng tiền', () => {
    expect(greenBoxCartHint(state(1))).toBe('Thêm 2 món nữa giảm 3% Hộp Xanh');
    expect(greenBoxCartHint(state(6))).toBe('Thêm 1 món nữa giảm 7% Hộp Xanh');
    expect(greenBoxCartHint(state(7))).toBeNull();
    expect(greenBoxCartHint(null)).toBeNull();
  });
});

describe('trang ghép hộp', () => {
  it('thanh đáy', () => {
    expect(greenBoxBarText(state(2))).toBe('Đã chọn 2 món');
    expect(greenBoxBarText(state(5))).toBe('Đã chọn 5 món · giảm 5%');
    expect(greenBoxBarText(null)).toBe('Đã chọn 0 món');
  });

  it('câu mở đầu dựng từ bảng bậc', () => {
    expect(greenBoxPageIntro(TIERS)).toBe('Ghép nhiều món khác nhau vào giỏ: từ 3 món giảm 3%, từ 5 món giảm 5%, từ 7 món giảm 7%.');
  });
});

describe('greenBoxTierRise', () => {
  it('chỉ báo khi bậc tăng, không báo lần đọc đầu', () => {
    expect(greenBoxTierRise(null, 3)).toBeNull();
    expect(greenBoxTierRise(0, 3)).toBe(3);
    expect(greenBoxTierRise(3, 5)).toBe(5);
    expect(greenBoxTierRise(5, 3)).toBeNull();
    expect(greenBoxTierRise(5, 5)).toBeNull();
  });
});

describe('gợi ý định kỳ', () => {
  const s = (variationId: string, intervalWeeks = 4): SubscriptionSuggestion => ({
    variationId,
    productName: `SP ${variationId}`,
    variationName: '500g',
    slug: null,
    thumbnail: null,
    unitPrice: 50000,
    intervalWeeks,
    lastDeliveredAt: '2026-11-01T00:00:00.000Z',
  });

  it('cờ tắt, API cũ hay dữ liệu hỏng đều rỗng', () => {
    expect(readSubscriptionSuggestions(undefined)).toEqual([]);
    expect(readSubscriptionSuggestions({ enabled: false, items: [s('a')] })).toEqual([]);
    expect(readSubscriptionSuggestions({ enabled: true, items: [s('a', 5), { variationId: 1 }] })).toEqual([]);
  });

  it('giữ gợi ý hợp lệ, chọn theo phân loại đang xem', () => {
    const list = readSubscriptionSuggestions({ enabled: true, items: [s('a'), s('b', 8)] });
    expect(list.map((x) => x.variationId)).toEqual(['a', 'b']);
    expect(pickSubscriptionSuggestion(list)?.variationId).toBe('a');
    expect(pickSubscriptionSuggestion(list, ['x', 'b'])?.variationId).toBe('b');
    expect(pickSubscriptionSuggestion(list, ['x'])).toBeNull();
  });

  it('câu gợi ý đọc phần trăm từ cấu hình', () => {
    expect(subscriptionSuggestionText(s('a', 8), 0.05)).toBe('Bạn thường mua SP a khoảng 8 tuần một lần. Đặt giao định kỳ, giảm 5%');
  });
});

describe('GREEN_BOX_WEB_COPY', () => {
  const worst = { n: '99', pct: '10', tiers: 'từ 3 món giảm 3%, từ 5 món giảm 5%, từ 7 món giảm 7%', name: 'Nước rửa chén enzyme vỏ dứa 500ml' };

  it('không thuật ngữ cấm, không nhắc tre, không vượt ngân sách khi điền giá trị xấu nhất', () => {
    for (const key of Object.keys(GREEN_BOX_WEB_COPY) as GreenBoxWebCopyKey[]) {
      const text = greenBoxWebCopy(key, worst);
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(text, `${key}: dùng "${use}"`).not.toMatch(pattern);
      expect(text.toLowerCase(), key).not.toMatch(/(^|[^\p{L}])tre([^\p{L}]|$)|bamboo/u);
      const cap = GREEN_BOX_WEB_COPY_MAX[key];
      if (cap) expect(text.length, key).toBeLessThanOrEqual(cap);
    }
  });

  // Bộ chặn tuyên bố bắt mọi "{số}%" (viết cho mô tả sản phẩm), nên chạy trên câu mẫu: mức giảm là số cấu hình máy chủ điền vào, không phải chữ ta viết.
  it('câu mẫu (cả các khoá greenBox.* của SHOP_COPY) không có tuyên bố y tế/tự nhiên/chứng nhận', () => {
    const templates = [...Object.entries(GREEN_BOX_WEB_COPY), ...Object.entries(SHOP_COPY).filter(([k]) => k.startsWith('greenBox.'))];
    expect(templates.length).toBeGreaterThan(Object.keys(GREEN_BOX_WEB_COPY).length);
    for (const [key, text] of templates) expect(claimsIn(text), key).toEqual([]);
  });

  it('thiếu biến thì báo lỗi, không in "{n}" ra màn hình', () => {
    expect(() => greenBoxWebCopy('barSelected', { n: 3 })).toThrow();
  });
});
