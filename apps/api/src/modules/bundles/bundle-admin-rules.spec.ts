import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  assertBundleWindow,
  assertStaffBundleCaps,
  bundleStatus,
  capAtRefPrices,
  keptRefPrices,
  normalizeBundleContent,
  resolveBundleItems,
  type BundleContent,
  type CatalogProduct,
} from './bundle-admin-rules';

const item = (productId: string, o: Record<string, unknown> = {}) => ({ productId, variationId: null, addonPrice: null, maxQty: 1, ...o });
const pctInput = (o: Record<string, unknown> = {}) => ({ kind: 'BUNDLE_PCT' as const, pct: 10, anchorProductId: null, items: [item('p1'), item('p2')], ...o });
const addonInput = (o: Record<string, unknown> = {}) => ({
  kind: 'ADDON' as const,
  pct: null,
  anchorProductId: 'p1',
  items: [item('p2', { addonPrice: 39_000, variationId: 'p2-a' })],
  ...o,
});
const msg = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe('normalizeBundleContent: BUNDLE_PCT', () => {
  it('hợp lệ: giữ pct, bỏ anchorProductId, maxQty mặc định 1, sortOrder theo thứ tự gửi', () => {
    const out = normalizeBundleContent(pctInput({ anchorProductId: 'p9', items: [item('p1', { maxQty: undefined }), item('p2')] }), 50);
    expect(out.anchorProductId).toBeNull();
    expect(out.pct).toBe(10);
    expect(out.items.map((i) => [i.productId, i.maxQty, i.addonPrice])).toEqual([['p1', 1, null], ['p2', 1, null]]);
  });

  it.each([
    ['pct 0', { pct: 0 }, 'từ 1% đến 50%'],
    ['pct vượt trần cấu hình', { pct: 51 }, 'từ 1% đến 50%'],
    ['pct thiếu', { pct: null }, 'từ 1% đến 50%'],
    ['pct không nguyên', { pct: 10.5 }, 'từ 1% đến 50%'],
    ['một sản phẩm', { items: [item('p1')] }, 'từ 2 đến 6 sản phẩm'],
    ['bảy sản phẩm', { items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => item(x)) }, 'từ 2 đến 6 sản phẩm'],
    ['trùng sản phẩm', { items: [item('p1'), item('p1')] }, 'một lần'],
    ['có giá mua kèm', { items: [item('p1', { addonPrice: 5 }), item('p2')] }, 'không đặt giá mua kèm'],
    ['maxQty 0', { items: [item('p1', { maxQty: 0 }), item('p2')] }, 'từ 1 đến 10'],
    ['maxQty 11', { items: [item('p1', { maxQty: 11 }), item('p2')] }, 'từ 1 đến 10'],
  ])('từ chối %s bằng 400 tiếng Việt', (_n, patch, text) => {
    expect(() => normalizeBundleContent(pctInput(patch), 50)).toThrow(BadRequestException);
    expect(msg(() => normalizeBundleContent(pctInput(patch), 50))).toContain(text);
  });

  it('trần cấu hình thấp hơn thì pct hợp lệ cũ bị từ chối', () => {
    expect(() => normalizeBundleContent(pctInput({ pct: 30 }), 20)).toThrow(BadRequestException);
  });
});

describe('normalizeBundleContent: ADDON', () => {
  it('hợp lệ; giá kèm 0đ hợp lệ', () => {
    const out = normalizeBundleContent(addonInput({ items: [item('p2', { addonPrice: 0, variationId: 'p2-a' })] }), 50);
    expect(out).toMatchObject({ kind: 'ADDON', pct: null, anchorProductId: 'p1' });
    expect(out.items[0]).toMatchObject({ productId: 'p2', addonPrice: 0 });
  });

  it.each([
    ['thiếu sản phẩm chính', { anchorProductId: null }, 'sản phẩm chính'],
    ['có pct', { pct: 10 }, 'không đặt %'],
    ['không có món', { items: [] }, 'từ 1 đến 3 món'],
    ['bốn món', { items: ['a', 'b', 'c', 'd'].map((x) => item(x, { addonPrice: 1, variationId: `${x}-a` })) }, 'từ 1 đến 3 món'],
    ['món trùng sản phẩm chính', { items: [item('p1', { addonPrice: 1, variationId: 'p1-a' })] }, 'khác sản phẩm chính'],
    ['món kèm không ghim phân loại', { items: [item('p2', { addonPrice: 39_000 })] }, 'Chọn phân loại'],
    ['thiếu giá kèm', { items: [item('p2')] }, 'giá mua kèm'],
    ['giá kèm âm', { items: [item('p2', { addonPrice: -1 })] }, 'giá mua kèm'],
    ['giá kèm lẻ', { items: [item('p2', { addonPrice: 10.5 })] }, 'giá mua kèm'],
  ])('từ chối %s', (_n, patch, text) => {
    expect(() => normalizeBundleContent(addonInput(patch), 50)).toThrow(BadRequestException);
    expect(msg(() => normalizeBundleContent(addonInput(patch), 50))).toContain(text);
  });
});

