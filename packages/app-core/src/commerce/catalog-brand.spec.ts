import { describe, expect, it } from 'vitest';
import {
  CATALOG_BRAND_RULES,
  GENERIC_CATALOG_BRAND,
  INFERRABLE_CATALOG_BRANDS,
  LEGACY_CATALOG_BRAND_SPELLINGS,
  canonicalCatalogBrand,
  catalogBrandSpellings,
  effectiveCatalogBrand,
  inferCatalogBrandFromTitle,
  isGenericCatalogBrand,
} from '@tubutree/shared-types';
import { BRAND_ORIGINS, canonicalBrandName, findBrandOrigin } from '../brand-origins';
import { PROD_CATALOG_2026_11_12 as ALL } from './prod-catalog-full.fixture';

const infer = (name: string | null | undefined, slug: string | null | undefined = '', brand: string | null = GENERIC_CATALOG_BRAND) =>
  inferCatalogBrandFromTitle(name, slug, brand);

describe('inferCatalogBrandFromTitle', () => {
  it.each([
    ['Nước giặt hương Cam Fuwa3e 500ml', 'Fuwa3e'],
    ['Nước lau đa năng FUWA3E 500ml', 'Fuwa3e'],
    ['Xịt tràm cho bé Pineboo 150ml', 'Pineboo'],
    ['Granola mix trái cây sấy BH.NONG - Lon 450g', 'BH.Nong'],
    ['Xoài sấy dẻo bh.nong', 'BH.Nong'],
    ['Dầu bơ tươi PƠ LANG 30ml/10ml', 'Pơ Lang'],
    ['Dầu bơ tươi Pơ Lang 30ml', 'Pơ Lang'],
    ['Dầu bơ tươi PO LANG 30ml', 'Pơ Lang'],
    ['Dầu Xả Thảo Dược VISANTE Chiết Xuất Sâm 500ml', 'Visante'],
    ['Nước Đông Trùng Hạ Thảo HECTOR Lite 70ml x 10 Chai', 'Hector'],
    ['Cà Phê Sữa Dừa Hòa Tan KAFEDUA Le Plateau Thơm Béo 16g x 10 Gói', 'Le Plateau Coffee'],
    ['Dầu dừa ép lạnh Cobote 250ml', 'Cobote'],
    ['Mật hoa dừa cô đặc Sokfarm', 'Sokfarm'],
    ['Đường hoa dừa SOKFRAM', 'Sokfarm'],
    ['Đường hoa dừa Sokfram', 'Sokfarm'],
  ])('%s -> %s', (name, brand) => {
    expect(infer(name)).toBe(brand);
  });

  it('DURICA là dòng hàng của Le Plateau, không phải nhãn riêng', () => {
    expect(infer('Cà Phê Sầu Riêng Thơm Béo DURICA Le Plateau Hộp g x 10 Gói')).toBe('Le Plateau Coffee');
  });

  it('chưa gán nhãn = rỗng, null hoặc "Tubu Tree": đều được suy', () => {
    for (const brand of ['', '  ', null, undefined, 'Tubu Tree']) expect(inferCatalogBrandFromTitle('Xịt tràm Pineboo 150ml', '', brand)).toBe('Pineboo');
  });

  it('nhãn Admin đã gán thì KHÔNG bao giờ đè, kể cả khi tên nói nhãn khác', () => {
    expect(infer('Xịt tràm cho bé Pineboo 150ml', '', 'Fuwa3e')).toBeNull();
    expect(infer('Xịt tràm cho bé Pineboo 150ml', '', 'Gốm Bát Tràng')).toBeNull();
    expect(infer('Nước giặt Fuwa3e 500ml', '', 'Le Plateau Coffee')).toBeNull();
  });

  it('không nhãn nào trong tên: null', () => {
    expect(infer('Cà phê muối túi 50x16g')).toBeNull();
    expect(infer('Socola Hòa Tan Uống liền CHOCO-OKE')).toBeNull();
    expect(infer('')).toBeNull();
    expect(infer(null)).toBeNull();
    expect(infer(undefined, null)).toBeNull();
    expect(infer(null, 'nuoc-giat-fuwa3e-500ml-1a2b3c')).toBe('Fuwa3e');
  });

  it('"BH nóng" có dấu cách không phải nhãn BH.Nong, kể cả khi slug trùng `bh-nong`', () => {
    expect(infer('Mì BH nóng giòn 100g', 'mi-bh-nong-gion-100g-abc123')).toBeNull();
    expect(infer('BH nóng giòn', 'bh-nong-gion-abc123')).toBeNull();
  });

  it('đòi khớp nguyên từ: "Hectorite" hay "Visanteen" không phải nhãn', () => {
    expect(infer('Bột Hectorite 100g')).toBeNull();
    expect(infer('Kem Visanteen 50g')).toBeNull();
  });

  it('combo hai nhãn thì không đoán, và không rơi xuống slug', () => {
    expect(infer('Combo Fuwa3e + Pineboo', 'combo-fuwa3e-pineboo-1a2b3c')).toBeNull();
  });

  it('tên không có nhãn thì đọc slug', () => {
    expect(infer('Sản phẩm mới', 'nuoc-giat-fuwa3e-500ml-1a2b3c')).toBe('Fuwa3e');
    expect(infer('Sản phẩm mới', 'xit-tram-cho-be-pineboo-150ml-b70d1d')).toBe('Pineboo');
    expect(infer('Sản phẩm mới', 'dau-goi-po-lang-300g-aa11bb')).toBe('Pơ Lang');
    expect(infer('Sản phẩm mới', 'dau-xa-visante-500ml-aa11bb', 'Tubu Tree')).toBe('Visante');
    expect(infer('Sản phẩm mới', null)).toBeNull();
    expect(infer('Sản phẩm mới', undefined)).toBeNull();
  });

  it('slug "bh-nong" không đủ để kết luận (tên "BH nóng" cùng ra slug đó)', () => {
    expect(infer('Sản phẩm mới', 'sua-hat-bh-nong-400g-aa11bb')).toBeNull();
  });
});

