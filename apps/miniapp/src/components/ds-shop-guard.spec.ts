import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bộ chặn "thẻ sản phẩm tự chế" của gói P4: mọi thẻ vẽ bằng `ProductCard`/`ProductTile`, giá gạch chỉ do `PriceTag` vẽ, nhãn Giờ vàng và
 * đã duyệt là tông của `Badge` (không ghi đè màu tại chỗ). Quét nguồn (bỏ spec), nên thêm một thẻ vẽ tay là đỏ ngay.
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
 * Lề âm tay (gói F3): kệ tràn mép dùng `.tubu-bleed` (css/tokens.css), không `margin: '0 -16px'` viết tay từng file. Chỉ bắt lề ngang kiểu `'0 -Npx'`:
 * các lề âm nhỏ làm rộng vùng chạm (`'-12px -6px'`) là kỹ thuật khác.
 */
export function bleedHits(files: readonly { rel: string; text: string }[]): string[] {
  return files.filter((f) => /margin:\s*['"]0 -/.test(f.text)).map((f) => f.rel);
}

describe('ds-shop-guard (Mini App)', () => {
  it('không còn thẻ cũ: CatalogTile, RelatedTile, ProductTileProduct, priceOverride, components/product-card', () => {
    expect(hits(/\bCatalogTile\b|\bRelatedTile\b|\bProductTileProduct\b|\bpriceOverride\b/)).toEqual([]);
    expect(hits(/from ['"](\.\.?\/)+(components\/)?product-card['"]/, ['components/ui/product-grid.tsx', 'components/ui/product-rail.tsx'])).toEqual([]);
  });

  it('gạch giá (line-through) chỉ ở PriceTag; ngoại lệ có sẵn là dòng giá ngoài thẻ sản phẩm', () => {
    const NOT_A_CARD = [
      'components/ui/price-tag.tsx',
      'components/variation-sheet.tsx', // giá từng phân loại trong bảng chọn
      'pages/product-detail.tsx', // khối giá lớn của trang chi tiết
      'pages/cart.tsx', // dòng giỏ hàng
      'pages/dealer.tsx', // bảng giá đại lý
      'pages/external-points.tsx', // số điểm cũ bị gạch
    ];
    expect(hits(/line-through/, NOT_A_CARD)).toEqual([]);
  });

  it('Badge không ghi đè nền: tông flash/verified có sẵn thay cho style background/color tại chỗ', () => {
    const BADGE_STYLE = /<Badge\b[^>]*style=\{\{[^}]*\b(background|color)\s*:/;
    const DYNAMIC = [
      'pages/loyalty.tsx', // màu hạng thành viên đến từ dữ liệu
      'components/checkout/voucher-sheet.tsx', // nhãn mã giảm giá tông promo đặc; VoucherTicket (P5) thay
    ];
    expect(hits(BADGE_STYLE, DYNAMIC)).toEqual([]);
    expect(hits(/flash-solid-bg|flash-solid-fg/, ['components/ui/badge.tsx', 'components/ui/button.tsx', 'components/ui/progress-bar.tsx', 'components/ui/tiles.tsx', 'components/ui/flash-sold-bar.tsx', 'components/ui/section-header.tsx'])).toEqual([]);
  });

  it('chỉ product-tile vẽ vỏ thẻ sản phẩm (data-ds="product-tile")', () => {
    expect(hits(/data-ds=["']product-tile["']/, ['components/ui/product-tile.tsx'])).toEqual([]);
  });

  it('không lề âm tay margin: 0 -Npx: dùng .tubu-bleed', () => {
    expect(bleedHits(FILES)).toEqual([]);
  });

  it('bleedHits bắt lề âm tay (fixture cố ý vi phạm) và bỏ qua lề âm vùng chạm', () => {
    expect(bleedHits([{ rel: 'components/ui/x.tsx', text: "<div style={{ margin: '0 -16px' }} />" }])).toEqual(['components/ui/x.tsx']);
    expect(bleedHits([{ rel: 'pages/y.tsx', text: "style={{ minHeight: 44, margin: '-12px -6px' }}" }, { rel: 'pages/z.tsx', text: '<div className="tubu-bleed" />' }])).toEqual([]);
  });
});
