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
    expect(hits(/flash-solid-bg|flash-solid-fg/, ['components/mini/badge.tsx', 'components/mini/button.tsx', 'components/mini/progress-bar.tsx', 'components/mini/tiles.tsx'])).toEqual([]);
  });

  it('chỉ product-tile vẽ vỏ thẻ sản phẩm (data-ds="product-tile")', () => {
    expect(hits(/data-ds=["']product-tile["']/, ['components/mini/product-tile.tsx'])).toEqual([]);
  });
});
