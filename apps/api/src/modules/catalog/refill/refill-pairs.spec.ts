import { PROD_REFILL_CATALOG_2026_11_18 as PROD } from '../../../../../../packages/app-core/src/commerce/prod-refill.fixture';
import {
  isRefillProduct,
  pairRefills,
  parseRefillBlock,
  parseRefillIds,
  parseRefillOverrides,
  refillFormulaKey,
  refillSizeLabel,
  REFILL_PAIRS_IDS_MAX,
  type RefillCatalogRow,
} from './refill-pairs';

const rows: RefillCatalogRow[] = PROD.map((p) => ({ id: p.slug, slug: p.slug, name: p.name, brand: p.brand }));
const nameOf = new Map(PROD.map((p) => [p.slug, p.name]));
const table = (pairs: Map<string, string>) =>
  [...pairs].map(([b, r]) => `${nameOf.get(b) ?? b} -> ${nameOf.get(r) ?? r}`).sort((a, b) => a.localeCompare(b, 'vi'));

/**
 * Bảng cặp trên ảnh chụp PROD 18/11/2026, đã rà tay 100% (cùng thương hiệu Fuwa3e, cùng công thức, gói Refill 10L lớn hơn chai). Đổi bảng
 * này phải rà lại tay và chép sang báo cáo wave.
 */
const EXPECTED = [
  'Gel rửa chén cho máy Fuwa3e 100ml -> Refill Gel rửa chén cho máy Fuwa3e 10L',
  'Gel rửa chén cho máy Fuwa3e 2000ml -> Refill Gel rửa chén cho máy Fuwa3e 10L',
  'Gel rửa chén cho máy Fuwa3e 500ml -> Refill Gel rửa chén cho máy Fuwa3e 10L',
  'Lau đa năng Fuwa3e 2L -> Refill Lau đa năng Fuwa3e 10L',
  'Nước lau sàn Sả chanh Fuwa3e 100ml -> Refill Nước lau sàn Sả chanh Fuwa3e 10L',
  'Nước lau sàn Sả chanh Fuwa3e 1L -> Refill Nước lau sàn Sả chanh Fuwa3e 10L',
  'Nước ngâm rửa thực phẩm Fuwa3e 100ml -> Refill Nước ngâm rửa thực phẩm Fuwa3e 10L',
  'Nước ngâm rửa thực phẩm Fuwa3e 1L -> Refill Nước ngâm rửa thực phẩm Fuwa3e 10L',
  'Nước ngâm rửa thực phẩm Fuwa3e 3,8L -> Refill Nước ngâm rửa thực phẩm Fuwa3e 10L',
  'Nước rửa chén Fuwa3e 100ml -> Refill Nước rửa chén Fuwa3e 10L',
  'Nước rửa chén Fuwa3e 3,8L -> Refill Nước rửa chén Fuwa3e 10L',
  'Nước rửa chén Fuwa3e 500ml -> Refill Nước rửa chén Fuwa3e 10L',
  'Nước rửa tay dạng Bọt Fuwa3e 3,8L -> Refill Nước rửa tay dạng Bọt Fuwa3e 10L',
  'Nước rửa tay dạng Bọt Fuwa3e 300ml -> Refill Nước rửa tay dạng Bọt Fuwa3e 10L',
  'Nước rửa tay dạng Gel Fuwa3e 3,8L -> Refill Nước rửa tay dạng Gel Fuwa3e 10L',
  'Nước rửa tay dạng Gel Fuwa3e 300ml -> Refill Nước rửa tay dạng Gel Fuwa3e 10L',
].sort((a, b) => a.localeCompare(b, 'vi'));

describe('pairRefills trên catalog PROD 18/11/2026', () => {
  it('đủ 111 dòng, 11 gói Refill', () => {
    expect(rows).toHaveLength(111);
    expect(rows.filter(isRefillProduct)).toHaveLength(11);
  });

  it('ra đúng bảng cặp đã rà tay, không cặp sai nào', () => {
    expect(table(pairRefills(rows))).toEqual(EXPECTED);
  });

  it('mọi cặp: cùng thương hiệu, cùng tên công thức, chai không phải refill, gói kia là refill', () => {
    const brand = new Map(PROD.map((p) => [p.slug, p.brand]));
    for (const [b, r] of pairRefills(rows)) {
      expect(brand.get(b)).toBe(brand.get(r));
      expect(refillFormulaKey(nameOf.get(b)!)).toBe(refillFormulaKey(nameOf.get(r)!));
      expect(isRefillProduct({ slug: b, name: nameOf.get(b)! })).toBe(false);
      expect(isRefillProduct({ slug: r, name: nameOf.get(r)! })).toBe(true);
    }
  });

  it('tên lệch một chữ thì KHÔNG ghép (chờ admin ghép tay): "Nước giặt hương Bạc hà" khác "Refill nước giặt Bạc hà", "Nước lau đa năng" khác "Refill Lau đa năng"', () => {
    const pairs = pairRefills(rows);
    expect(pairs.has('nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754')).toBe(false);
    expect(pairs.has('nuoc-giat-huong-cam-fuwa3e-3-5l-a0090c')).toBe(false);
    expect(pairs.has('nuoc-lau-da-nang-fuwa3e-500ml-cbb309')).toBe(false);
    expect(pairs.has('ve-sinh-nha-tam-va-toilet-fuwa3e-2l-4e8488')).toBe(false);
  });
});

