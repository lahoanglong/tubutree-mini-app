import { describe, expect, it } from 'vitest';
import type { Ingredient } from '@tubutree/shared-types';
import { BAMBOO_CLAIMS, MEDICAL_CLAIMS, NATURAL_CLAIMS, PROOF_CLAIMS } from './copy-claims-guard';
import { baseSlug } from './catalog-text';
import { PROD_CATALOG_2026_11_12 as ALL } from './prod-catalog-full.fixture';
import { PROD_IN_STOCK_2026_11_12 as IN_STOCK } from './prod-catalog.fixture';
import { resolveStoryConfig } from './product-story';
import { findProductCopyFallback, withProductCopyFallback, type CopyIngredient } from './product-copy-fallback';

const compact = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const textOf = (fb: { description: string; ingredients: CopyIngredient[] }) => [fb.description, ...fb.ingredients.flatMap((i) => [i.name, i.benefit ?? ''])];

/**
 * Không có nguồn để lập danh sách thành phần: 6 SKU còn hàng chưa có ảnh bao bì (hoặc ảnh mang tiêu đề hàng khác), cộng 7 SKU hết hàng mà tên chỉ nêu loại hàng
 * (hoặc chỉ nêu "thảo dược"/mã màu). Rỗng thay vì bịa; khối "Thành phần" tự ẩn.
 */
const NO_INGREDIENT_SOURCE = [
  'combo-sach-diu-nhe-po-lang-srm-tt',
  'lau-noi-that-o-to-fuwa3e-300ml',
  'nuoc-rua-chen-fuwa3e-100ml',
  'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l',
  'xit-khu-mui-o-to-fuwa3e-150ml',
  'xit-thom-huong-xuan-fuwa3e-300ml',
  'tay-te-bao-chet-da-dau-thao-duoc-visante-lam-sach-nhe-nhang-150g',
  'nuoc-tay-trang-po-lang-300ml',
  'sua-rua-mat-tao-bot-po-lang-150ml',
  'dau-u-toc-po-lang-50ml',
  'mat-na-ngu-po-lang-30g',
  'son-duong-co-mau-po-lang-a01-a03-a04-a05',
  'gel-rua-chen-cho-may-fuwa3e-2000ml',
];

const BRAND_WORD: [RegExp, string][] = [
  [/pineboo/i, 'pineboo'],
  [/fuwa3e/i, 'fuwa3e'],
  [/sokfarm/i, 'sokfarm'],
  [/bh\.nong/i, 'bh.nong'],
  [/pơ lang/i, 'pơ lang'],
  [/visante/i, 'visante'],
  [/hector/i, 'hector'],
  [/kafedua/i, 'kafedua'],
  [/durica/i, 'durica'],
  [/ahano/i, 'ahano'],
  [/c&sea/i, 'c&sea'],
  [/choco-oke/i, 'choco-oke'],
];
/** Tên sản phẩm không nêu thương hiệu: mô tả chỉ được nói loại hàng, không đoán nhãn. */
const BRANDLESS = [
  'mixed-nuts-granola-tui-tien-loi-hat-dinh-duong-nuong-moc',
  'ca-phe-sau-rieng-tui-20x20g',
  'ca-phe-muoi-tui-50x16g',
  'hop-thiec-banh-mam-hat-rong-bien-225g',
  'hop-thiec-banh-mam-hat-yen-mach-225g',
  'son-duong-gac-tuoi-a07',
];

const raw = (r: { slug: string; name: string }) => ({
  slug: r.slug,
  name: r.name,
  brand: 'Tubu Tree',
  variations: [{ id: 'v1', name: 'Mặc định' }],
  ingredients: null as Ingredient[] | null,
  storyConfig: null,
  description: '',
});

