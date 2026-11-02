import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { buyNowMergeNote, flashLimitFor, flashLinePreview, flashQuotaLeftFor, inCartQuantity, lineNote, overLimitNote, variationLinePreview } from './flash-line';

/**
 * Đối chiếu với luật máy chủ `priceFlashLine` (apps/api/src/modules/flash-sale/flash-line-price.ts): file API được chuyển sang CommonJS rồi chạy
 * thật, không chép lại luật vào spec. `import type` bị bỏ khi chuyển nên không kéo cả `FlashSaleService` vào.
 */
type EffectivePriceLike = { flashPrice: number; allowance?: number; quotaLeft?: number; perUserLeft?: number };
type PriceFlashLine = (standing: number, quantity: number, offer: EffectivePriceLike | undefined) => { unitPrice: number };

function loadServerRule(): PriceFlashLine {
  const file = fileURLToPath(new URL('../../../../apps/api/src/modules/flash-sale/flash-line-price.ts', import.meta.url));
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod: { exports: { priceFlashLine?: PriceFlashLine } } = { exports: {} };
  new Function('exports', 'module', js)(mod.exports, mod);
  if (!mod.exports.priceFlashLine) throw new Error('flash-line-price.ts không còn xuất priceFlashLine');
  return mod.exports.priceFlashLine;
}

const server = loadServerRule();

const STANDING = 35_000;
const FLASH = 26_000;
const LIMIT = 3;

describe('flashLinePreview khớp priceFlashLine của máy chủ', () => {
  // `limit` null = client không biết giới hạn: máy chủ cũng coi là đủ suất khi `allowance` không có.
  const cases: { name: string; standing: number; flashPrice: number | null; limit: number | null; quantity: number; overLimit: boolean }[] = [
    { name: 'qty 1 trong giới hạn', standing: STANDING, flashPrice: FLASH, limit: LIMIT, quantity: 1, overLimit: false },
    { name: 'qty = limit vẫn giá Giờ vàng', standing: STANDING, flashPrice: FLASH, limit: LIMIT, quantity: LIMIT, overLimit: false },
    { name: 'qty = limit + 1 thì cả dòng giá thường', standing: STANDING, flashPrice: FLASH, limit: LIMIT, quantity: LIMIT + 1, overLimit: true },
    { name: 'qty 5 vượt giới hạn 3', standing: STANDING, flashPrice: FLASH, limit: LIMIT, quantity: 5, overLimit: true },
    { name: 'không biết giới hạn (null) thì không vượt', standing: STANDING, flashPrice: FLASH, limit: null, quantity: 9, overLimit: false },
    { name: 'giá Giờ vàng cao hơn giá đang bán, trong giới hạn', standing: STANDING, flashPrice: 40_000, limit: LIMIT, quantity: 2, overLimit: false },
    { name: 'giá Giờ vàng cao hơn giá đang bán, vượt giới hạn: khách không mất gì nên không báo', standing: STANDING, flashPrice: 40_000, limit: LIMIT, quantity: 5, overLimit: false },
    { name: 'giá Giờ vàng bằng giá đang bán, vượt giới hạn', standing: STANDING, flashPrice: STANDING, limit: LIMIT, quantity: 5, overLimit: false },
    { name: 'không có Giờ vàng', standing: STANDING, flashPrice: null, limit: LIMIT, quantity: 5, overLimit: false },
  ];

  it.each(cases)('$name', ({ standing, flashPrice, limit, quantity, overLimit }) => {
    const offer = flashPrice === null ? undefined : { flashPrice, ...(limit === null ? {} : { allowance: limit }) };
    const expected = server(standing, quantity, offer);
    const got = flashLinePreview({ standing, flashPrice, quantity, limit });
    expect(got.unitPrice).toBe(expected.unitPrice);
    expect(got.total).toBe(expected.unitPrice * quantity);
    expect(got.overLimit).toBe(overLimit);
  });

  it('số cụ thể của báo cáo: 5 × giá thường 35.000 = 175.000, không phải 5 × 26.000', () => {
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 5, limit: LIMIT })).toMatchObject({ unitPrice: 35_000, total: 175_000, overLimit: true });
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 4, limit: LIMIT }).total).toBe(140_000);
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 3, limit: LIMIT }).total).toBe(78_000);
  });

  it('giới hạn 0, âm, NaN hoặc undefined là chưa biết giới hạn (như slotItemNote), không phải "hết suất"', () => {
    for (const limit of [0, -2, Number.NaN, undefined]) {
      expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 5, limit })).toMatchObject({ unitPrice: 26_000, total: 130_000, overLimit: false });
    }
  });
});