describe('assertBundleWindow', () => {
  it('endAt phải sau startAt', () => {
    const a = new Date('2026-11-01T00:00:00Z');
    expect(() => assertBundleWindow(a, a)).toThrow(BadRequestException);
    expect(() => assertBundleWindow(a, new Date(a.getTime() - 1))).toThrow(BadRequestException);
    expect(() => assertBundleWindow(a, new Date(a.getTime() + 1))).not.toThrow();
  });
});

describe('bundleStatus', () => {
  const at = (iso: string) => new Date(iso);
  const b = { isActive: true, startAt: at('2026-11-05T00:00:00Z'), endAt: at('2026-11-10T00:00:00Z') };
  it('đúng ranh giới: tới giờ bắt đầu là đang chạy, tới giờ kết thúc là đã kết thúc', () => {
    expect(bundleStatus(b, at('2026-11-04T23:59:59Z'))).toBe('scheduled');
    expect(bundleStatus(b, at('2026-11-05T00:00:00Z'))).toBe('live');
    expect(bundleStatus(b, at('2026-11-10T00:00:00Z'))).toBe('ended');
    expect(bundleStatus({ ...b, isActive: false }, at('2026-11-06T00:00:00Z'))).toBe('off');
  });
});

describe('resolveBundleItems: sản phẩm và phân loại', () => {
  const prod = (id: string, o: Partial<CatalogProduct> = {}): CatalogProduct => ({
    id,
    name: `SP ${id}`,
    isActive: true,
    approvalStatus: 'APPROVED',
    storefrontId: null,
    basePrice: 60_000,
    salePrice: 50_000,
    variations: [
      { id: `${id}-a`, sku: `${id}-a`, retailPrice: 60_000, salePrice: 50_000, stock: 5 },
      { id: `${id}-b`, sku: `${id}-b`, retailPrice: 80_000, salePrice: null, stock: 0 },
    ],
    ...o,
  });
  const catalog = (...ps: CatalogProduct[]) => new Map(ps.map((p) => [p.id, p]));
  const content = (o: Partial<BundleContent> = {}): BundleContent => ({ ...normalizeBundleContent(pctInput(), 50), ...o });

  it('trả giá đang bán từng món: ghim thì giá phân loại ghim, không ghim thì phân loại đại diện', () => {
    const c = content({ items: normalizeBundleContent(pctInput({ items: [item('p1'), item('p2', { variationId: 'p2-b' })] }), 50).items });
    expect(resolveBundleItems(c, catalog(prod('p1'), prod('p2')))).toEqual([
      { price: 50_000, maxPrice: 80_000 },
      { price: 80_000, maxPrice: 80_000 },
    ]);
  });

  it('món không ghim: price là phân loại đại diện (rẻ nhất), maxPrice là phân loại ĐẮT NHẤT khách có thể chọn', () => {
    const big = prod('p1', {
      variations: [
        { id: 'p1-s', sku: 'p1-s', retailPrice: 50_000, salePrice: null, stock: 9 },
        { id: 'p1-l', sku: 'p1-l', retailPrice: 600_000, salePrice: 500_000, stock: 9 },
      ],
    });
    expect(resolveBundleItems(content(), catalog(big, prod('p2')))[0]).toEqual({ price: 50_000, maxPrice: 500_000 });
  });

  it('sản phẩm không có / ẩn / chưa duyệt → 400 nêu tên', () => {
    expect(msg(() => resolveBundleItems(content(), catalog(prod('p1'))))).toContain('Không tìm thấy sản phẩm');
    expect(msg(() => resolveBundleItems(content(), catalog(prod('p1'), prod('p2', { isActive: false }))))).toContain('SP p2');
    expect(msg(() => resolveBundleItems(content(), catalog(prod('p1'), prod('p2', { approvalStatus: 'PENDING' }))))).toContain('chưa được duyệt hoặc đã ngừng bán');
  });

  it('hàng gian hàng đối tác bị chặn bằng mã PARTNER_GOODS_NOT_ELIGIBLE', () => {
    try {
      resolveBundleItems(content(), catalog(prod('p1'), prod('p2', { storefrontId: 'sf1' })));
      throw new Error('phải ném');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((e as BadRequestException).getResponse())).toContain('PARTNER_GOODS_NOT_ELIGIBLE');
    }
  });

  it('variationId của sản phẩm khác hoặc đã tắt → 400', () => {
    const wrong = normalizeBundleContent(pctInput({ items: [item('p1', { variationId: 'p2-a' }), item('p2')] }), 50);
    expect(msg(() => resolveBundleItems(wrong, catalog(prod('p1'), prod('p2'))))).toContain('phân loại');
  });

  it('ADDON: sản phẩm chính cũng phải đang bán và không đối tác; giá kèm phải thấp hơn giá đang bán', () => {
    const c = normalizeBundleContent(addonInput(), 50);
    expect(resolveBundleItems(c, catalog(prod('p1'), prod('p2')))).toEqual([{ price: 50_000, maxPrice: 50_000 }]);
    expect(msg(() => resolveBundleItems(c, catalog(prod('p2'))))).toContain('Không tìm thấy sản phẩm');
    expect(() => resolveBundleItems(c, catalog(prod('p1', { storefrontId: 'sf1' }), prod('p2')))).toThrow(BadRequestException);
    const high = normalizeBundleContent(addonInput({ items: [item('p2', { addonPrice: 50_000, variationId: 'p2-a' })] }), 50);
    expect(msg(() => resolveBundleItems(high, catalog(prod('p1'), prod('p2'))))).toContain('thấp hơn giá đang bán');
  });

  it('ADDON: giá kèm so với giá của PHÂN LOẠI GHIM, không phải phân loại rẻ nhất của sản phẩm', () => {
    // p2-b giá 80.000: giá kèm 70.000 hợp lệ cho phân loại đó dù cao hơn giá phân loại đại diện (50.000).
    const onB = normalizeBundleContent(addonInput({ items: [item('p2', { addonPrice: 70_000, variationId: 'p2-b' })] }), 50);
    expect(resolveBundleItems(onB, catalog(prod('p1'), prod('p2')))).toEqual([{ price: 80_000, maxPrice: 80_000 }]);
  });
});

