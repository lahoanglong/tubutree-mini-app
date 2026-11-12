import { describe, expect, it } from 'vitest';
import type { Ingredient } from '@tubutree/shared-types';
import { BAMBOO_CLAIMS, MEDICAL_CLAIMS, NATURAL_CLAIMS, PROOF_CLAIMS } from './copy-claims-guard';
import { resolveStoryConfig } from './product-story';
import { findProductCopyFallback, resolveProductCopyFallback, withProductCopyFallback, type CopyIngredient } from './product-copy-fallback';
import { PROD_IN_STOCK_2026_11_12 as ROWS } from './prod-catalog.fixture';

const PRODUCT = (slug: string, over: { description?: string; ingredients?: Ingredient[] | null } = {}) => ({ slug, description: '', ingredients: null as Ingredient[] | null, ...over });

const compact = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const textOf = (fb: { description: string; ingredients: CopyIngredient[] }) => [fb.description, ...fb.ingredients.flatMap((i) => [i.name, i.benefit ?? ''])];

/** Không có nguồn nào để lập danh sách thành phần: chưa có ảnh bao bì (thumbnail null trên PROD), hoặc tên chỉ là ký hiệu. Rỗng thay vì bịa. */
const NO_INGREDIENT_SOURCE = [
  'combo-sach-diu-nhe-po-lang-srm-tt',
  'lau-noi-that-o-to-fuwa3e-300ml',
  'nuoc-rua-chen-fuwa3e-100ml',
  'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l',
  'xit-khu-mui-o-to-fuwa3e-150ml',
  'xit-thom-huong-xuan-fuwa3e-300ml',
];

const baseOf = (slug: string) => slug.replace(/-[0-9a-f]{6,8}$/i, '');
const BRAND_WORD: [RegExp, string][] = [
  [/pineboo/i, 'pineboo'],
  [/fuwa3e/i, 'fuwa3e'],
  [/sokfarm/i, 'sokfarm'],
  [/bh\.nong/i, 'bh.nong'],
  [/pơ lang/i, 'pơ lang'],
];

describe('chữ dự phòng cho 64 sản phẩm còn hàng trên PROD (ảnh chụp 12/11/2026)', () => {
  it('fixture đúng 64 dòng và dòng nào cũng có mô tả dự phòng', () => {
    expect(ROWS).toHaveLength(64);
    for (const r of ROWS) {
      const fb = findProductCopyFallback(r.slug);
      expect(fb, r.slug).toBeDefined();
      expect(fb!.description.trim().length, r.slug).toBeGreaterThan(20);
    }
  });

  it('thành phần có ở mọi dòng, trừ đúng danh sách không có nguồn', () => {
    const empty = ROWS.filter((r) => findProductCopyFallback(r.slug)!.ingredients.length === 0).map((r) => baseOf(r.slug));
    expect(empty.sort()).toEqual([...NO_INGREDIENT_SOURCE].sort());
  });

  it('mô tả nêu đúng nhãn và đúng quy cách ghi trong tên SKU', () => {
    for (const r of ROWS) {
      const d = compact(findProductCopyFallback(r.slug)!.description);
      const brand = BRAND_WORD.find(([re]) => re.test(r.name));
      expect(brand, `${r.slug}: không nhận ra nhãn`).toBeDefined();
      expect(d, r.slug).toContain(compact(brand![1]));
      for (const size of r.name.match(/\d+(?:,\d+)?\s?(?:ml|l|g|kg)\b/gi) ?? []) expect(d, `${r.slug}: thiếu quy cách ${size}`).toContain(compact(size));
    }
  });

  it('không có tuyên bố y tế, giấy tờ, hữu cơ, xuất xứ, "tự nhiên", con số % hay tre ở mô tả, tên và ghi chú thành phần', () => {
    for (const r of ROWS) {
      for (const t of textOf(findProductCopyFallback(r.slug)!)) {
        expect(t, `${r.slug}: "${t}"`).not.toMatch(MEDICAL_CLAIMS);
        expect(t, `${r.slug}: "${t}"`).not.toMatch(PROOF_CLAIMS);
        expect(t, `${r.slug}: "${t}"`).not.toMatch(BAMBOO_CLAIMS);
        expect(t, `${r.slug}: "${t}"`).not.toMatch(NATURAL_CLAIMS);
      }
    }
  });

  it('không dựng con số phần trăm: thành phần không có `percentage`', () => {
    for (const r of ROWS) for (const i of findProductCopyFallback(r.slug)!.ingredients) expect(i.percentage, `${r.slug}: ${i.name}`).toBeUndefined();
  });

  it('Pineboo: eco-enzyme từ vỏ dứa theo bao bì, không có tre', () => {
    const pineboo = ROWS.filter((r) => /pineboo/i.test(r.name));
    expect(pineboo).toHaveLength(6);
    for (const r of pineboo) {
      const fb = findProductCopyFallback(r.slug)!;
      expect(fb.description, r.slug).toMatch(/Bao bì ghi eco-enzyme lên men từ vỏ dứa/);
      expect(fb.ingredients[0]!.name, r.slug).toBe('Eco-enzyme lên men từ vỏ dứa');
      expect(textOf(fb).join(' '), r.slug).not.toMatch(/\btre\b/i);
    }
  });

  it('Fuwa3e chưa có ảnh bao bì (và nước rửa chén 100ml mà ảnh mang tiêu đề hàng khác), muối rửa chén: chỉ nói điều tên nêu, không enzyme, không "Bao bì ghi"', () => {
    for (const slug of ['lau-noi-that-o-to-fuwa3e-300ml', 'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l', 'xit-khu-mui-o-to-fuwa3e-150ml', 'xit-thom-huong-xuan-fuwa3e-300ml', 'muoi-rua-chen-cho-may-fuwa3e-2kg', 'nuoc-rua-chen-fuwa3e-100ml']) {
      expect(textOf(findProductCopyFallback(slug)!).join(' '), slug).not.toMatch(/enzyme|bao bì ghi/i);
    }
  });

  it('SKU Sokfarm, BH.NONG, Pơ Lang chưa có ảnh bao bì không mượn chữ của SKU khác', () => {
    for (const slug of [
      'duong-hoa-dua-sokfarm-hu-thuy-tinh-150g',
      'mat-co-dac-sokfarm-hop-12-goi',
      'granola-mix-nuts-tui-tien-loi-bh-nong',
      'bot-hat-cu-qua-bh-nong-lon-400g',
      'banh-mam-hat-rong-bien-bh-nong',
      'banh-mam-hat-yen-mach-bh-nong',
      'nuoc-mui-gia-po-lang-160ml',
      'dau-goi-dau-xa-qua-bo-po-lang-300g',
      'combo-son-duong-po-lang-1-thoi-co-mau-1-thoi-khong-mau',
      'combo-sach-diu-nhe-po-lang-srm-tt',
    ]) {
      expect(findProductCopyFallback(slug)!.description, slug).not.toMatch(/Bao bì ghi|Trà Vinh|hữu cơ|Organic/);
    }
  });
});

