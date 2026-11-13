import { describe, expect, it } from 'vitest';
import {
  BRAND_ORIGINS,
  brandBrowseTarget,
  brandOriginOf,
  findBrandOrigin,
  journeyBrandHref,
  journeyBrands,
  normalizeBrandKey,
} from './brand-origins';
import { homeCopy } from './home-copy';
import { PROD_CATALOG_2026_11_12 } from './commerce/prod-catalog-full.fixture';

const id = (name: string) => brandOriginOf(name)?.id;

describe('normalizeBrandKey', () => {
  it('bỏ dấu, hạ chữ thường, bỏ ký tự không phải chữ-số', () => {
    expect(normalizeBrandKey('PƠ LANG')).toBe('polang');
    expect(normalizeBrandKey('Pơ Lang')).toBe('polang');
    expect(normalizeBrandKey('BH.NONG')).toBe('bhnong');
    expect(normalizeBrandKey('Tubu Tree')).toBe('tubutree');
    expect(normalizeBrandKey('Đắk Lắk')).toBe('daklak');
    expect(normalizeBrandKey('  ')).toBe('');
  });
});

describe('brandOriginOf — suy ra nhãn hành trình từ tên', () => {
  it.each([
    ['Le Plateau', 'leplateau'],
    ['Le Plateau Coffee', 'leplateau'],
    ['Sokfarm', 'sokfram'],
    ['Sokfram', 'sokfram'],
    ['SOKFARM', 'sokfram'],
    ['BH.Nong', 'bhnong'],
    ['BH.NONG', 'bhnong'],
    ['Pơ Lang', 'polang'],
    ['PƠ LANG', 'polang'],
    ['pơlang', 'polang'],
    ['Fuwa3e', 'fuwa3e'],
    ['FUWA3E', 'fuwa3e'],
    ['Visante', 'visante'],
    ['Hector', 'hector'],
    ['Cobote', 'cobote'],
  ])('%s -> %s', (name, expected) => {
    expect(id(name)).toBe(expected);
  });

  it('nhận ra nhãn nằm trong tên sản phẩm dài', () => {
    expect(id('Nước Đông Trùng Hạ Thảo HECTOR Collagen Plus 70ml x 10 Chai')).toBe('hector');
    expect(id('[CHO BÉ] Mật cô đặc Sokfarm 250g')).toBe('sokfram');
    expect(id('Dầu gội bồ kết PƠ LANG 250ml')).toBe('polang');
  });

  it('tên chứa hai nhãn thì lấy nhãn xuất hiện sớm nhất', () => {
    expect(id('Combo Visante + Hector')).toBe('visante');
    expect(id('Combo Hector + Visante')).toBe('hector');
  });

  it('nhãn lạ, vỏ chung và tên trống thì undefined', () => {
    expect(id('Pineboo')).toBeUndefined();
    expect(id('Tubu Tree')).toBeUndefined();
    expect(id('')).toBeUndefined();
    expect(id('!!!')).toBeUndefined();
  });

  it('đếm 111 SKU PROD theo tên: khớp đúng một nhãn hành trình hoặc không nhãn nào', () => {
    const count: Record<string, number> = {};
    let none = 0;
    for (const row of PROD_CATALOG_2026_11_12) {
      const o = brandOriginOf(row.name);
      if (o) count[o.id] = (count[o.id] ?? 0) + 1;
      else none += 1;
    }
    expect(PROD_CATALOG_2026_11_12).toHaveLength(111);
    expect(count).toEqual({ fuwa3e: 44, bhnong: 12, polang: 14, sokfram: 10, visante: 7, hector: 7, leplateau: 2 });
    expect(none).toBe(111 - 96);
  });

  it('mỗi nhãn có từ khoá tìm khớp chính nó (từ khoá suy ngược ra đúng nhãn)', () => {
    for (const o of BRAND_ORIGINS) expect(brandOriginOf(o.searchKeyword)?.id).toBe(o.id);
  });
});

describe('searchKeyword và brandBrowseTarget', () => {
  it('viết đúng như tên sản phẩm: chữ hoa ở PƠ LANG và BH.NONG, nhãn nào cũng có', () => {
    const kw = Object.fromEntries(BRAND_ORIGINS.map((o) => [o.id, o.searchKeyword]));
    expect(kw).toEqual({
      fuwa3e: 'Fuwa3e',
      bhnong: 'BH.NONG',
      polang: 'PƠ LANG',
      visante: 'Visante',
      hector: 'Hector',
      leplateau: 'Le Plateau',
      cobote: 'Cobote',
      sokfram: 'Sokfarm',
    });
  });

  it('mỗi từ khoá xuất hiện nguyên văn trong tên ít nhất một SKU PROD (trừ Cobote chưa có hàng)', () => {
    for (const o of BRAND_ORIGINS) {
      if (o.id === 'cobote') continue;
      const hit = PROD_CATALOG_2026_11_12.some((r) => r.name.toLowerCase().includes(o.searchKeyword.toLowerCase()));
      expect(hit, o.searchKeyword).toBe(true);
    }
  });

  it('đích dùng ?q= (không ?brand=), mã hoá đúng, gốc theo nền tảng', () => {
    const polang = BRAND_ORIGINS.find((o) => o.id === 'polang')!;
    expect(brandBrowseTarget(polang, '/san-pham')).toBe(`/san-pham?q=${encodeURIComponent('PƠ LANG').replace(/%20/g, '+')}`);
    expect(brandBrowseTarget(polang, '/browse')).toMatch(/^\/browse\?q=/);
    for (const o of BRAND_ORIGINS) {
      const url = new URL(brandBrowseTarget(o, '/san-pham'), 'https://x.test');
      expect(url.searchParams.get('q')).toBe(o.searchKeyword);
      expect(url.searchParams.has('brand')).toBe(false);
    }
  });
});