describe('assertStaffBundleCaps: trần nhân viên', () => {
  const caps = { maxPercent: 20, maxAmount: 30_000, maxUsage: 1000, dailyBudget: 1 };
  const same = (...prices: number[]) => prices.map((p) => ({ price: p, maxPrice: p }));

  it('BUNDLE_PCT: pct vượt trần % → 403; trong trần → qua', () => {
    const c = normalizeBundleContent(pctInput({ pct: 30 }), 50);
    expect(() => assertStaffBundleCaps(c, same(10_000, 10_000), caps)).toThrow(ForbiddenException);
    expect(msg(() => assertStaffBundleCaps(c, same(10_000, 10_000), caps))).toContain('20%');
    expect(() => assertStaffBundleCaps(normalizeBundleContent(pctInput({ pct: 20 }), 50), same(10_000, 10_000), caps)).not.toThrow();
  });

  it('exposure (tiền tối đa mỗi đơn) vượt trần tiền → 403', () => {
    const c = normalizeBundleContent(pctInput({ pct: 20, items: [item('p1', { maxQty: 2 }), item('p2')] }), 50);
    // 20% × (100k×2 + 100k) = 60k > 30k
    expect(() => assertStaffBundleCaps(c, same(100_000, 100_000), caps)).toThrow(ForbiddenException);
    expect(msg(() => assertStaffBundleCaps(c, same(100_000, 100_000), caps))).toContain('30.000');
  });

  it('BUNDLE_PCT món không ghim: exposure tính trên phân loại ĐẮT NHẤT, không phải phân loại rẻ nhất (50k vs 500k → 403)', () => {
    const c = normalizeBundleContent(pctInput({ pct: 20, items: [item('p1', { maxQty: 10 }), item('p2', { maxQty: 10 })] }), 50);
    // Trần 250.000: đủ cho tính theo phân loại rẻ nhất (200.000) nhưng không đủ cho phân loại đắt nhất.
    const wide = { ...caps, maxAmount: 250_000 };
    const cheapest = [{ price: 50_000, maxPrice: 50_000 }, { price: 50_000, maxPrice: 50_000 }];
    expect(() => assertStaffBundleCaps(c, cheapest, wide)).not.toThrow();
    const real = [{ price: 50_000, maxPrice: 500_000 }, { price: 50_000, maxPrice: 500_000 }];
    expect(() => assertStaffBundleCaps(c, real, wide)).toThrow(ForbiddenException); // 20% × 500k × 10 × 2 = 2.000.000
  });

  it('ADDON: % giảm của món kèm vượt trần % → 403; trong trần và tiền → qua', () => {
    const deep = normalizeBundleContent(addonInput({ items: [item('p2', { addonPrice: 10_000, variationId: 'p2-a' })] }), 50);
    expect(() => assertStaffBundleCaps(deep, same(50_000), caps)).toThrow(ForbiddenException);
    const mild = normalizeBundleContent(addonInput({ items: [item('p2', { addonPrice: 45_000, variationId: 'p2-a' })] }), 50);
    expect(() => assertStaffBundleCaps(mild, same(50_000), caps)).not.toThrow();
  });

  it('ADDON đã kẹp theo giá tham chiếu (50k → 500k): lời từ chối nói giá lúc đặt giá kèm, không nói "giá đang bán" 500k; chưa kẹp thì vẫn nói giá đang bán', () => {
    const c = normalizeBundleContent(addonInput({ items: [item('p2', { addonPrice: 30_000, variationId: 'p2-a' })] }), 50);
    const capped = capAtRefPrices([{ price: 500_000, maxPrice: 500_000 }], [50_000]);
    const cappedMsg = msg(() => assertStaffBundleCaps(c, capped, caps));
    expect(cappedMsg).toContain('20%');
    expect(cappedMsg).toContain('giá lúc đặt giá kèm');
    expect(cappedMsg).toContain('50.000');
    expect(cappedMsg).not.toContain('giá đang bán');
    const live = msg(() => assertStaffBundleCaps(c, same(50_000), caps));
    expect(live).toContain('so với giá đang bán');
    expect(live).not.toContain('giá lúc đặt giá kèm');
  });

  it('ADDON ghim phân loại đắt: % giảm tính trên giá phân loại ghim (500k → giá kèm 40k là giảm 92%) → 403', () => {
    const c = normalizeBundleContent(addonInput({ items: [item('p2', { addonPrice: 40_000, variationId: 'p2-l' })] }), 50);
    expect(() => assertStaffBundleCaps(c, same(500_000), { ...caps, maxAmount: 10_000_000 })).toThrow(ForbiddenException);
  });
});