describe('flashLimitFor', () => {
  it('chỉ nhận số hữu hạn lớn hơn 0', () => {
    expect(flashLimitFor({ perUserLimit: 3 })).toBe(3);
    expect(flashLimitFor({ perUserLimit: 0 })).toBeNull();
    expect(flashLimitFor({ perUserLimit: null })).toBeNull();
    expect(flashLimitFor({})).toBeNull();
    expect(flashLimitFor(undefined)).toBeNull();
    expect(flashLimitFor({ perUserLimit: Number.NaN })).toBeNull();
  });
});

describe('variationLinePreview', () => {
  const variation = { id: 'v1', retailPrice: 35_000, salePrice: null };
  const flash = (extra: object = {}) => [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, perUserLimit: LIMIT, ...extra }];

  it('phân loại đang Giờ vàng có giới hạn: nêu limit và tính theo máy chủ', () => {
    const inside = variationLinePreview(variation, flash(), 3);
    expect(inside).toMatchObject({ limit: 3, unitPrice: 26_000, total: 78_000, overLimit: false });
    expect(inside.pricing.isFlash).toBe(true);
    expect(variationLinePreview(variation, flash(), 5)).toMatchObject({ limit: 3, unitPrice: 35_000, total: 175_000, overLimit: true });
  });

  it('giá đang bán của chính phân loại là mốc so (salePrice thấp hơn giá niêm yết)', () => {
    const onSale = { id: 'v1', retailPrice: 40_000, salePrice: 35_000 };
    expect(variationLinePreview(onSale, flash(), 5)).toMatchObject({ unitPrice: 35_000, total: 175_000, overLimit: true });
  });

  it('không có suất Giờ vàng cho phân loại: giá đang bán, không giới hạn, không vượt', () => {
    expect(variationLinePreview(variation, [], 5)).toMatchObject({ limit: null, unitPrice: 35_000, total: 175_000, overLimit: false });
    expect(variationLinePreview(variation, flash({ variationId: 'khác' }), 5)).toMatchObject({ limit: null, overLimit: false });
  });

  it('API cũ không gửi perUserLimit: giá Giờ vàng cho mọi số lượng, không ghi chú', () => {
    const noLimit = [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH }];
    expect(variationLinePreview(variation, noLimit, 9)).toMatchObject({ limit: null, unitPrice: 26_000, total: 234_000, overLimit: false });
  });

  it('Giờ vàng không rẻ hơn giá đang bán: không phải Giờ vàng, không nêu giới hạn', () => {
    const preview = variationLinePreview(variation, flash({ flashPrice: 40_000 }), 5);
    expect(preview.pricing.isFlash).toBe(false);
    expect(preview).toMatchObject({ limit: null, unitPrice: 35_000, total: 175_000, overLimit: false });
  });
});

describe('flashQuotaLeftFor', () => {
  it('quota - soldCount khi có cả hai số và còn suất; thiếu số hoặc hết thì null', () => {
    expect(flashQuotaLeftFor({ quota: 10, soldCount: 8 })).toBe(2);
    expect(flashQuotaLeftFor({ quota: 10, soldCount: 10 })).toBeNull();
    expect(flashQuotaLeftFor({ quota: 10, soldCount: 12 })).toBeNull();
    expect(flashQuotaLeftFor({ quota: 10 })).toBeNull();
    expect(flashQuotaLeftFor({ soldCount: 3 })).toBeNull();
    expect(flashQuotaLeftFor({ quota: Number.NaN, soldCount: 1 })).toBeNull();
    expect(flashQuotaLeftFor(undefined)).toBeNull();
  });
});