describe('chữ dự phòng không được thay câu chuyện sản phẩm', () => {
  const VARIATIONS = [{ id: 'v1', name: 'Mặc định' }];
  const raw = (r: { slug: string; name: string }) => ({ slug: r.slug, name: r.name, brand: 'Tubu Tree', variations: VARIATIONS, ingredients: null as Ingredient[] | null, storyConfig: null, description: '' });

  it('mọi dòng của PROD: câu chuyện dựng từ sản phẩm đã bù chữ giống hệt câu chuyện dựng từ sản phẩm thô', () => {
    for (const r of ROWS) {
      const p = raw(r);
      const filled = withProductCopyFallback(p);
      if (findProductCopyFallback(r.slug)!.ingredients.length > 0) expect(filled.ingredients, r.slug).not.toBeNull();
      expect(resolveStoryConfig(filled), r.slug).toEqual(resolveStoryConfig(p));
    }
  });

  it('SKU chỉ có kịch bản cấp nhãn: không rơi vào kịch bản "Tinh tuyển nguyên liệu" và không lộ ghi chú nguồn của chữ dự phòng', () => {
    for (const slug of ['muoi-rua-chen-cho-may-fuwa3e-2kg-484ca1', 'granola-mix-nuts-tui-tien-loi-bh-nong-3b8792', 'nuoc-mui-gia-po-lang-160ml-458227']) {
      const row = ROWS.find((r) => r.slug === slug)!;
      const cfg = resolveStoryConfig(withProductCopyFallback(raw(row)));
      const text = JSON.stringify(cfg);
      expect(text, slug).not.toMatch(/Tinh tuyển|Theo tên sản phẩm|Theo chữ in trên bao bì|An lành cho cả nhà/);
    }
  });

  it('thành phần do chủ hàng nhập vẫn được kể chuyện như trước (chỉ dòng dự phòng bị bỏ qua)', () => {
    const own = [{ name: 'Quả bơ', benefit: 'Dưỡng mềm' }, { name: 'Dầu dừa' }];
    const row = ROWS.find((r) => r.slug.startsWith('dau-goi-dau-xa-qua-bo'))!;
    const cfg = resolveStoryConfig(withProductCopyFallback({ ...raw(row), ingredients: own }));
    expect(cfg!.scenes.some((s) => s.kind === 'ingredient_assembly')).toBe(true);
  });

  it('dòng thành phần dự phòng mang cờ fromFallback; dòng của DB thì không', () => {
    const row = ROWS[0]!;
    for (const i of findProductCopyFallback(row.slug)!.ingredients) expect(i.fromFallback).toBe(true);
    const own = [{ name: 'Dầu tràm' }];
    expect(withProductCopyFallback({ ...raw(row), ingredients: own }).ingredients).toBe(own);
  });
});