describe('effectiveCatalogBrand', () => {
  it('nhãn suy được nếu chưa gán nhãn thật, nếu không thì chính cột brand', () => {
    expect(effectiveCatalogBrand('Xịt tràm Pineboo 150ml', '', 'Tubu Tree')).toBe('Pineboo');
    expect(effectiveCatalogBrand('Xịt tràm Pineboo 150ml', '', 'Fuwa3e')).toBe('Fuwa3e');
    expect(effectiveCatalogBrand('Cà phê muối túi 50x16g', '', 'Tubu Tree')).toBe('Tubu Tree');
  });

  it('cột brand còn chính tả cũ "Sokfram" thì ra tên chuẩn "Sokfarm", không đè nhãn Admin khác', () => {
    expect(effectiveCatalogBrand('Mật hoa dừa Sokfarm', '', 'Sokfram')).toBe('Sokfarm');
    expect(effectiveCatalogBrand('Mật hoa dừa Sokfarm', '', 'SOKFRAM')).toBe('Sokfarm');
    expect(effectiveCatalogBrand('Mật hoa dừa Sokfarm', '', 'Tubu Tree')).toBe('Sokfarm');
    expect(effectiveCatalogBrand('Mật hoa dừa Sokfarm', '', 'Gốm Bát Tràng')).toBe('Gốm Bát Tràng');
  });
});

