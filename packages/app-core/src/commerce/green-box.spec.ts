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
  greenBoxStepper,
  greenBoxWebCopy,
  pickSubscriptionSuggestion,
  previewGreenBox,
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

describe('previewGreenBox (bậc xem trước của giỏ khách)', () => {
  it('chọn bậc như máy chủ: mốc cao nhất đã đủ, bậc kế là mốc nhỏ nhất chưa đủ; không hứa số tiền', () => {
    expect(previewGreenBox(TIERS, 0)).toEqual({ items: 0, tier: null, next: TIERS[0], tiers: TIERS, discount: 0 });
    expect(previewGreenBox(TIERS, 4)).toEqual({ items: 4, tier: TIERS[0], next: TIERS[1], tiers: TIERS, discount: 0 });
    expect(previewGreenBox(TIERS, 9)).toEqual({ items: 9, tier: TIERS[2], next: null, tiers: TIERS, discount: 0 });
  });

  it('bảng bậc do máy chủ trả (không ghi cứng 3/5/7): bậc lộn thứ tự được xếp lại, bậc hỏng bị bỏ', () => {
    const tiers = [{ minItems: 6, pct: 8 }, { minItems: 2, pct: 2 }, { minItems: 0, pct: 5 }, { minItems: 4, pct: Number.NaN }];
    expect(previewGreenBox(tiers, 3)).toEqual({ items: 3, tier: { minItems: 2, pct: 2 }, next: { minItems: 6, pct: 8 }, tiers: [{ minItems: 2, pct: 2 }, { minItems: 6, pct: 8 }], discount: 0 });
    expect(previewGreenBox([], 3)).toBeNull();
  });

  it('số món âm, lẻ hay hỏng: về số nguyên không âm', () => {
    expect(previewGreenBox(TIERS, -2)?.items).toBe(0);
    expect(previewGreenBox(TIERS, 3.7)?.items).toBe(3);
    expect(previewGreenBox(TIERS, Number.NaN)?.items).toBe(0);
  });
});

describe('greenBoxStepper (thanh nhiều bậc)', () => {
  it('mỗi bậc một đoạn, đầy dần từ mốc trước; số món còn thiếu và nhãn bậc kế', () => {
    const v = greenBoxStepper(state(4))!;
    expect(v.steps.map((s) => [s.itemsText, s.pctText, s.reached, s.fill])).toEqual([
      ['3 món', '-3%', true, 100],
      ['5 món', '-5%', false, 50],
      ['7 món', '-7%', false, 0],
    ]);
    expect(v).toMatchObject({ missing: 1, done: false, text: 'Thêm 1 món nữa', badge: 'Giảm 5%' });
    expect(v.steps[0]!.spoken).toBe('Mốc 3 món giảm 3%, đã đạt');
    expect(v.steps[1]!.spoken).toBe('Mốc 5 món giảm 5%, chưa đạt');
  });

  it('0 món: đoạn đầu rỗng, thiếu đủ số món của bậc đầu', () => {
    const v = greenBoxStepper(state(0))!;
    expect(v.steps.map((s) => s.fill)).toEqual([0, 0, 0]);
    expect(v).toMatchObject({ missing: 3, text: 'Thêm 3 món nữa', badge: 'Giảm 3%' });
    expect(greenBoxStepper(state(1))!.steps[0]!.fill).toBe(33);
  });

  it('đã ở bậc cao nhất: mọi đoạn đầy, nhãn là bậc đang giữ', () => {
    const v = greenBoxStepper(state(8))!;
    expect(v.steps.every((s) => s.reached && s.fill === 100)).toBe(true);
    expect(v).toMatchObject({ missing: 0, done: true, text: 'Đã đạt mức giảm cao nhất', badge: 'Giảm 7%' });
  });

  it('bậc đổi ở cấu hình thì thanh đổi theo (số bậc, mốc, %)', () => {
    const tiers = [{ minItems: 2, pct: 4 }, { minItems: 10, pct: 9 }];
    const v = greenBoxStepper(previewGreenBox(tiers, 6))!;
    expect(v.steps.map((s) => [s.itemsText, s.pctText, s.fill])).toEqual([
      ['2 món', '-4%', 100],
      ['10 món', '-9%', 50],
    ]);
    expect(v).toMatchObject({ missing: 4, badge: 'Giảm 9%' });
  });

  it('không có trạng thái hay không có bậc: null', () => {
    expect(greenBoxStepper(null)).toBeNull();
    expect(greenBoxStepper({ items: 2, tier: null, next: null, tiers: [], discount: 0 })).toBeNull();
  });
});

describe('greenBoxBarText (xem trước)', () => {
  it('bậc tự tính ở máy khách nói "dự kiến giảm"; chưa đạt bậc thì chỉ đếm món', () => {
    expect(greenBoxBarText(previewGreenBox(TIERS, 5), { preview: true })).toBe('Đã chọn 5 món · dự kiến giảm 5%');
    expect(greenBoxBarText(previewGreenBox(TIERS, 2), { preview: true })).toBe('Đã chọn 2 món');
    expect(greenBoxBarText(state(5))).toBe('Đã chọn 5 món · giảm 5%');
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
