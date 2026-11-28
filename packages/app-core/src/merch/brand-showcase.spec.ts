import { describe, expect, it } from 'vitest';
import { BRAND_ORIGINS, SHELL_BRAND_TAGLINE } from '../brand-origins';
import { brandJumpHref, brandShowcase, hasBrandChoice, realBrandCount } from './brand-showcase';

/** Số đếm của `GET /brands` trên PROD 24/11/2026 (111 SKU, nhãn suy từ tên). */
const PROD = [
  { brand: 'Tubu Tree', count: 9, slug: null },
  { brand: 'Visante', count: 7, slug: null },
  { brand: 'Fuwa3e', count: 44, slug: 'fuwa3e' },
  { brand: 'Hector', count: 7, slug: 'hector', tagline: '  Đông trùng hạ thảo nuôi tại Đà Lạt ' },
  { brand: 'Pơ Lang', count: 14, slug: null },
  { brand: 'BH.Nong', count: 12, slug: null },
  { brand: 'Sokfarm', count: 10, slug: null },
  { brand: 'Le Plateau Coffee', count: 4, slug: null },
  { brand: 'Cobote', count: 2, slug: null },
];

describe('brandShowcase: thứ tự nhãn của thanh chip thương hiệu', () => {
  it('xếp theo số sản phẩm giảm dần (hoà thì theo tên), "Tubu Tree" luôn cuối dù nhiều sản phẩm hơn nhãn khác', () => {
    expect(brandShowcase(PROD).map((b) => b.brand)).toEqual([
      'Fuwa3e', 'Pơ Lang', 'BH.Nong', 'Sokfarm', 'Hector', 'Visante', 'Le Plateau Coffee', 'Cobote', 'Tubu Tree',
    ]);
  });

  it('câu giới thiệu: của admin (đã cắt khoảng trắng) thắng câu dự phòng ở brand-origins; "Tubu Tree" có câu chung; nhãn lạ không câu', () => {
    const list = brandShowcase([...PROD, { brand: 'Gốm Bát Tràng', count: 1 }]);
    const tagline = (name: string) => list.find((b) => b.brand === name)?.tagline;
    expect(tagline('Hector')).toBe('Đông trùng hạ thảo nuôi tại Đà Lạt');
    expect(tagline('Fuwa3e')).toBe(BRAND_ORIGINS.find((o) => o.id === 'fuwa3e')!.tagline);
    expect(tagline('Le Plateau Coffee')).toBe(BRAND_ORIGINS.find((o) => o.id === 'leplateau')!.tagline);
    expect(tagline('Tubu Tree')).toBe(SHELL_BRAND_TAGLINE);
    expect(tagline('Gốm Bát Tràng')).toBeNull();
  });

  it('nhãn mượn vùng nhà máy (Pineboo → Fuwa3e) không mượn câu của Fuwa3e', () => {
    expect(brandShowcase([{ brand: 'Pineboo', count: 3 }])[0]!.tagline).toBeNull();
  });

  it('bỏ nhãn trống, không còn sản phẩm, trùng sau khi chuẩn hoá; chưa tải thì rỗng', () => {
    expect(brandShowcase(undefined)).toEqual([]);
    const list = brandShowcase([
      { brand: ' ', count: 3 },
      { brand: 'Visante', count: 0 },
      { brand: 'Pơ Lang', count: 5 },
      { brand: 'PƠ LANG', count: 2 },
    ]);
    expect(list.map((b) => [b.brand, b.count])).toEqual([['Pơ Lang', 5]]);
  });

  it('trần `max` cắt nhãn ít sản phẩm nhưng giữ "Tubu Tree" ở cuối', () => {
    expect(brandShowcase(PROD, 3).map((b) => b.brand)).toEqual(['Fuwa3e', 'Pơ Lang', 'Tubu Tree']);
    expect(brandShowcase(PROD.filter((b) => b.brand !== 'Tubu Tree'), 2).map((b) => b.brand)).toEqual(['Fuwa3e', 'Pơ Lang']);
  });
});

describe('đích của chip thương hiệu', () => {
  it('trang nhãn nếu có slug, không thì lọc theo nhãn (journeyBrandHref)', () => {
    expect(brandJumpHref({ key: 'fuwa3e', brand: 'Fuwa3e', slug: 'fuwa3e' }, 'web')).toBe('/brand/fuwa3e');
    expect(brandJumpHref({ key: 'polang', brand: 'Pơ Lang', slug: null }, 'web')).toBe('/san-pham?brand=P%C6%A1+Lang');
    expect(brandJumpHref({ key: 'tubutree', brand: 'Tubu Tree', slug: null }, 'mini')).toBe('/browse?brand=Tubu+Tree');
  });
});

describe('hasBrandChoice (W47): lối duyệt theo thương hiệu chỉ khi có ít nhất hai nhãn thật', () => {
  it('PROD 24/11 có 8 nhãn thật (không tính "Tubu Tree"): có lựa chọn', () => {
    expect(realBrandCount(PROD)).toBe(8);
    expect(hasBrandChoice(PROD)).toBe(true);
  });

  it('chỉ "Tubu Tree", hay một nhãn thật kèm "Tubu Tree": không có lựa chọn', () => {
    expect(hasBrandChoice([{ brand: 'Tubu Tree', count: 40 }])).toBe(false);
    expect(hasBrandChoice([{ brand: 'Tubu Tree', count: 40 }, { brand: 'Fuwa3e', count: 12 }])).toBe(false);
    expect(hasBrandChoice([{ brand: 'tubu tree', count: 3 }, { brand: 'TUBU TREE', count: 2 }])).toBe(false);
  });

  it('nhãn trùng sau chuẩn hoá đếm một lần; nhãn hết sản phẩm hay tên trống không tính; chưa tải hay lỗi thì không có lựa chọn', () => {
    expect(realBrandCount([{ brand: 'Pơ Lang', count: 5 }, { brand: 'PƠ LANG', count: 2 }])).toBe(1);
    expect(realBrandCount([{ brand: 'Visante', count: 0 }, { brand: ' ', count: 3 }, { brand: 'Hector', count: 1 }])).toBe(1);
    expect(hasBrandChoice(undefined)).toBe(false);
    expect(hasBrandChoice([])).toBe(false);
  });

  it('hai nhãn thật là đủ', () => {
    expect(hasBrandChoice([{ brand: 'Fuwa3e', count: 1 }, { brand: 'Hector', count: 1 }])).toBe(true);
  });
});
