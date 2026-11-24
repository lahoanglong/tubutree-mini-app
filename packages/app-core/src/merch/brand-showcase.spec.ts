import { describe, expect, it } from 'vitest';
import { BRAND_ORIGINS, SHELL_BRAND_TAGLINE } from '../brand-origins';
import {
  BRAND_SHOWCASE_ITEMS,
  brandJumpHref,
  brandShowcase,
  brandShowcaseHref,
  brandShowcaseItems,
  brandShowcaseSkeletonCount,
} from './brand-showcase';

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

describe('brandShowcase: thứ tự nhãn của thanh nhảy nhanh và khối Khám phá theo Thương hiệu', () => {
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

  it('id neo `home-brand-<slug>`, thiếu slug thì theo tên đã chuẩn hoá; chỉ gồm chữ thường, số, gạch nối', () => {
    const list = brandShowcase(PROD);
    expect(list.find((b) => b.brand === 'Fuwa3e')!.anchorId).toBe('home-brand-fuwa3e');
    expect(list.find((b) => b.brand === 'Pơ Lang')!.anchorId).toBe('home-brand-polang');
    expect(list.find((b) => b.brand === 'BH.Nong')!.anchorId).toBe('home-brand-bhnong');
    for (const b of list) expect(b.anchorId).toMatch(/^home-brand-[a-z0-9-]+$/);
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

describe('đích của nhãn', () => {
  it('"Tất cả (n)": danh sách lọc đúng `?brand=` theo nền', () => {
    expect(brandShowcaseHref({ brand: 'Pơ Lang' }, 'web')).toBe('/san-pham?brand=P%C6%A1+Lang');
    expect(brandShowcaseHref({ brand: 'Fuwa3e' }, 'mini')).toBe('/browse?brand=Fuwa3e');
  });

  it('chip khi khối chưa dựng: trang nhãn nếu có slug, không thì lọc theo nhãn (journeyBrandHref)', () => {
    expect(brandJumpHref({ key: 'fuwa3e', brand: 'Fuwa3e', slug: 'fuwa3e' }, 'web')).toBe('/brand/fuwa3e');
    expect(brandJumpHref({ key: 'polang', brand: 'Pơ Lang', slug: null }, 'web')).toBe('/san-pham?brand=P%C6%A1+Lang');
    expect(brandJumpHref({ key: 'tubutree', brand: 'Tubu Tree', slug: null }, 'mini')).toBe('/browse?brand=Tubu+Tree');
  });
});

describe('brandShowcaseItems: món của một nhãn', () => {
  const p = (slug: string, inStock = true) => ({ slug, inStock });

  it('ưu tiên món chưa hiện ở kệ trên, đủ 4 món thì không lặp món đã hiện', () => {
    const items = [p('a'), p('b'), p('c'), p('d'), p('e'), p('f')];
    expect(brandShowcaseItems(items, new Set(['a', 'c'])).map((x) => x.slug)).toEqual(['b', 'd', 'e', 'f']);
  });

  it('thiếu món mới thì bù bằng món đã hiện (giữ thứ tự máy chủ) để nhãn vẫn đủ 4 món', () => {
    const items = [p('a'), p('b'), p('c'), p('d'), p('e')];
    expect(brandShowcaseItems(items, new Set(['a', 'b', 'c', 'd'])).map((x) => x.slug)).toEqual(['e', 'a', 'b', 'c']);
  });

  it('còn hàng đứng trước món hết hàng; nhãn ít món thì vẽ đúng số đang có', () => {
    expect(brandShowcaseItems([p('x', false), p('y'), p('z')], new Set()).map((x) => x.slug)).toEqual(['y', 'z', 'x']);
    expect(brandShowcaseItems([], new Set())).toEqual([]);
  });

  it('khung chờ bằng số món sẽ vẽ: tối đa 4, ít nhất 1', () => {
    expect(brandShowcaseSkeletonCount({ count: 44 })).toBe(BRAND_SHOWCASE_ITEMS);
    expect(brandShowcaseSkeletonCount({ count: 2 })).toBe(2);
    expect(brandShowcaseSkeletonCount({ count: 0 })).toBe(1);
  });
});
