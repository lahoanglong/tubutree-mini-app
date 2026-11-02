import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { flashLimitFor, flashLinePreview, flashQuotaLeftFor, overLimitNote, variationLinePreview } from './flash-line';

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
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 5, limit: LIMIT })).toEqual({ unitPrice: 35_000, total: 175_000, overLimit: true });
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 4, limit: LIMIT }).total).toBe(140_000);
    expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 3, limit: LIMIT }).total).toBe(78_000);
  });

  it('giới hạn 0, âm, NaN hoặc undefined là chưa biết giới hạn (như slotItemNote), không phải "hết suất"', () => {
    for (const limit of [0, -2, Number.NaN, undefined]) {
      expect(flashLinePreview({ standing: STANDING, flashPrice: FLASH, quantity: 5, limit })).toEqual({ unitPrice: 26_000, total: 130_000, overLimit: false });
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