describe('resolveProductCopyFallback / withProductCopyFallback', () => {
  const SLUG = 'xit-tram-cho-be-pineboo-150ml-b70d1d';
  const DB_INGREDIENTS: Ingredient[] = [{ name: 'Dầu tràm', percentage: 5, benefit: 'Từ DB' }];

  it('DB có đủ cả hai: giữ nguyên 100% (cùng chữ mô tả, cùng thành phần, cùng đối tượng sản phẩm)', () => {
    for (const r of ROWS) {
      const p = PRODUCT(r.slug, { description: `Mô tả riêng của ${r.name}`, ingredients: [{ name: 'Nguyên liệu riêng', percentage: 12 }] });
      const out = resolveProductCopyFallback(p);
      expect(out.description, r.slug).toBe(p.description);
      expect(out.ingredients, r.slug).toEqual(p.ingredients);
      expect(withProductCopyFallback(p), r.slug).toBe(p);
    }
  });

  it('từng trường độc lập: có mô tả thiếu thành phần thì chỉ bù thành phần, và ngược lại', () => {
    const fb = findProductCopyFallback(SLUG)!;
    const onlyDesc = withProductCopyFallback(PRODUCT(SLUG, { description: 'Mô tả của DB' }));
    expect(onlyDesc.description).toBe('Mô tả của DB');
    expect(onlyDesc.ingredients).toEqual(fb.ingredients);
    const onlyIng = withProductCopyFallback(PRODUCT(SLUG, { ingredients: DB_INGREDIENTS }));
    expect(onlyIng.description).toBe(fb.description);
    expect(onlyIng.ingredients).toBe(DB_INGREDIENTS);
  });

  it('DB trống kiểu Pancake (rỗng, khoảng trắng, thẻ trống, &nbsp;, null, thành phần chỉ có tên trống) đều bị coi là chưa điền', () => {
    const fb = findProductCopyFallback(SLUG)!;
    for (const description of ['', '   ', '<p></p>', '<p>&nbsp;</p>', '<br/>\n']) {
      for (const ingredients of [null, [], [{ name: '  ' }]] as (Ingredient[] | null)[]) {
        const out = resolveProductCopyFallback({ slug: SLUG, description, ingredients });
        expect(out, JSON.stringify({ description, ingredients })).toEqual(fb);
      }
    }
    expect(resolveProductCopyFallback({ slug: SLUG, description: null, ingredients: '' })).toEqual(fb);
    expect(resolveProductCopyFallback({ slug: SLUG })).toEqual(fb);
  });

  it('thành phần dạng chuỗi của DB được tách theo dấu phẩy, chấm phẩy, xuống dòng và thắng chữ dự phòng', () => {
    const out = resolveProductCopyFallback({ slug: SLUG, ingredients: 'Dầu tràm, Nước; Glycerin\nHương liệu' });
    expect(out.ingredients.map((i) => i.name)).toEqual(['Dầu tràm', 'Nước', 'Glycerin', 'Hương liệu']);
  });

  it('khớp slug có hậu tố băm Pancake lẫn slug gốc, nhưng không khớp mờ', () => {
    const fb = findProductCopyFallback(SLUG);
    expect(fb).toBeDefined();
    expect(findProductCopyFallback('xit-tram-cho-be-pineboo-150ml')).toBe(fb);
    expect(findProductCopyFallback('XIT-TRAM-CHO-BE-PINEBOO-150ML-B70D1D')).toBe(fb);
    expect(findProductCopyFallback('xit-tram-cho-be-pineboo-150ml-ghi-chu')).toBeUndefined();
    expect(findProductCopyFallback('xit-tram-cho-be-pineboo')).toBeUndefined();
    expect(findProductCopyFallback('constructor')).toBeUndefined();
    expect(findProductCopyFallback('__proto__')).toBeUndefined();
  });

  it('slug lạ: không bịa, trả lại đúng đối tượng cũ và rỗng nếu DB cũng rỗng', () => {
    const p = PRODUCT('san-pham-chua-co-chu-du-phong-123abc');
    expect(withProductCopyFallback(p)).toBe(p);
    expect(resolveProductCopyFallback(p)).toEqual({ description: '', ingredients: [] });
  });

  it('bù chữ thì tạo bản sao, không sửa đối tượng gốc (dữ liệu React Query giữ nguyên)', () => {
    const p = PRODUCT(SLUG);
    const out = withProductCopyFallback(p);
    expect(out).not.toBe(p);
    expect(p).toEqual(PRODUCT(SLUG));
    expect(out.description.length).toBeGreaterThan(0);
    expect(out.ingredients!.length).toBeGreaterThan(0);
  });
});