describe('canonicalCatalogBrand / catalogBrandSpellings — tương thích ngược "Sokfram"', () => {
  it.each(['Sokfram', 'sokfram', 'SOKFRAM', ' Sokfram ', 'Sokfarm', 'SOKFARM', 'sokfarm'])('%j -> "Sokfarm"', (raw) => {
    expect(canonicalCatalogBrand(raw)).toBe('Sokfarm');
  });

  it('nhãn khác trả nguyên văn (kể cả vỏ "Tubu Tree" và rỗng)', () => {
    for (const b of ['Fuwa3e', 'Pineboo', 'Pơ Lang', 'Le Plateau Coffee', 'Tubu Tree', '', 'Gốm Bát Tràng']) expect(canonicalCatalogBrand(b)).toBe(b);
  });

  it('mọi cách ghi của Sokfarm: tên chuẩn trước rồi chính tả cũ; nhãn khác chỉ chính nó', () => {
    expect(catalogBrandSpellings('Sokfram')).toEqual(['Sokfarm', 'Sokfram']);
    expect(catalogBrandSpellings('Sokfarm')).toEqual(['Sokfarm', 'Sokfram']);
    expect(catalogBrandSpellings('Fuwa3e')).toEqual(['Fuwa3e']);
    expect(catalogBrandSpellings('Tubu Tree')).toEqual(['Tubu Tree']);
  });

  it('tên chuẩn của nhãn suy được luôn là chính nó: không nhãn nào bị đổi tên ngoài chính tả cũ', () => {
    for (const b of INFERRABLE_CATALOG_BRANDS) expect(canonicalCatalogBrand(b)).toBe(b);
  });

  it('bảng chính tả cũ của shared-types khớp legacyCatalogBrands của BRAND_ORIGINS, và canonicalBrandName (web/Mini) cho cùng kết quả', () => {
    for (const o of BRAND_ORIGINS) {
      expect(LEGACY_CATALOG_BRAND_SPELLINGS[o.catalogBrand] ?? []).toEqual(o.legacyCatalogBrands ?? []);
    }
    const canonicals = new Set(BRAND_ORIGINS.map((o) => o.catalogBrand));
    for (const canonical of Object.keys(LEGACY_CATALOG_BRAND_SPELLINGS)) expect(canonicals.has(canonical)).toBe(true);
    for (const raw of ['Sokfram', 'sokfram', 'SOKFRAM', ' Sokfram ', 'Sokfarm', 'sokfarm', 'Fuwa3e', 'Pineboo', 'Le Plateau Coffee', 'Tubu Tree', '', 'Gốm Bát Tràng']) {
      expect(canonicalBrandName(raw), raw).toBe(canonicalCatalogBrand(raw));
    }
  });
});

describe('isGenericCatalogBrand', () => {
  it('chỉ rỗng và "Tubu Tree"', () => {
    expect(isGenericCatalogBrand('Tubu Tree')).toBe(true);
    expect(isGenericCatalogBrand(' Tubu Tree ')).toBe(true);
    expect(isGenericCatalogBrand('')).toBe(true);
    expect(isGenericCatalogBrand(null)).toBe(true);
    expect(isGenericCatalogBrand('Fuwa3e')).toBe(false);
  });
});

describe('bảng nhãn khớp BRAND_ORIGINS', () => {
  it('mọi nhãn trên bản đồ xuất xứ đều suy được, bằng đúng chuỗi catalogBrand mà web/Mini lọc theo', () => {
    for (const o of BRAND_ORIGINS) expect(INFERRABLE_CATALOG_BRANDS).toContain(o.catalogBrand);
  });

  it('ngoài BRAND_ORIGINS chỉ có Pineboo (nhãn riêng, chưa có ghim bản đồ)', () => {
    const origins = new Set(BRAND_ORIGINS.map((o) => o.catalogBrand));
    expect(INFERRABLE_CATALOG_BRANDS.filter((b) => !origins.has(b))).toEqual(['Pineboo']);
    expect(INFERRABLE_CATALOG_BRANDS).toHaveLength(BRAND_ORIGINS.length + 1);
  });

  it('chuỗi suy ra tìm lại đúng nhãn trên bản đồ (Pineboo dùng vùng của nhà máy Fuwa3e)', () => {
    for (const b of INFERRABLE_CATALOG_BRANDS) {
      const origin = findBrandOrigin({ slug: '', name: b });
      if (b === 'Pineboo') expect(origin?.catalogBrand).toBe('Fuwa3e');
      else expect(origin?.catalogBrand).toBe(b);
    }
  });

  it('mỗi nhãn chỉ có một luật, tên nhãn không trùng nhau', () => {
    expect(new Set(CATALOG_BRAND_RULES.map((r) => r.brand)).size).toBe(CATALOG_BRAND_RULES.length);
  });
});