describe('journeyBrands — dải thương hiệu Trang chủ', () => {
  it('API chỉ trả vỏ "Tubu Tree": vẫn ra đủ 8 nhãn theo thứ tự hành trình, không có "Tubu Tree"', () => {
    const list = journeyBrands([{ brand: 'Tubu Tree', count: 111, slug: null } as { brand: string; slug: null }]);
    expect(list.map((j) => j.label)).toEqual(BRAND_ORIGINS.map((o) => o.brand));
    expect(list).toHaveLength(8);
    expect(list.every((j) => j.origin && !j.slug)).toBe(true);
    expect(list.some((j) => normalizeBrandKey(j.label) === 'tubutree')).toBe(false);
  });

  it('chưa tải được danh sách thì vẫn có 8 nhãn; câu mô tả khối nói "8 thương hiệu Việt…"', () => {
    expect(journeyBrands(undefined)).toHaveLength(8);
    expect(homeCopy.journey.body(journeyBrands(undefined).length)).toBe('8 thương hiệu Việt, từ nhiều vùng đất');
  });

  it('nhãn API khớp 8 nhãn thì lấy slug cho đích trang nhãn, vẫn đứng đúng thứ tự', () => {
    const list = journeyBrands([
      { brand: 'Le Plateau Coffee', slug: 'le-plateau' },
      { brand: 'Sokfram', slug: 'sokfarm' },
    ]);
    expect(list).toHaveLength(8);
    const byKey = Object.fromEntries(list.map((j) => [j.key, j]));
    expect(byKey.leplateau!.slug).toBe('le-plateau');
    expect(journeyBrandHref(byKey.leplateau!, '/san-pham')).toBe('/brand/le-plateau');
    expect(byKey.sokfram!.slug).toBe('sokfarm');
    expect(list.map((j) => j.key)).toEqual(BRAND_ORIGINS.map((o) => o.id));
  });

  it('nhãn API lạ nối thêm phía sau, không trùng, đích lọc ?brand=', () => {
    const list = journeyBrands([
      { brand: 'Tubu Tree', slug: null },
      { brand: 'Pineboo', slug: null },
      { brand: 'PINEBOO', slug: null },
      { brand: 'Moshav', slug: 'moshav' },
    ]);
    expect(list.map((j) => j.label)).toEqual([...BRAND_ORIGINS.map((o) => o.brand), 'Pineboo', 'Moshav']);
    expect(journeyBrandHref(list[8]!, '/san-pham')).toBe('/san-pham?brand=Pineboo');
    expect(journeyBrandHref(list[9]!, '/browse')).toBe('/brand/moshav');
  });

  it('nhãn hành trình không có slug thì đích là tìm theo từ khoá', () => {
    const [first] = journeyBrands(undefined);
    expect(journeyBrandHref(first!, '/san-pham')).toBe('/san-pham?q=Fuwa3e');
    expect(journeyBrandHref(first!, '/browse')).toBe('/browse?q=Fuwa3e');
  });
});

describe('findBrandOrigin', () => {
  it('khớp theo slug hoặc tên (không phân biệt hoa thường), nhãn lạ thì null', () => {
    expect(findBrandOrigin({ slug: 'fuwa3e', name: 'x' })?.id).toBe('fuwa3e');
    expect(findBrandOrigin({ slug: 'khac', name: ' BH.NONG ' })?.id).toBe('bhnong');
    expect(findBrandOrigin({ slug: 'khac', name: 'Không có' })).toBeNull();
  });
});

describe('dữ liệu nhãn', () => {
  it('đủ 8 nhãn, id duy nhất, không còn emoji hay gradient', () => {
    expect(BRAND_ORIGINS).toHaveLength(8);
    expect(new Set(BRAND_ORIGINS.map((o) => o.id)).size).toBe(8);
    for (const o of BRAND_ORIGINS) {
      expect(o).not.toHaveProperty('emoji');
      expect(o).not.toHaveProperty('gradient');
      expect(`${o.story}${o.ingredient}${o.province}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('viết "Đắk Lắk" đúng chính tả, không còn "Đắc Lắk"', () => {
    const provinces = BRAND_ORIGINS.map((o) => o.province);
    expect(provinces.join('|')).not.toMatch(/Đắc/);
    expect(provinces).toContain('Đắk Lắk');
  });
});