describe('variationLinePreview: suất còn lại của đợt cũng là giới hạn (allowance = min(suất còn lại, giới hạn mỗi khách))', () => {
  const variation = { id: 'v1', retailPrice: STANDING, salePrice: null };
  const item = (extra: object) => [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, ...extra }];

  it('đợt gần hết suất: quota 10, đã bán 8, giới hạn khách 5 thì chỉ 2 sản phẩm giá Giờ vàng, như máy chủ', () => {
    const flash = item({ quota: 10, soldCount: 8, perUserLimit: 5 });
    // Máy chủ: allowance = min(quotaLeft 2, perUserLeft 5) = 2. Khách mới (chưa mua) nên perUserLeft = perUserLimit.
    const offer = { flashPrice: FLASH, quotaLeft: 2, perUserLeft: 5, allowance: 2 };
    for (const qty of [1, 2, 3, 5]) {
      const got = variationLinePreview(variation, flash, qty);
      expect(got.total).toBe(server(STANDING, qty, offer).unitPrice * qty);
      expect(got).toMatchObject({ limit: 5, allowance: 2, allowanceBy: 'quota', overLimit: qty > 2 });
    }
    expect(variationLinePreview(variation, flash, 3).total).toBe(105_000);
  });

  it('suất còn lại nhiều hơn giới hạn của khách: giới hạn của khách chặn', () => {
    const got = variationLinePreview(variation, item({ quota: 100, soldCount: 10, perUserLimit: 3 }), 4);
    expect(got).toMatchObject({ limit: 3, allowance: 3, allowanceBy: 'perUser', overLimit: true, total: 140_000 });
  });

  it('suất còn lại bằng giới hạn của khách: nói theo giới hạn của khách', () => {
    expect(variationLinePreview(variation, item({ quota: 10, soldCount: 7, perUserLimit: 3 }), 4)).toMatchObject({ allowance: 3, allowanceBy: 'perUser', overLimit: true });
  });

  it('API không gửi perUserLimit nhưng có quota: suất còn lại vẫn là giới hạn, giới hạn mỗi khách vẫn null (không ghi "Tối đa n/khách")', () => {
    expect(variationLinePreview(variation, item({ quota: 10, soldCount: 8 }), 3)).toMatchObject({ limit: null, allowance: 2, allowanceBy: 'quota', overLimit: true, total: 105_000 });
  });

  it('không có số suất nào: không giới hạn', () => {
    expect(variationLinePreview(variation, item({}), 9)).toMatchObject({ limit: null, allowance: null, allowanceBy: null, overLimit: false, total: 234_000 });
  });
});

describe('overLimitNote', () => {
  const variation = { id: 'v1', retailPrice: STANDING, salePrice: null };
  const item = (extra: object) => [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, ...extra }];

  it('vượt giới hạn mỗi khách: nêu giới hạn và số đang mua', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 5);
    expect(overLimitNote(line, 5)).toBe('Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 5 thì cả dòng tính giá thường.');
  });

  it('vượt số suất còn lại của đợt: câu riêng, không "Chỉ còn", viết hoa Giờ vàng', () => {
    const line = variationLinePreview(variation, item({ quota: 10, soldCount: 8, perUserLimit: 5 }), 3);
    const note = overLimitNote(line, 3);
    expect(note).toBe('Giờ vàng còn 2 suất. Mua 3 thì cả dòng tính giá thường.');
    expect(note).not.toMatch(/Chỉ còn/);
  });

  it('trong giới hạn hoặc không đổi giá thì không có ghi chú', () => {
    expect(overLimitNote(variationLinePreview(variation, item({ perUserLimit: 3 }), 3), 3)).toBeNull();
    expect(overLimitNote(variationLinePreview(variation, [], 5), 5)).toBeNull();
    expect(overLimitNote(variationLinePreview(variation, item({ perUserLimit: 3, flashPrice: 40_000 }), 5), 5)).toBeNull();
  });
});