describe('pairRefills: bẫy', () => {
  const r = (id: string, name: string, brand = 'Fuwa3e', extra: Partial<RefillCatalogRow> = {}): RefillCatalogRow => ({ id, slug: id, name, brand, ...extra });

  it('hai cỡ refill cùng công thức: không ghép (không đoán cỡ nào)', () => {
    const pairs = pairRefills([r('b', 'Nước rửa chén Fuwa3e 500ml'), r('refill-5', 'Refill Nước rửa chén Fuwa3e 5L'), r('refill-10', 'Refill Nước rửa chén Fuwa3e 10L')]);
    expect(pairs.size).toBe(0);
  });

  it('tên gần giống khác công thức: không ghép chéo', () => {
    const pairs = pairRefills([r('b', 'Nước lau sàn Sả chanh Fuwa3e 1L'), r('refill-que', 'Refill Nước lau sàn Quế Fuwa3e 10L')]);
    expect(pairs.size).toBe(0);
  });

  it('khác thương hiệu: không ghép', () => {
    expect(pairRefills([r('b', 'Nước rửa chén 500ml', 'Pineboo'), r('refill-x', 'Refill Nước rửa chén 10L', 'Fuwa3e')]).size).toBe(0);
  });

  it('chai đã ngừng bán không có trong danh mục công khai thì không có cặp', () => {
    expect(pairRefills([r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
  });

  it('"chai" không nhỏ hơn gói refill, hay khác loại đơn vị: không ghép', () => {
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 10L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 2kg'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
  });

  it('chữ bao bì (chai, bình, can, túi) không làm lệch tên công thức', () => {
    expect(pairRefills([r('b', 'Chai nước rửa chén Fuwa3e 500ml'), r('refill-x', 'Refill Nước rửa chén Fuwa3e can 10L')]).get('b')).toBe('refill-x');
  });

  it('combo không bao giờ là chai', () => {
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 500ml', 'Fuwa3e', { isCombo: true }), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
  });

  it('ghi đè thắng luật tên; chặn bỏ cặp; ghi đè lấy refill làm chai hay slug không có thì bỏ qua', () => {
    const base = [
      r('b1', 'Nước giặt hương Bạc hà Fuwa3e 500ml'),
      r('refill-bh', 'Refill nước giặt Bạc hà Fuwa3e 10L'),
      r('b2', 'Nước rửa chén Fuwa3e 500ml'),
      r('refill-rc', 'Refill Nước rửa chén Fuwa3e 10L'),
    ];
    const pairs = pairRefills(base, {
      overrides: [
        { bottleSlug: 'b1', refillSlug: 'refill-bh' },
        { bottleSlug: 'refill-rc', refillSlug: 'refill-bh' },
        { bottleSlug: 'missing', refillSlug: 'refill-bh' },
      ],
      block: new Set(['refill-rc']),
    });
    expect([...pairs]).toEqual([['b1', 'refill-bh']]);
  });
});

describe('cấu hình và tham số', () => {
  it('parseRefillOverrides bỏ phần tử sai dạng, giữ phần tử đúng', () => {
    expect(parseRefillOverrides([{ bottleSlug: ' a ', refillSlug: 'b' }, { bottleSlug: 'a' }, 'x', null, { bottleSlug: 'c', refillSlug: 'c' }])).toEqual([
      { bottleSlug: 'a', refillSlug: 'b' },
    ]);
    expect(parseRefillOverrides('[]')).toEqual([]);
  });

  it('parseRefillBlock chỉ nhận mảng chuỗi', () => {
    expect([...parseRefillBlock(['a', ' b ', 1, ''])]).toEqual(['a', 'b']);
    expect(parseRefillBlock({}).size).toBe(0);
  });

  it('parseRefillIds bỏ rỗng, bỏ trùng, cắt ở trần', () => {
    expect(parseRefillIds(' a,,b,a ')).toEqual(['a', 'b']);
    expect(parseRefillIds(undefined)).toEqual([]);
    expect(parseRefillIds(Array.from({ length: 80 }, (_, i) => `id${i}`).join(','))).toHaveLength(REFILL_PAIRS_IDS_MAX);
  });

  it('refillSizeLabel đọc lượng từ tên', () => {
    expect(refillSizeLabel('Refill Nước rửa chén Fuwa3e 10L')).toBe('10L');
    expect(refillSizeLabel('Refill Nước rửa chén Fuwa3e')).toBeNull();
  });
});