describe('keptRefPrices / capAtRefPrices: sửa bộ không làm giá tham chiếu bật lại theo giá hiện tại', () => {
  const old = (o: Record<string, unknown> = {}) => ({ productId: 'p2', variationId: 'p2-a', addonPrice: 39_000, refPrice: 50_000, ...o });
  const content = (items: ReturnType<typeof item>[]) => normalizeBundleContent(addonInput({ items }), 50);

  it('món không đổi (cùng sản phẩm, phân loại, giá kèm) giữ giá tham chiếu cũ, kể cả khi form gửi lại nguyên danh sách', () => {
    expect(keptRefPrices(content([item('p2', { addonPrice: 39_000, variationId: 'p2-a' })]), [old()])).toEqual([50_000]);
  });

  it('đổi giá kèm, đổi phân loại, món mới, hay dòng cũ thiếu giá tham chiếu → null (lấy giá đang bán lúc này)', () => {
    expect(keptRefPrices(content([item('p2', { addonPrice: 40_000, variationId: 'p2-a' })]), [old()])).toEqual([null]);
    expect(keptRefPrices(content([item('p2', { addonPrice: 39_000, variationId: 'p2-b' })]), [old()])).toEqual([null]);
    expect(keptRefPrices(content([item('p3', { addonPrice: 39_000, variationId: 'p3-a' })]), [old()])).toEqual([null]);
    expect(keptRefPrices(content([item('p2', { addonPrice: 39_000, variationId: 'p2-a' })]), [old({ refPrice: null })])).toEqual([null]);
  });

  it('BUNDLE_PCT không có giá tham chiếu để giữ', () => {
    const pct = normalizeBundleContent(pctInput(), 50);
    expect(keptRefPrices(pct, [old({ productId: 'p1', addonPrice: null, variationId: null, refPrice: 50_000 })])).toEqual([null, null]);
  });

  it('giá dùng cho trần nhân viên là giá tham chiếu giữ lại, khoản giảm lớn nhất giỏ có thể cho (50k → 500k vẫn tính 50k; tụt còn 30k cũng tính 50k vì hết sale giá trở lại)', () => {
    expect(capAtRefPrices([{ price: 500_000, maxPrice: 500_000 }], [50_000])).toEqual([{ price: 50_000, maxPrice: 50_000, cappedAt: 50_000 }]);
    expect(capAtRefPrices([{ price: 30_000, maxPrice: 30_000 }], [50_000])).toEqual([{ price: 50_000, maxPrice: 50_000, cappedAt: 50_000 }]);
    expect(capAtRefPrices([{ price: 50_000, maxPrice: 50_000 }], [50_000])).toEqual([{ price: 50_000, maxPrice: 50_000 }]);
    expect(capAtRefPrices([{ price: 500_000, maxPrice: 500_000 }], [null])).toEqual([{ price: 500_000, maxPrice: 500_000 }]);
  });
});