describe('flashLinePreview với số đã có trong giỏ: khớp priceFlashLine trên CẢ dòng giỏ (thêm giỏ là increment)', () => {
  const cases: {
    name: string; flashPrice: number | null; limit: number | null; inCart: number; quantity: number;
    unitPrice: number; lineTotal: number; total: number; overLimit: boolean;
  }[] = [
    { name: 'giỏ rỗng: như trước (qty 2 = 52.000)', flashPrice: FLASH, limit: LIMIT, inCart: 0, quantity: 2, unitPrice: 26_000, lineTotal: 52_000, total: 52_000, overLimit: false },
    { name: 'giỏ 1 + thêm 2 = đúng limit: vẫn giá Giờ vàng', flashPrice: FLASH, limit: LIMIT, inCart: 1, quantity: 2, unitPrice: 26_000, lineTotal: 78_000, total: 52_000, overLimit: false },
    { name: 'ví dụ reviewer: giỏ 2 + thêm 2 = limit + 1, cả 4 giá thường (giỏ tăng 88.000)', flashPrice: FLASH, limit: LIMIT, inCart: 2, quantity: 2, unitPrice: 35_000, lineTotal: 140_000, total: 88_000, overLimit: true },
    { name: 'giỏ đang đúng limit, thêm 1: cả dòng chuyển giá thường', flashPrice: FLASH, limit: LIMIT, inCart: 3, quantity: 1, unitPrice: 35_000, lineTotal: 140_000, total: 62_000, overLimit: true },
    { name: 'giỏ đã vượt sẵn (5 > 3): thêm 2, phần thêm cũng giá thường, tổng không âm', flashPrice: FLASH, limit: LIMIT, inCart: 5, quantity: 2, unitPrice: 35_000, lineTotal: 245_000, total: 70_000, overLimit: true },
    { name: 'không biết giới hạn: giỏ có sẵn vẫn không vượt', flashPrice: FLASH, limit: null, inCart: 2, quantity: 5, unitPrice: 26_000, lineTotal: 182_000, total: 130_000, overLimit: false },
    { name: 'giá Giờ vàng cao hơn giá đang bán: khách không mất gì nên không báo', flashPrice: 40_000, limit: LIMIT, inCart: 2, quantity: 5, unitPrice: 35_000, lineTotal: 245_000, total: 175_000, overLimit: false },
    { name: 'không có Giờ vàng, giỏ có sẵn', flashPrice: null, limit: LIMIT, inCart: 2, quantity: 1, unitPrice: 35_000, lineTotal: 105_000, total: 35_000, overLimit: false },
  ];

  it.each(cases)('$name', ({ flashPrice, limit, inCart, quantity, unitPrice, lineTotal, total, overLimit }) => {
    const offer = flashPrice === null ? undefined : { flashPrice, ...(limit === null ? {} : { allowance: limit }) };
    const wholeLine = server(STANDING, inCart + quantity, offer).unitPrice;
    const existing = inCart > 0 ? server(STANDING, inCart, offer).unitPrice * inCart : 0;
    const got = flashLinePreview({ standing: STANDING, flashPrice, quantity, limit, inCart });
    expect(got.unitPrice).toBe(wholeLine);
    expect(got.lineTotal).toBe(wholeLine * (inCart + quantity));
    expect(got.total).toBe(wholeLine * (inCart + quantity) - existing);
    expect(got).toEqual({ unitPrice, lineQuantity: inCart + quantity, inCart, lineTotal, total, overLimit });
    expect(got.total).toBeGreaterThanOrEqual(0);
  });

  it('inCart không hợp lệ (undefined, null, NaN, âm, vô cực) coi là 0; số lẻ lấy phần nguyên', () => {
    const base = flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 2, limit: LIMIT });
    for (const inCart of [undefined, null, Number.NaN, -2, Number.POSITIVE_INFINITY]) {
      expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 2, limit: LIMIT, inCart })).toEqual(base);
    }
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 2, limit: LIMIT, inCart: 2.9 })).toEqual(
      flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 2, limit: LIMIT, inCart: 2 }),
    );
  });
});