describe('chữ dự phòng cho 111/111 SKU của catalog PROD (ảnh chụp 12/11/2026)', () => {
  it('fixture đầy đủ: 111 dòng, slug không trùng, 64 còn hàng trùng fixture cũ và 47 hết hàng', () => {
    expect(ALL).toHaveLength(111);
    expect(new Set(ALL.map((r) => r.slug)).size).toBe(111);
    expect(ALL.filter((r) => r.inStock).map((r) => r.slug).sort()).toEqual(IN_STOCK.map((r) => r.slug).sort());
    expect(ALL.filter((r) => !r.inStock)).toHaveLength(47);
    // Thiếu ảnh: 13 còn hàng + 12 hết hàng (spec ban đầu ghi "6 SKU" là số cũ của ảnh chụp trước).
    expect(ALL.filter((r) => r.thumbnail === null)).toHaveLength(25);
    expect(ALL.filter((r) => r.thumbnail === null && r.inStock)).toHaveLength(13);
  });

  it('dòng nào cũng có mô tả dự phòng và khớp tuyệt đối theo slug gốc', () => {
    for (const r of ALL) {
      const fb = findProductCopyFallback(r.slug);
      expect(fb, r.slug).toBeDefined();
      expect(fb!.description.trim().length, r.slug).toBeGreaterThan(20);
      expect(findProductCopyFallback(baseSlug(r.slug)), r.slug).toBe(fb);
    }
  });

  it('thành phần có ở mọi dòng, trừ đúng danh sách không có nguồn', () => {
    const empty = ALL.filter((r) => findProductCopyFallback(r.slug)!.ingredients.length === 0).map((r) => baseSlug(r.slug));
    expect(empty.sort()).toEqual([...NO_INGREDIENT_SOURCE].sort());
  });

  it('mô tả nêu đúng thương hiệu và đúng quy cách ghi trong tên SKU', () => {
    const brandless: string[] = [];
    for (const r of ALL) {
      const d = compact(findProductCopyFallback(r.slug)!.description);
      const brand = BRAND_WORD.find(([re]) => re.test(r.name));
      if (!brand) brandless.push(baseSlug(r.slug));
      else expect(d, `${r.slug}: thiếu thương hiệu ${brand[1]}`).toContain(compact(brand[1]));
      for (const size of r.name.match(/\d+(?:,\d+)?\s?(?:ml|l|g|kg)\b/gi) ?? []) expect(d, `${r.slug}: thiếu quy cách ${size}`).toContain(compact(size));
    }
    expect(brandless.sort()).toEqual([...BRANDLESS].sort());
  });

  it('không có tuyên bố y tế, giấy tờ, hữu cơ, xuất xứ, "tự nhiên", con số % hay tre ở mô tả, tên và ghi chú thành phần', () => {
    for (const r of ALL) {
      for (const t of textOf(findProductCopyFallback(r.slug)!)) {
        expect(t, `${r.slug}: "${t}"`).not.toMatch(MEDICAL_CLAIMS);
        expect(t, `${r.slug}: "${t}"`).not.toMatch(PROOF_CLAIMS);
        expect(t, `${r.slug}: "${t}"`).not.toMatch(BAMBOO_CLAIMS);
        expect(t, `${r.slug}: "${t}"`).not.toMatch(NATURAL_CLAIMS);
      }
    }
  });

  it('không chép công dụng, nhãn hay nguồn gốc mà tên SKU hết hàng nêu (cần giấy tờ)', () => {
    const FROM_TITLES = /giảm gãy rụng|gãy rụng|trị gàu|bết dầu|ngăn rụng|sáng da|đẹp da|chống lão hóa|chống lão hoá|tăng cường|sức khỏe|sức khoẻ|đề kháng|thanh lọc|đường huyết|thuần chay|chuẩn gu|chuẩn vị|thiên nhiên|việt nam/i;
    for (const r of ALL.filter((x) => !x.inStock)) {
      for (const t of textOf(findProductCopyFallback(r.slug)!)) expect(t, `${r.slug}: "${t}"`).not.toMatch(FROM_TITLES);
    }
  });

  it('SKU hết hàng chưa đối chiếu bao bì thì không có câu "Bao bì ghi" hay enzyme', () => {
    for (const r of ALL.filter((x) => !x.inStock)) {
      expect(textOf(findProductCopyFallback(r.slug)!).join(' '), r.slug).not.toMatch(/bao bì ghi|enzyme lên men/i);
    }
  });

  it('không dựng con số phần trăm, và mọi dòng thành phần dự phòng mang cờ fromFallback', () => {
    for (const r of ALL) {
      for (const i of findProductCopyFallback(r.slug)!.ingredients) {
        expect(i.percentage, `${r.slug}: ${i.name}`).toBeUndefined();
        expect(i.fromFallback, `${r.slug}: ${i.name}`).toBe(true);
      }
    }
  });
});

describe('chữ dự phòng 111/111 không được thay câu chuyện sản phẩm', () => {
  it('mọi dòng: câu chuyện dựng từ sản phẩm đã bù chữ giống hệt câu chuyện dựng từ sản phẩm thô', () => {
    for (const r of ALL) {
      const p = raw(r);
      const filled = withProductCopyFallback(p);
      expect(filled.description.length, r.slug).toBeGreaterThan(0);
      if (findProductCopyFallback(r.slug)!.ingredients.length > 0) expect(filled.ingredients, r.slug).not.toBeNull();
      expect(resolveStoryConfig(filled), r.slug).toEqual(resolveStoryConfig(p));
    }
  });

  it('không dòng nào lộ ghi chú nguồn của chữ dự phòng hay tiêu đề chung "Tinh tuyển nguyên liệu" vào câu chuyện', () => {
    for (const r of ALL) {
      const text = JSON.stringify(resolveStoryConfig(withProductCopyFallback(raw(r))) ?? '');
      expect(text, r.slug).not.toMatch(/Tinh tuyển|Theo tên sản phẩm|Theo chữ in trên bao bì|An lành cho cả nhà/);
    }
  });
});
