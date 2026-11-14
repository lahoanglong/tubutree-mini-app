import { describe, expect, it } from 'vitest';
import {
  auditCatalogProducts,
  auditProductDtos,
  CATALOG_ISSUE_KINDS,
  CATALOG_ISSUE_LABELS,
  COPY_STATUS_LABELS,
  KNOWN_MEDIA_MISMATCHES,
  PLACEHOLDER_STOCK_MIN,
  type AuditProduct,
  type AuditVariation,
} from './catalog-quality-audit';
import type { CatalogAuditProductDto } from '@tubutree/shared-types';
import { PROD_CATALOG_2026_11_12 as ALL } from './prod-catalog-full.fixture';
import { findProductCopyFallback } from './product-copy-fallback';

const bare = (u: string) => u.split(/[?#]/)[0];
const asProducts = (over: (r: (typeof ALL)[number]) => Partial<AuditProduct> = () => ({})): AuditProduct[] =>
  ALL.map((r) => ({ slug: r.slug, name: r.name, thumbnail: r.thumbnail, inStock: r.inStock, ...over(r) }));
const ZERO_KINDS = { known_media_mismatch: 0, missing_thumbnail: 0, invalid_retail_price: 0, placeholder_stock: 0, unnamed_variation: 0, empty_native_description: 0 };
const kindsOf = (result: ReturnType<typeof auditCatalogProducts>, slug: string) => result.rows.find((r) => r.slug === slug)?.issues.map((i) => i.kind) ?? [];

describe('auditCatalogProducts trên ảnh chụp catalog PROD 12/11/2026 (111 SKU)', () => {
  it('chưa đọc mô tả: đếm đúng 25 thiếu ảnh (13 còn hàng) và 4 ảnh lệch tên, không báo trống mô tả', () => {
    const r = auditCatalogProducts(asProducts());
    expect(r.summary.total).toBe(111);
    expect(r.summary.byKind).toEqual({ ...ZERO_KINDS, known_media_mismatch: 4, missing_thumbnail: 25 });
    expect(r.summary.copy).toEqual({ native: 0, fallback: 0, none: 0, unknown: 111 });
    expect(r.summary.flagged).toBe(29);
    expect(r.summary.flaggedInStock).toBe(13 + 4);
    expect(r.rows).toHaveLength(29);
  });

  it('mô tả gốc trống ở mọi dòng: 111 dòng dính trống mô tả, ảnh lệch và thiếu ảnh vẫn giữ nguyên số', () => {
    const r = auditCatalogProducts(asProducts(() => ({ description: '<p>&nbsp;</p>' })));
    expect(r.summary.byKind).toEqual({ ...ZERO_KINDS, known_media_mismatch: 4, missing_thumbnail: 25, empty_native_description: 111 });
    expect(r.summary.flagged).toBe(111);
  });

  it('danh sách ảnh lệch khớp đúng bốn dòng PROD: slug gốc có thật và địa chỉ ảnh đang sai đúng bằng ảnh PROD', () => {
    expect(KNOWN_MEDIA_MISMATCHES.map((m) => m.baseSlug)).toEqual([
      'nuoc-rua-chen-fuwa3e-100ml',
      've-sinh-nha-tam-va-toilet-fuwa3e-100ml',
      've-sinh-nha-tam-va-toilet-fuwa3e-500ml',
      'dau-rua-mat-po-lang-100ml-55ml',
    ]);
    for (const m of KNOWN_MEDIA_MISMATCHES) {
      const row = ALL.find((r) => r.slug.replace(/-[0-9a-f]{6}$/, '') === m.baseSlug);
      expect(row, m.baseSlug).toBeDefined();
      expect(bare(row!.thumbnail ?? ''), m.baseSlug).toBe(bare(m.badThumbnail));
    }
    const r = auditCatalogProducts(asProducts());
    expect(r.rows.filter((x) => x.issues.some((i) => i.kind === 'known_media_mismatch')).map((x) => x.slug.replace(/-[0-9a-f]{6}$/, '')).sort()).toEqual(
      KNOWN_MEDIA_MISMATCHES.map((m) => m.baseSlug).sort(),
    );
  });

  it('câu báo ảnh lệch nêu điều ảnh đang thể hiện, tên SKU và cách sửa', () => {
    const r = auditCatalogProducts(asProducts());
    const row = r.rows.find((x) => x.slug.startsWith('dau-rua-mat-po-lang-100ml-55ml'))!;
    const msg = row.issues.find((i) => i.kind === 'known_media_mismatch')!.detail;
    expect(msg).toContain('Dầu tẩy trang Pơ Lang 55ml');
    expect(msg).toContain('Dầu rửa mặt PƠ LANG 100ml/55ml');
    expect(msg).toContain('Pancake');
  });

  it('ảnh đổi sang địa chỉ khác thì cảnh báo tự hết; bỏ ảnh thì chỉ còn thiếu ảnh', () => {
    const slug = ALL.find((r) => r.slug.startsWith('nuoc-rua-chen-fuwa3e-100ml'))!.slug;
    const base = asProducts();
    const fixed = auditCatalogProducts(base.map((p) => (p.slug === slug ? { ...p, thumbnail: 'https://content.pancake.vn/2-2608/2026/11/12/anh-moi.png' } : p)));
    expect(kindsOf(fixed, slug)).toEqual([]);
    expect(fixed.summary.byKind.known_media_mismatch).toBe(3);
    const removed = auditCatalogProducts(base.map((p) => (p.slug === slug ? { ...p, thumbnail: null } : p)));
    expect(kindsOf(removed, slug)).toEqual(['missing_thumbnail']);
  });

  it('khớp ảnh bỏ qua phần truy vấn và khoảng trắng, và khớp cả slug có lẫn không có hậu tố băm', () => {
    const m = KNOWN_MEDIA_MISMATCHES[0]!;
    for (const slug of [m.baseSlug, `${m.baseSlug}-c1337b`, `${m.baseSlug}-C1337B`]) {
      for (const thumbnail of [m.badThumbnail, `${m.badThumbnail}?v=2`, ` ${m.badThumbnail} `]) {
        const r = auditCatalogProducts([{ slug, name: 'Nước rửa chén Fuwa3e 100ml', thumbnail }]);
        expect(kindsOf(r, slug), `${slug} ${thumbnail}`).toEqual(['known_media_mismatch']);
      }
    }
    expect(kindsOf(auditCatalogProducts([{ slug: `${m.baseSlug}-ghi-chu`, name: 'x', thumbnail: m.badThumbnail }]), `${m.baseSlug}-ghi-chu`)).toEqual([]);
  });
});

describe('auditCatalogProducts: mô tả gốc trống', () => {
  const one = (description: string | null | undefined) => auditCatalogProducts([{ slug: 'sp-a', name: 'SP A', thumbnail: 'https://x/y.png', description }]);

  it.each([['rỗng', ''], ['khoảng trắng', '   '], ['thẻ trống', '<p></p>'], ['&nbsp;', '<p>&nbsp;</p>'], ['xuống dòng', '<br/>\n'], ['null', null]])('%s bị báo trống mô tả', (_n, d) => {
    expect(kindsOf(one(d), 'sp-a')).toEqual(['empty_native_description']);
  });

  it('có chữ thì không báo; chưa đọc được (undefined) cũng không báo oan', () => {
    expect(one('Mô tả thật của chủ hàng').rows).toEqual([]);
    expect(one(undefined).rows).toEqual([]);
  });

  it('câu báo nói rõ trang đang hiện chữ dự phòng hay để trống, tuỳ hasFallbackCopy', () => {
    const msg = (fb?: boolean) =>
      auditCatalogProducts([{ slug: 'sp-a', name: 'SP A', thumbnail: 'u', description: '' }], fb === undefined ? {} : { hasFallbackCopy: () => fb }).rows[0]!.issues[0]!.detail;
    expect(msg(true)).toContain('đang hiện chữ dự phòng');
    expect(msg(false)).toContain('để trống phần mô tả');
    expect(msg()).toContain('chữ dự phòng nếu có');
  });

  it('với bảng chữ dự phòng thật: cả 111 SKU đều đang có chữ dự phòng khi mô tả gốc trống', () => {
    const r = auditCatalogProducts(asProducts(() => ({ description: '' })), { hasFallbackCopy: (s) => !!findProductCopyFallback(s) });
    const empties = r.rows.map((x) => x.issues.find((i) => i.kind === 'empty_native_description')!.detail);
    expect(empties).toHaveLength(111);
    expect(empties.every((d) => d.includes('đang hiện chữ dự phòng'))).toBe(true);
  });
});

describe('auditCatalogProducts: sắp xếp và số đếm', () => {
  const P = (slug: string, name: string, over: Partial<AuditProduct> = {}): AuditProduct => ({ slug, name, thumbnail: 'https://x/ok.png', description: 'ok', inStock: true, ...over });
  const mismatch = KNOWN_MEDIA_MISMATCHES[1]!;

  it('còn hàng trước hết hàng, lỗi nặng trước lỗi nhẹ, nhiều lỗi trước ít lỗi, rồi theo tên', () => {
    const r = auditCatalogProducts([
      P('hh-1', 'A hết hàng', { inStock: false, thumbnail: null }),
      P('ch-mo-ta', 'B còn hàng trống mô tả', { description: '' }),
      P('ch-thieu-anh', 'C còn hàng thiếu ảnh', { thumbnail: null }),
      P(`${mismatch.baseSlug}-d45131`, 'D còn hàng ảnh lệch', { thumbnail: mismatch.badThumbnail }),
      P('ch-thieu-anh-va-mo-ta', 'E còn hàng thiếu ảnh và trống mô tả', { thumbnail: null, description: '' }),
      P('ch-thieu-anh-2', 'A còn hàng thiếu ảnh', { thumbnail: null }),
      P('sach', 'Z sạch'),
    ]);
    expect(r.rows.map((x) => x.slug)).toEqual([`${mismatch.baseSlug}-d45131`, 'ch-thieu-anh-va-mo-ta', 'ch-thieu-anh-2', 'ch-thieu-anh', 'ch-mo-ta', 'hh-1']);
    expect(r.summary).toEqual({
      total: 7,
      flagged: 6,
      flaggedInStock: 5,
      byKind: { ...ZERO_KINDS, known_media_mismatch: 1, missing_thumbnail: 4, empty_native_description: 2 },
      copy: { native: 5, fallback: 0, none: 2, unknown: 0 },
    });
  });

  it('inStock không rõ thì coi như đang thấy (xếp cùng nhóm còn hàng, tính vào flaggedInStock); sản phẩm sạch không có dòng', () => {
    const r = auditCatalogProducts([{ slug: 'a', name: 'A', thumbnail: null }, P('b', 'B')]);
    expect(r.rows.map((x) => x.slug)).toEqual(['a']);
    expect(r.rows[0]).not.toHaveProperty('inStock');
    expect(r.summary.flaggedInStock).toBe(1);
  });

  it('danh sách rỗng: số đếm bằng 0, không ném lỗi', () => {
    expect(auditCatalogProducts([])).toEqual({
      summary: { total: 0, flagged: 0, flaggedInStock: 0, byKind: ZERO_KINDS, copy: { native: 0, fallback: 0, none: 0, unknown: 0 } },
      rows: [],
    });
  });

  it('mọi loại lỗi có nhãn tiếng Việt và nằm trong thứ tự nặng đến nhẹ', () => {
    expect(CATALOG_ISSUE_KINDS).toEqual([
      'known_media_mismatch',
      'missing_thumbnail',
      'invalid_retail_price',
      'placeholder_stock',
      'unnamed_variation',
      'empty_native_description',
    ]);
    for (const k of CATALOG_ISSUE_KINDS) expect(CATALOG_ISSUE_LABELS[k].length).toBeGreaterThan(3);
  });

  it('không sửa mảng đầu vào', () => {
    const input = [P('a', 'A', { thumbnail: null }), P('b', 'B')];
    const copy = JSON.parse(JSON.stringify(input));
    auditCatalogProducts(input);
    expect(input).toEqual(copy);
  });
});

const V = (over: Partial<AuditVariation> = {}): AuditVariation => ({
  id: 'v1',
  pancakeId: 'pk-v1',
  sku: 'SKU-1',
  name: 'Chai 100ml',
  stock: 10,
  retailPrice: 50000,
  isActive: true,
  ...over,
});
const PV = (variations: AuditVariation[] | undefined, over: Partial<AuditProduct> = {}): AuditProduct => ({
  slug: 'sp-bt',
  name: 'SP biến thể',
  thumbnail: 'https://x/ok.png',
  description: 'ok',
  inStock: true,
  ...(variations === undefined ? null : { variations }),
  ...over,
});
const variationKinds = (variations: AuditVariation[] | undefined, over: Partial<AuditProduct> = {}) =>
  auditCatalogProducts([PV(variations, over)]).rows[0]?.issues.map((i) => i.kind) ?? [];

describe('auditCatalogProducts: lỗi cấp biến thể', () => {
  it('biến thể sạch hoặc sản phẩm không có `variations` (Mini đọc danh sách công khai) thì không báo oan', () => {
    expect(variationKinds([V()])).toEqual([]);
    expect(variationKinds([])).toEqual([]);
    expect(variationKinds(undefined)).toEqual([]);
    const r = auditCatalogProducts([{ slug: 'a', name: 'A', thumbnail: 'u', description: 'ok' }]);
    expect(r.rows).toEqual([]);
  });

  it.each([
    ['0', 0],
    ['-1', -1],
    ['NaN', Number.NaN],
    ['vô cực', Number.POSITIVE_INFINITY],
    ['không phải số', '12000' as unknown as number],
  ])('giá bán %s bị báo giá bằng 0 hoặc sai', (_n, retailPrice) => {
    expect(variationKinds([V({ retailPrice })])).toEqual(['invalid_retail_price']);
  });

  it('giá nhỏ nhất hợp lệ (1) không bị báo', () => {
    expect(variationKinds([V({ retailPrice: 1 })])).toEqual([]);
  });

  it('tồn kho giả: đúng 100000 bị báo, 99999 thì không', () => {
    expect(PLACEHOLDER_STOCK_MIN).toBe(100000);
    expect(variationKinds([V({ stock: PLACEHOLDER_STOCK_MIN - 1 })])).toEqual([]);
    expect(variationKinds([V({ stock: PLACEHOLDER_STOCK_MIN })])).toEqual(['placeholder_stock']);
    expect(variationKinds([V({ stock: 9_999_999 })])).toEqual(['placeholder_stock']);
  });

  it.each([
    ['rỗng', ''],
    ['toàn khoảng trắng', '   \t '],
    ['[object Object]', '[object Object]'],
    ['[object Object] có khoảng trắng', ' [object Object] '],
    ['có [object Object] ở giữa', 'Hộp [object Object] 100g'],
    ['có [object Object] ở đầu', '[object Object] 500ml'],
    ['có [object Object] ở cuối', 'Chai 500ml [object Object]'],
    ['lặp [object Object] liền nhau', '[object Object][object Object]'],
  ])('tên biến thể %s bị báo chưa đặt tên', (_n, name) => {
    expect(variationKinds([V({ name })])).toEqual(['unnamed_variation']);
  });

  it('tên có ngoặc vuông bình thường không bị báo là hỏng', () => {
    expect(variationKinds([V({ name: 'Chai [500ml]' }), V({ id: 'o', name: 'Object 500ml' })])).toEqual([]);
  });

  it('biến thể đang ẩn (isActive=false) và sản phẩm đang ẩn vẫn bị báo cả ba loại', () => {
    const bad = V({ isActive: false, retailPrice: 0, stock: 100000, name: ' ' });
    expect(variationKinds([bad])).toEqual(['invalid_retail_price', 'placeholder_stock', 'unnamed_variation']);
    expect(variationKinds([bad], { isActive: false, inStock: false })).toEqual(['invalid_retail_price', 'placeholder_stock', 'unnamed_variation']);
  });

  it('thứ tự lỗi trong một dòng đi từ nặng đến nhẹ, trống mô tả đứng cuối; variationIds chỉ ghi đúng biến thể dính lỗi', () => {
    const r = auditCatalogProducts([
      PV([V({ id: 'a', retailPrice: 0 }), V({ id: 'b', name: '' }), V({ id: 'c', stock: 500000 }), V({ id: 'd' })], { thumbnail: null, description: '' }),
    ]);
    const issues = r.rows[0]!.issues;
    expect(issues.map((i) => i.kind)).toEqual(['missing_thumbnail', 'invalid_retail_price', 'placeholder_stock', 'unnamed_variation', 'empty_native_description']);
    expect(issues.find((i) => i.kind === 'invalid_retail_price')!.variationIds).toEqual(['a']);
    expect(issues.find((i) => i.kind === 'unnamed_variation')!.variationIds).toEqual(['b']);
    expect(issues.find((i) => i.kind === 'placeholder_stock')!.variationIds).toEqual(['c']);
    expect(issues.find((i) => i.kind === 'missing_thumbnail')).not.toHaveProperty('variationIds');
    expect(r.summary.byKind).toEqual({ ...ZERO_KINDS, missing_thumbnail: 1, invalid_retail_price: 1, placeholder_stock: 1, unnamed_variation: 1, empty_native_description: 1 });
  });

  it('một sản phẩm nhiều biến thể lỗi cùng loại chỉ tính một lần vào byKind', () => {
    const r = auditCatalogProducts([PV([V({ id: 'a', retailPrice: 0 }), V({ id: 'b', retailPrice: -5 })])]);
    expect(r.summary.byKind.invalid_retail_price).toBe(1);
    expect(r.rows[0]!.issues[0]!.variationIds).toEqual(['a', 'b']);
  });

  it('lỗi biến thể nặng hơn trống mô tả nên xếp trước khi cùng còn hàng', () => {
    const r = auditCatalogProducts([
      { slug: 'a', name: 'A', thumbnail: 'u', description: '', inStock: true },
      PV([V({ retailPrice: 0 })], { slug: 'z', name: 'Z' }),
    ]);
    expect(r.rows.map((x) => x.slug)).toEqual(['z', 'a']);
  });

  describe('câu báo nêu SKU và gợi ý sửa', () => {
    const detail = (kind: string, variations: AuditVariation[]) =>
      auditCatalogProducts([PV(variations)]).rows[0]!.issues.find((i) => i.kind === kind)!.detail;
    const many = (n: number, over: (i: number) => Partial<AuditVariation>) => Array.from({ length: n }, (_x, i) => V({ id: `v${i}`, sku: `SKU-${i}`, ...over(i) }));

    it('giá sai: nêu SKU kèm giá, gợi ý sửa trong Pancake và cảnh báo mỗi 15 phút', () => {
      const d = detail('invalid_retail_price', [V({ sku: 'A1', retailPrice: 0, isActive: false })]);
      expect(d).toContain('A1 (giá 0)');
      expect(d).toContain('Pancake');
      expect(d).toContain('15 phút');
      expect(detail('invalid_retail_price', [V({ sku: 'A2', retailPrice: Number.NaN })])).toContain('A2 (giá không phải số)');
    });

    it('tồn giả: nêu SKU kèm số tồn và ngưỡng', () => {
      const d = detail('placeholder_stock', [V({ sku: 'B1', stock: 999999 })]);
      expect(d).toContain('B1 (tồn 999.999)');
      expect(d).toContain('100.000');
      expect(d).toContain('Pancake');
    });

    it('chưa đặt tên: nêu SKU, và SKU trống thì rơi về mã Pancake rồi mã biến thể', () => {
      expect(detail('unnamed_variation', [V({ sku: 'C1', name: '' })])).toContain('C1');
      expect(detail('unnamed_variation', [V({ sku: ' ', name: '', pancakeId: 'pk-9' })])).toContain('pk-9');
      expect(detail('unnamed_variation', [V({ id: 'id-7', sku: '', name: '', pancakeId: null })])).toContain('id-7');
    });

    it('liệt kê tối đa 3 SKU đầu rồi "và N SKU khác"', () => {
      const three = detail('invalid_retail_price', many(3, () => ({ retailPrice: 0 })));
      expect(three).toContain('SKU-0 (giá 0), SKU-1 (giá 0), SKU-2 (giá 0)');
      expect(three).not.toContain('SKU khác');
      const five = detail('invalid_retail_price', many(5, () => ({ retailPrice: 0 })));
      expect(five).toContain('SKU-0 (giá 0), SKU-1 (giá 0), SKU-2 (giá 0) và 2 SKU khác');
      expect(five).not.toContain('SKU-3');
      expect(detail('unnamed_variation', many(4, () => ({ name: '' })))).toContain('SKU-0, SKU-1, SKU-2 và 1 SKU khác');
    });
  });
});

describe('auditCatalogProducts: copyStatus và summary.copy', () => {
  const FB = new Set(['sp-fb']);
  const opts = { hasFallbackCopy: (s: string) => FB.has(s) };
  const P = (slug: string, description: string | null | undefined): AuditProduct => ({ slug, name: slug, thumbnail: 'u', description });

  it('bốn giá trị: native, fallback, none, unknown, kèm nhãn đúng nguyên văn', () => {
    const r = auditCatalogProducts([P('sp-native', 'Mô tả thật'), P('sp-fb', '<p>&nbsp;</p>'), P('sp-none', ''), P('sp-null', null), P('sp-unknown', undefined)], opts);
    const status = (slug: string) => r.rows.find((x) => x.slug === slug)?.copyStatus;
    expect(status('sp-fb')).toBe('fallback');
    expect(status('sp-none')).toBe('none');
    expect(status('sp-null')).toBe('none');
    expect(r.rows.find((x) => x.slug === 'sp-native')).toBeUndefined();
    expect(r.rows.find((x) => x.slug === 'sp-unknown')).toBeUndefined();
    expect(COPY_STATUS_LABELS).toEqual({
      native: 'Đã có mô tả gốc DB',
      fallback: 'Đang dùng bản dự phòng',
      none: 'Chưa có mô tả',
      unknown: 'Chưa đọc được mô tả',
    });
  });

  it('summary.copy đếm trên TẤT CẢ sản phẩm, kể cả sản phẩm không có lỗi', () => {
    const r = auditCatalogProducts([P('sp-native', 'Mô tả thật'), P('sp-native-2', 'Khác'), P('sp-fb', ''), P('sp-none', ''), P('sp-unknown', undefined)], opts);
    expect(r.summary.copy).toEqual({ native: 2, fallback: 1, none: 1, unknown: 1 });
    expect(r.summary.flagged).toBe(2);
    expect(r.summary.total).toBe(5);
  });

  it('copyStatus có ở dòng lỗi ngoài mô tả: sản phẩm thiếu ảnh nhưng đã có mô tả gốc là native', () => {
    const r = auditCatalogProducts([{ slug: 'a', name: 'A', thumbnail: null, description: 'có chữ' }]);
    expect(r.rows[0]!.copyStatus).toBe('native');
    const u = auditCatalogProducts([{ slug: 'b', name: 'B', thumbnail: null }]);
    expect(u.rows[0]!.copyStatus).toBe('unknown');
  });

  it('không truyền hasFallbackCopy thì mô tả trống tính là none (không khẳng định có bản dự phòng)', () => {
    expect(auditCatalogProducts([P('sp-fb', '')]).summary.copy).toEqual({ native: 0, fallback: 0, none: 1, unknown: 0 });
  });

  it('với bảng chữ dự phòng thật: 111 SKU trống mô tả gốc đều là fallback', () => {
    const r = auditCatalogProducts(asProducts(() => ({ description: '' })), { hasFallbackCopy: (s) => !!findProductCopyFallback(s) });
    expect(r.summary.copy).toEqual({ native: 0, fallback: 111, none: 0, unknown: 0 });
  });
});

describe('auditCatalogProducts: định danh sản phẩm trên dòng lỗi', () => {
  it('mang id, pancakeId, isActive khi có; bỏ hẳn khoá khi không có (hành vi cũ không đổi)', () => {
    const r = auditCatalogProducts([
      { slug: 'a', name: 'A', thumbnail: null, id: 'p1', pancakeId: 'pk1', isActive: false },
      { slug: 'b', name: 'B', thumbnail: null, pancakeId: null },
      { slug: 'c', name: 'C', thumbnail: null },
    ]);
    const by = (slug: string) => r.rows.find((x) => x.slug === slug)!;
    expect(by('a')).toMatchObject({ id: 'p1', pancakeId: 'pk1', isActive: false });
    expect(by('b')).toHaveProperty('pancakeId', null);
    expect(by('b')).not.toHaveProperty('id');
    expect(by('c')).not.toHaveProperty('id');
    expect(by('c')).not.toHaveProperty('pancakeId');
    expect(by('c')).not.toHaveProperty('isActive');
  });
});

describe('auditProductDtos (dữ liệu máy chủ cho web)', () => {
  const dto = (over: Partial<CatalogAuditProductDto> = {}): CatalogAuditProductDto => ({
    id: 'p1',
    slug: 'sp-dto',
    name: 'SP DTO',
    pancakeId: 'pk-p1',
    isActive: true,
    thumbnail: 'https://x/ok.png',
    description: 'Mô tả gốc',
    shortDesc: null,
    hasIngredients: true,
    inStock: true,
    variations: [V()],
    ...over,
  });

  it('DTO sạch không có dòng, summary.copy tính native', () => {
    const r = auditProductDtos([dto()]);
    expect(r.rows).toEqual([]);
    expect(r.summary.copy.native).toBe(1);
  });

  it('xét đủ sáu loại lỗi, mang id/pancakeId/isActive và inStock từ DTO, kể cả sản phẩm đang ẩn', () => {
    const r = auditProductDtos(
      [
        dto({ description: '', thumbnail: null, isActive: false, inStock: false, variations: [V({ id: 'x', retailPrice: 0, isActive: false }), V({ id: 'y', stock: 100000, name: '' })] }),
        dto({ id: 'p2', slug: 'sp-dto-2', name: 'Khác' }),
      ],
      { hasFallbackCopy: () => true },
    );
    expect(r.summary.total).toBe(2);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row).toMatchObject({ id: 'p1', pancakeId: 'pk-p1', isActive: false, inStock: false, copyStatus: 'fallback' });
    expect(row.issues.map((i) => i.kind)).toEqual(['missing_thumbnail', 'invalid_retail_price', 'placeholder_stock', 'unnamed_variation', 'empty_native_description']);
    expect(r.summary.copy).toEqual({ native: 1, fallback: 1, none: 0, unknown: 0 });
  });

  it('khớp auditCatalogProducts trên cùng dữ liệu', () => {
    const d = dto({ variations: [V({ retailPrice: -1 })] });
    expect(auditProductDtos([d])).toEqual(auditCatalogProducts([{ ...d }]));
  });
});