describe('variationLinePreview với số đã có trong giỏ', () => {
  const variation = { id: 'v1', retailPrice: STANDING, salePrice: null };
  const item = (extra: object) => [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, ...extra }];

  it('ví dụ reviewer: giới hạn 3, giỏ có 2, chọn thêm 2 → cả 4 giá thường, giỏ tăng 88.000, Mua ngay thanh toán 140.000', () => {
    expect(variationLinePreview(variation, item({ perUserLimit: 3 }), 2, 2)).toMatchObject({
      inCart: 2, lineQuantity: 4, unitPrice: 35_000, lineTotal: 140_000, total: 88_000, overLimit: true, allowance: 3, allowanceBy: 'perUser',
    });
  });

  it('đợt gần hết suất (quota 10, đã bán 8, giới hạn khách 5 → allowance 2): giỏ 1 + 1 vừa suất, giỏ 1 + 2 vượt', () => {
    const flash = item({ quota: 10, soldCount: 8, perUserLimit: 5 });
    expect(variationLinePreview(variation, flash, 1, 1)).toMatchObject({ lineQuantity: 2, overLimit: false, lineTotal: 52_000, total: 26_000 });
    expect(variationLinePreview(variation, flash, 2, 1)).toMatchObject({ lineQuantity: 3, overLimit: true, allowanceBy: 'quota', lineTotal: 105_000, total: 79_000 });
  });

  it('không có suất Giờ vàng: giỏ có 3 thêm 2 = 5 × giá thường, giỏ tăng 70.000', () => {
    expect(variationLinePreview(variation, [], 2, 3)).toMatchObject({ inCart: 3, lineTotal: 175_000, total: 70_000, overLimit: false, limit: null });
  });

  it('không truyền inCart: như K1 (giỏ rỗng)', () => {
    expect(variationLinePreview(variation, item({ perUserLimit: 3 }), 5)).toMatchObject({ inCart: 0, lineQuantity: 5, lineTotal: 175_000, total: 175_000, overLimit: true });
  });
});

describe('inCartQuantity', () => {
  const lines = [{ variationId: 'v1', quantity: 2 }, { variationId: 'v2', quantity: 4 }];

  it('chỉ khớp theo variationId; phân loại khác hoặc giỏ chưa có thì 0', () => {
    expect(inCartQuantity(lines, 'v1')).toBe(2);
    expect(inCartQuantity(lines, 'v2')).toBe(4);
    expect(inCartQuantity(lines, 'v3')).toBe(0);
    for (const none of [undefined, null, []]) expect(inCartQuantity(none, 'v1')).toBe(0);
  });

  it('dòng có quantity không hợp lệ không tính', () => {
    expect(inCartQuantity([{ variationId: 'v1', quantity: Number.NaN }], 'v1')).toBe(0);
    expect(inCartQuantity([{ variationId: 'v1', quantity: -3 }], 'v1')).toBe(0);
  });
});

