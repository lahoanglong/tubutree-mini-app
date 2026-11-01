import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bộ chặn "thẻ sản phẩm tự chế" của gói P4 (bản web của `apps/miniapp/src/components/ds-shop-guard.spec.ts`): mọi thẻ vẽ bằng
 * `ProductCard`/`ProductTile`, giá gạch chỉ do `PriceTag` vẽ ở thẻ, nhãn Giờ vàng là tông của `Badge` (không ghi đè màu tại chỗ).
 * Quét nguồn (bỏ spec), nên thêm một thẻ vẽ tay là đỏ ngay.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(spec|test)\.|\.d\.ts$/.test(name) ? [path] : [];
  });
}

const FILES = sources(SRC).map((path) => ({ rel: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const hits = (re: RegExp, allow: readonly string[] = []) => FILES.filter((f) => re.test(f.text) && !allow.includes(f.rel)).map((f) => f.rel);

/**
 * Lề âm tay (gói F3): ở home, catalog, shop-page, mini mọi khối tràn mép dùng `.tubu-bleed`/`.tubu-bleed-rail` (mini.css, file định nghĩa lớp
 * nên không bị quét: chỉ quét .ts/.tsx). `-mx-N` của Tailwind hay `margin: '0 -16px'` viết tay từng file đã làm mỗi nơi một số đo và một mốc md.
 */
const BLEED_SCOPE = /^components\/(home|catalog|shop-page|mini)\//;
const NEG_TAILWIND = /(?<![\w-])-m[xlrse]-(?:\d|px\b|\[)/;
const NEG_LONGHAND = /margin(?:Inline(?:Start|End)?|Left|Right):\s*-(?!0\b)|margin-(?:inline(?:-start|-end)?|left|right):\s*-(?!0\b)/;
const SHORTHAND = /margin:\s*(['"])([^'"]*)\1/g;
/** Giá trị lề ngang của shorthand `margin`: 1 giá trị cho cả bốn phía; 2 và 3 giá trị thì ngang là giá trị thứ hai; 4 giá trị thì phải (2) và trái (4). */
function negativeHorizontalShorthand(text: string): boolean {
  return [...text.matchAll(SHORTHAND)].some((m) => {
    const v = (m[2] ?? '').trim().split(/\s+/);
    const horizontal = v.length === 1 ? [v[0]] : v.length === 4 ? [v[1], v[3]] : [v[1]];
    return horizontal.some((x) => /^-(?!0(?:px|rem|em|%)?$)/.test(x ?? ''));
  });
}
const hasHandBleed = (text: string) => NEG_TAILWIND.test(text) || NEG_LONGHAND.test(text) || negativeHorizontalShorthand(text);
export function bleedViolations(files: readonly { rel: string; text: string }[]): string[] {
  return files.filter((f) => BLEED_SCOPE.test(f.rel) && hasHandBleed(f.text)).map((f) => f.rel);
}

describe('ds-shop-guard (web)', () => {
  it('quét được nguồn (không để các ca dưới đúng vì thư mục rỗng)', () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.rel === 'components/mini/price-tag.tsx')).toBe(true);
  });

  it('không còn thẻ cũ: CatalogTile, RelatedTile, components/product-card, ProductLink, NewProductBadge', () => {
    expect(hits(/\bCatalogTile\b|\bRelatedTile\b|\bProductTileProduct\b|\bCardSaleBadge\b|\bProductPriceRow\b/)).toEqual([]);
    expect(hits(/from ['"]@\/components\/product-card['"]|from ['"]@\/components\/product-link['"]|from ['"]@\/components\/new-product-badge['"]/)).toEqual([]);
  });

  it('gạch giá (line-through) ở thẻ chỉ do PriceTag vẽ; ngoại lệ có sẵn là dòng giá ngoài thẻ sản phẩm', () => {
    const NOT_A_CARD = [
      'components/mini/price-tag.tsx',
      'components/flash-price.tsx', // khối giá lớn của trang chi tiết (PdpPrice)
      'components/add-to-cart.tsx', // giá theo phân loại ở thanh mua
      'components/variation-sheet.tsx', // giá từng phân loại trong bảng chọn
      'app/gio-hang/page.tsx', // dòng giỏ hàng
      'app/merchant/settlement-tab.tsx',
      'components/dealer/price-tab.tsx', // bảng giá đại lý
      'components/admin/merchant-products-tab.tsx',
      'components/admin/merchant-fulfilment-tab.tsx',
      'components/admin/dealer-price-history-tab.tsx',
      'components/admin/support-chat/conversation-detail.tsx',
    ];
    expect(hits(/line-through/, NOT_A_CARD)).toEqual([]);
  });

  it('Badge không ghi đè nền: tông flash/verified có sẵn thay cho style background/color tại chỗ', () => {
    expect(hits(/<Badge\b[^>]*style=\{\{[^}]*\b(background|color)\s*:/)).toEqual([]);
    expect(hits(/flash-solid-bg|flash-solid-fg/, ['components/mini/badge.tsx', 'components/mini/button.tsx', 'components/mini/progress-bar.tsx', 'components/mini/tiles.tsx', 'components/mini/flash-sold-bar.tsx', 'components/mini/section-header.tsx'])).toEqual([]);
  });

  it('chỉ product-tile vẽ vỏ thẻ sản phẩm (data-ds="product-tile")', () => {
    expect(hits(/data-ds=["']product-tile["']/, ['components/mini/product-tile.tsx'])).toEqual([]);
  });

  it('không lề âm tay ở home, catalog, shop-page, mini: dùng .tubu-bleed', () => {
    expect(bleedViolations(FILES)).toEqual([]);
  });

  it('bleedViolations bắt lề âm tay (fixture cố ý vi phạm) và bỏ qua chỗ hợp lệ', () => {
    const bad = [
      { rel: 'components/home/x.tsx', text: '<div className="max-md:-mx-4 px-4" />' },
      { rel: 'components/mini/y.tsx', text: "<div style={{ margin: '0 -16px' }} />" },
      { rel: 'components/catalog/z.tsx', text: "const C = '-mx-4 md:-mx-3';" },
      { rel: 'components/shop-page/w.tsx', text: '<div style={{ marginLeft: -8 }} />' },
      { rel: 'components/home/ml.tsx', text: '<div className="-ml-4" />' },
      { rel: 'components/home/mr.tsx', text: '<div className="max-md:-mr-4" />' },
      { rel: 'components/home/ms.tsx', text: '<div className="-ms-4" />' },
      { rel: 'components/home/me.tsx', text: '<div className="md:-me-[10px]" />' },
      { rel: 'components/mini/sh.tsx', text: "<div style={{ margin: '8px -16px' }} />" },
      { rel: 'components/mini/sh4.tsx', text: "<div style={{ margin: '0 0 0 -16px' }} />" },
      { rel: 'components/mini/mi.tsx', text: '<div style={{ marginInline: -16 }} />' },
      { rel: 'components/mini/mis.tsx', text: '<div style={{ marginInlineStart: -16 }} />' },
      { rel: 'components/mini/mie.tsx', text: '<div style={{ marginInlineEnd: -16 }} />' },
      { rel: 'components/mini/mr.tsx', text: '<div style={{ marginRight: -16 }} />' },
    ];
    expect(bleedViolations(bad)).toEqual(bad.map((f) => f.rel));
    const ok = [
      { rel: 'components/home/a.tsx', text: '<div className="tubu-bleed px-4" />' },
      { rel: 'components/loyalty/mini-surface.tsx', text: "export const miniBleed = 'max-md:-mx-4';" }, // ngoài phạm vi
      { rel: 'components/mini/b.tsx', text: '<div className="mx-auto -mt-2" />' }, // lề âm dọc không thuộc luật này
      { rel: 'components/mini/c.tsx', text: '<div className="-my-2 -mt-1 -mb-1" />' },
      { rel: 'components/mini/d.tsx', text: "<div style={{ margin: '-4px 0' }} />" },
      { rel: 'components/mini/e.tsx', text: "<div style={{ margin: '-4px 0 -4px', marginTop: -2 }} />" },
      { rel: 'components/mini/f.tsx', text: '<div className="-ms-overflow-style" />' }, // không phải lớp Tailwind
    ];
    expect(bleedViolations(ok)).toEqual([]);
  });
});
