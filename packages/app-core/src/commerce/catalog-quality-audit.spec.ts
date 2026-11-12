import { describe, expect, it } from 'vitest';
import {
  auditCatalogProducts,
  CATALOG_ISSUE_KINDS,
  CATALOG_ISSUE_LABELS,
  KNOWN_MEDIA_MISMATCHES,
  type AuditProduct,
} from './catalog-quality-audit';
import { PROD_CATALOG_2026_11_12 as ALL } from './prod-catalog-full.fixture';
import { findProductCopyFallback } from './product-copy-fallback';

const bare = (u: string) => u.split(/[?#]/)[0];
const asProducts = (over: (r: (typeof ALL)[number]) => Partial<AuditProduct> = () => ({})): AuditProduct[] =>
  ALL.map((r) => ({ slug: r.slug, name: r.name, thumbnail: r.thumbnail, inStock: r.inStock, ...over(r) }));
const kindsOf = (result: ReturnType<typeof auditCatalogProducts>, slug: string) => result.rows.find((r) => r.slug === slug)?.issues.map((i) => i.kind) ?? [];

describe('auditCatalogProducts trên ảnh chụp catalog PROD 12/11/2026 (111 SKU)', () => {
  it('chưa đọc mô tả: đếm đúng 25 thiếu ảnh (13 còn hàng) và 4 ảnh lệch tên, không báo trống mô tả', () => {
    const r = auditCatalogProducts(asProducts());
    expect(r.summary.total).toBe(111);
    expect(r.summary.byKind).toEqual({ known_media_mismatch: 4, missing_thumbnail: 25, empty_native_description: 0 });
    expect(r.summary.flagged).toBe(29);
    expect(r.summary.flaggedInStock).toBe(13 + 4);
    expect(r.rows).toHaveLength(29);
  });

  it('mô tả gốc trống ở mọi dòng: 111 dòng dính trống mô tả, ảnh lệch và thiếu ảnh vẫn giữ nguyên số', () => {
    const r = auditCatalogProducts(asProducts(() => ({ description: '<p>&nbsp;</p>' })));
    expect(r.summary.byKind).toEqual({ known_media_mismatch: 4, missing_thumbnail: 25, empty_native_description: 111 });
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
      byKind: { known_media_mismatch: 1, missing_thumbnail: 4, empty_native_description: 2 },
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
      summary: { total: 0, flagged: 0, flaggedInStock: 0, byKind: { known_media_mismatch: 0, missing_thumbnail: 0, empty_native_description: 0 } },
      rows: [],
    });
  });

  it('mọi loại lỗi có nhãn tiếng Việt và nằm trong thứ tự nặng đến nhẹ', () => {
    expect(CATALOG_ISSUE_KINDS).toEqual(['known_media_mismatch', 'missing_thumbnail', 'empty_native_description']);
    for (const k of CATALOG_ISSUE_KINDS) expect(CATALOG_ISSUE_LABELS[k].length).toBeGreaterThan(3);
  });

  it('không sửa mảng đầu vào', () => {
    const input = [P('a', 'A', { thumbnail: null }), P('b', 'B')];
    const copy = JSON.parse(JSON.stringify(input));
    auditCatalogProducts(input);
    expect(input).toEqual(copy);
  });
});