describe('overLimitNote với giỏ có sẵn', () => {
  const variation = { id: 'v1', retailPrice: STANDING, salePrice: null };
  const item = (extra: object) => [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, ...extra }];

  it('ví dụ reviewer: nói giỏ đã có bao nhiêu và cả bao nhiêu sản phẩm tính giá thường', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 2, 2);
    expect(overLimitNote(line, 2)).toBe('Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.');
  });

  it('giỏ rỗng vẫn ra câu cũ', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 5, 0);
    expect(overLimitNote(line, 5)).toBe('Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 5 thì cả dòng tính giá thường.');
  });

  it('vượt do số suất còn lại của đợt mà giỏ có sẵn: vẫn câu giỏ, không "Chỉ còn" và không "giờ vàng" viết thường', () => {
    const line = variationLinePreview(variation, item({ quota: 10, soldCount: 8, perUserLimit: 5 }), 2, 1);
    const note = overLimitNote(line, 2);
    expect(note).toBe('Giỏ đã có 1. Thêm 2 thì cả 3 sản phẩm tính giá thường.');
    expect(note).not.toMatch(/Chỉ còn|giờ vàng/);
  });

  it('trong giới hạn (giỏ 1 + 2 = limit) hoặc không đổi giá thì không có ghi chú', () => {
    expect(overLimitNote(variationLinePreview(variation, item({ perUserLimit: 3 }), 2, 1), 2)).toBeNull();
    expect(overLimitNote(variationLinePreview(variation, [], 2, 3), 2)).toBeNull();
  });

  it('giỏ đúng bằng suất rồi thêm 1: chính phần thêm làm mất giá, vẫn câu "Thêm … thì cả …"', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 1, 3);
    expect(overLimitNote(line, 1)).toBe('Giỏ đã có 3. Thêm 1 thì cả 4 sản phẩm tính giá thường.');
  });

  it('giỏ đã vượt suất từ trước (5 > 3): nói dòng giỏ đang tính giá thường, không đổ cho phần thêm', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 1, 5);
    const note = overLimitNote(line, 1);
    expect(note).toBe('Giỏ đã có 5, quá 3 suất Giờ vàng nên cả dòng đang tính giá thường.');
    expect(note).not.toMatch(/Thêm 1/);
    // Chip và ô giá vẫn là giá Giờ vàng (giá một đơn vị), chỉ dòng giỏ mất giá.
    expect(line.pricing.isFlash).toBe(true);
    expect(line.pricing.price).toBe(FLASH);
    expect(line.unitPrice).toBe(STANDING);
  });

  it('giỏ đã vượt suất còn lại của đợt: cùng câu, nêu số suất đang áp', () => {
    const line = variationLinePreview(variation, item({ quota: 10, soldCount: 8, perUserLimit: 5 }), 1, 4);
    expect(overLimitNote(line, 1)).toBe('Giỏ đã có 4, quá 2 suất Giờ vàng nên cả dòng đang tính giá thường.');
  });
});

describe('buyNowMergeNote / lineNote: "Mua ngay" thanh toán cả dòng giỏ', () => {
  const variation = { id: 'v1', retailPrice: STANDING, salePrice: null };
  const item = (extra: object) => [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, ...extra }];

  it('giỏ có 2, chọn 1, chưa vượt suất: báo "Mua ngay" thanh toán cả 3 (nút ghi 78.000đ)', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 1, 2);
    expect(line.lineTotal).toBe(78_000);
    expect(buyNowMergeNote(line)).toBe('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
    expect(lineNote(line, 1, true)).toBe('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
  });

  it('giỏ chưa có phân loại: không có câu nào', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 1, 0);
    expect(buyNowMergeNote(line)).toBeNull();
    expect(lineNote(line, 1, true)).toBeNull();
  });

  it('không phải nơi có nút "Mua ngay" (bảng "Thêm vào giỏ") thì không nói', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 1, 2);
    expect(lineNote(line, 1, false)).toBeNull();
  });

  it('mất giá Giờ vàng thì chỉ câu mất giá (một vùng ghi chú, một câu)', () => {
    const line = variationLinePreview(variation, item({ perUserLimit: 3 }), 2, 2);
    expect(lineNote(line, 2, true)).toBe('Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.');
    expect(lineNote(line, 2, false)).toBe('Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.');
  });

  it('sản phẩm không Giờ vàng cũng thế: giỏ có 2 chọn 1 thì cả 3 × giá thường', () => {
    const line = variationLinePreview(variation, [], 1, 2);
    expect(line.lineTotal).toBe(105_000);
    expect(lineNote(line, 1, true)).toBe('Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.');
  });
});