describe('catalog PROD 12/11/2026 (111 SKU, tất cả đang ghi "Tubu Tree")', () => {
  const brands = ALL.map((r) => infer(r.name, r.slug));
  const count = (b: string | null) => brands.filter((x) => x === b).length;

  it('đếm đúng từng nhãn (số đã đối chiếu độc lập bằng grep tên sản phẩm)', () => {
    expect(ALL).toHaveLength(111);
    expect({
      Fuwa3e: count('Fuwa3e'),
      Pineboo: count('Pineboo'),
      'Pơ Lang': count('Pơ Lang'),
      'BH.Nong': count('BH.Nong'),
      Sokfarm: count('Sokfarm'),
      Visante: count('Visante'),
      Hector: count('Hector'),
      'Le Plateau Coffee': count('Le Plateau Coffee'),
      Cobote: count('Cobote'),
      'không nhãn': count(null),
    }).toEqual({ Fuwa3e: 44, Pineboo: 6, 'Pơ Lang': 14, 'BH.Nong': 12, Sokfarm: 10, Visante: 7, Hector: 7, 'Le Plateau Coffee': 2, Cobote: 0, 'không nhãn': 9 });
  });

  it('9 SKU không in tên nhãn ở tên lẫn slug thì giữ "Tubu Tree"', () => {
    expect(ALL.filter((_, i) => brands[i] === null).map((r) => r.name)).toEqual([
      '[MIXED NUTS] Granola túi tiện lợi - Hạt dinh dưỡng nướng mộc',
      '[HỘP THIẾC] Bánh mầm hạt rong biển 225g',
      '[HỘP THIẾC] Bánh mầm hạt yến mạch 225g',
      'Cà phê sầu riêng túi 20x20g',
      'Cà phê muối túi 50x16g',
      'Son dưỡng gấc tươi A07',
      'Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 gói',
      'CÀ PHÊ TRỨNG AHANO – Chuẩn vị Hà Nội, thơm ngậy khó cưỡng',
      'Socola Hòa Tan Uống liền CHOCO-OKE',
    ]);
  });

  it('không SKU nào bị nhận hai nhãn: số theo nhãn cộng số không nhãn đúng 111', () => {
    const named = INFERRABLE_CATALOG_BRANDS.reduce((n, b) => n + count(b), 0);
    expect(named + count(null)).toBe(111);
  });

  it('slug một mình cho cùng nhãn với tên, trừ BH.Nong (slug "bh-nong" mơ hồ nên bỏ)', () => {
    for (const r of ALL) {
      const byName = infer(r.name, r.slug);
      const bySlugOnly = infer('', r.slug);
      expect(bySlugOnly).toBe(byName === 'BH.Nong' ? null : byName);
    }
  });

  it('SKU đã có nhãn Admin gán thì không SKU nào bị suy lại', () => {
    for (const r of ALL) expect(inferCatalogBrandFromTitle(r.name, r.slug, 'Nhãn Admin gán')).toBeNull();
  });

  it('mọi nhãn suy được từ catalog thật đều lọc được qua đường dẫn duyệt của web/Mini (có trong bảng catalogBrand)', () => {
    const origins = new Set(BRAND_ORIGINS.map((o) => o.catalogBrand));
    for (const b of new Set(brands)) if (b && b !== 'Pineboo') expect(origins.has(b)).toBe(true);
  });
});