describe('perUserLeft (số suất khách còn mua được sau các đơn trước) khớp priceFlashLine của máy chủ', () => {
  // Máy chủ: perUserLeft = max(0, perUserLimit - đã mua), allowance = min(quotaLeft, perUserLeft); quotaLeft chỉ nêu khi client biết.
  const cases: {
    name: string; perUserLeft: number | null | undefined; quotaLeft?: number; inCart?: number; quantity: number; unitPrice: number; overLimit: boolean;
  }[] = [
    { name: 'đã mua hết (0), chọn 1: cả dòng giá thường', perUserLeft: 0, quantity: 1, unitPrice: 35_000, overLimit: true },
    { name: 'đã mua hết (0), giỏ có sẵn 2 thêm 1', perUserLeft: 0, inCart: 2, quantity: 1, unitPrice: 35_000, overLimit: true },
    { name: 'còn 1 (nhỏ hơn giới hạn 3), chọn 1: giá Giờ vàng', perUserLeft: 1, quantity: 1, unitPrice: 26_000, overLimit: false },
    { name: 'còn 1, chọn 2: cả dòng giá thường', perUserLeft: 1, quantity: 2, unitPrice: 35_000, overLimit: true },
    { name: 'còn 2, chọn 2: vừa suất', perUserLeft: 2, quantity: 2, unitPrice: 26_000, overLimit: false },
    { name: 'còn 1, giỏ có 1 thêm 1: dòng giỏ thành 2 > 1', perUserLeft: 1, inCart: 1, quantity: 1, unitPrice: 35_000, overLimit: true },
    { name: 'còn 3 (= giới hạn), chọn 4', perUserLeft: 3, quantity: 4, unitPrice: 35_000, overLimit: true },
    { name: 'còn 5 (lớn hơn suất còn lại của đợt 2), chọn 2: vừa suất đợt', perUserLeft: 5, quotaLeft: 2, quantity: 2, unitPrice: 26_000, overLimit: false },
    { name: 'còn 5 (lớn hơn suất còn lại của đợt 2), chọn 3: suất đợt chặn', perUserLeft: 5, quotaLeft: 2, quantity: 3, unitPrice: 35_000, overLimit: true },
    { name: 'chưa biết (undefined): như trước', perUserLeft: undefined, quantity: 3, unitPrice: 26_000, overLimit: false },
    { name: 'chưa biết (null): như trước', perUserLeft: null, quantity: 4, unitPrice: 35_000, overLimit: true },
    { name: 'chưa biết (NaN): như trước', perUserLeft: Number.NaN, quantity: 3, unitPrice: 26_000, overLimit: false },
  ];

  it.each(cases)('$name', ({ perUserLeft, quotaLeft, inCart = 0, quantity, unitPrice, overLimit }) => {
    const known = typeof perUserLeft === 'number' && Number.isFinite(perUserLeft);
    const caps = [LIMIT, quotaLeft, known ? perUserLeft : undefined].filter((n): n is number => n !== undefined);
    const offer = { flashPrice: FLASH, allowance: Math.min(...caps), ...(quotaLeft === undefined ? {} : { quotaLeft }), ...(known ? { perUserLeft } : {}) };
    const expected = server(STANDING, inCart + quantity, offer).unitPrice;
    const got = flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity, limit: quotaLeft === undefined ? LIMIT : Math.min(LIMIT, quotaLeft), inCart, perUserLeft });
    expect(got.unitPrice).toBe(expected);
    expect(got.unitPrice).toBe(unitPrice);
    expect(got.overLimit).toBe(overLimit);
    expect(got.lineTotal).toBe(expected * (inCart + quantity));
  });

  it('perUserLeft lẻ lấy phần nguyên, âm coi là 0', () => {
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 2, limit: LIMIT, perUserLeft: 1.9 }).overLimit).toBe(true);
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 1, limit: LIMIT, perUserLeft: -4 })).toMatchObject({ unitPrice: 35_000, overLimit: true });
  });

  it('không có giá Giờ vàng thật sự rẻ hơn thì perUserLeft 0 không báo gì (khách không mất gì)', () => {
    expect(flashLinePreview({ standing: STANDING, flashPrice: 40_000, quantity: 1, limit: LIMIT, perUserLeft: 0 })).toMatchObject({ unitPrice: 35_000, overLimit: false });
    expect(flashLinePreview({ standing: STANDING, flashPrice: null, quantity: 1, limit: LIMIT, perUserLeft: 0 })).toMatchObject({ unitPrice: 35_000, overLimit: false });
  });
});

describe('variationLinePreview và overLimitNote với perUserLeft đọc từ suất', () => {
  const variation = { id: 'v1', retailPrice: STANDING, salePrice: null };
  const item = (extra: object) => [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, perUserLimit: LIMIT, quota: 10, soldCount: 5, ...extra }];

  it('đã mua hết (0): allowance 0, nút tính giá thường, vẫn nêu giới hạn mỗi khách của suất', () => {
    const line = variationLinePreview(variation, item({ perUserLeft: 0 }), 2);
    expect(line).toMatchObject({ limit: 3, allowance: 0, allowanceBy: 'bought', overLimit: true, unitPrice: 35_000, total: 70_000, lineTotal: 70_000 });
    expect(overLimitNote(line, 2)).toBe('Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.');
  });

  it('0 suất thì chữ không đổi theo giỏ có sẵn (không "quá 0 suất")', () => {
    const line = variationLinePreview(variation, item({ perUserLeft: 0 }), 1, 2);
    expect(overLimitNote(line, 1)).toBe('Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.');
  });

  it('còn 1 (nhỏ hơn giới hạn 3), chọn 2: câu riêng "Bạn còn 1 suất"', () => {
    const line = variationLinePreview(variation, item({ perUserLeft: 1 }), 2);
    expect(line).toMatchObject({ allowance: 1, allowanceBy: 'bought', overLimit: true, unitPrice: 35_000 });
    expect(overLimitNote(line, 2)).toBe('Bạn còn 1 suất Giờ vàng. Mua 2 thì cả dòng tính giá thường.');
    expect(overLimitNote(variationLinePreview(variation, item({ perUserLeft: 1 }), 1), 1)).toBeNull();
  });

  it('còn bằng giới hạn (chưa mua gì): nói theo giới hạn mỗi khách như trước', () => {
    const line = variationLinePreview(variation, item({ perUserLeft: 3 }), 4);
    expect(line).toMatchObject({ allowance: 3, allowanceBy: 'perUser' });
    expect(overLimitNote(line, 4)).toBe('Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 4 thì cả dòng tính giá thường.');
  });

  it('suất còn lại của đợt (2) ít hơn perUserLeft (5): đợt chặn', () => {
    const line = variationLinePreview(variation, item({ quota: 10, soldCount: 8, perUserLimit: 5, perUserLeft: 5 }), 3);
    expect(line).toMatchObject({ allowance: 2, allowanceBy: 'quota' });
    expect(overLimitNote(line, 3)).toBe('Giờ vàng còn 2 suất. Mua 3 thì cả dòng tính giá thường.');
  });

  it('API không gửi perUserLimit mà biết perUserLeft: perUserLeft là giới hạn', () => {
    const flash = [{ productSlug: 'p', variationId: 'v1', flashPrice: FLASH, perUserLeft: 2 }];
    expect(variationLinePreview(variation, flash, 3)).toMatchObject({ limit: null, allowance: 2, allowanceBy: 'bought', overLimit: true });
  });

  it('chưa biết perUserLeft (khách chưa đăng nhập, API cũ): như trước', () => {
    expect(variationLinePreview(variation, item({}), 3)).toMatchObject({ allowance: 3, allowanceBy: 'perUser', overLimit: false, total: 78_000 });
  });

  it('giá Giờ vàng không rẻ hơn giá đang bán: không phải Giờ vàng nên perUserLeft bị bỏ qua', () => {
    const line = variationLinePreview(variation, item({ flashPrice: 40_000, perUserLeft: 0 }), 2);
    expect(line).toMatchObject({ allowance: null, overLimit: false, unitPrice: 35_000 });
    expect(overLimitNote(line, 2)).toBeNull();
  });
});
