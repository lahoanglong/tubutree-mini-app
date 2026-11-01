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
 * Lề âm tay (gói F3): kệ tràn mép dùng `.tubu-bleed` (css/tokens.css), không lề âm ngang viết tay từng file: Tailwind `-m[xlrse]-N`,
 * longhand `marginInline*`/`marginLeft`/`marginRight` âm, hay shorthand `margin` có giá trị ngang âm. Lề âm dọc (`-my-`, `'-4px 0'`) không bị bắt.
 */
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

/**
 * Chỗ dùng lề âm ngang có chủ đích có từ trước: nới vùng chạm của nút chữ (`'-12px -6px'`) và đẩy nhẹ một nút; không phải tràn mép trang.
 * Miễn đúng đoạn mã, không miễn cả file: lề âm tràn mép mới thêm vào các file này vẫn bị bắt.
 */
const TOUCH_AREA: Readonly<Record<string, readonly string[]>> = {
  'components/offers/offers-points-strip.tsx': ["margin: '-14px -6px'"],
  'pages/profile.tsx': ["margin: '-12px -6px'"],
  'pages/bank-payment.tsx': ["margin: '-6px -10px -6px 0'"],
  'pages/addresses.tsx': ['marginLeft: -8'],
};
export function bleedHits(
  files: readonly { rel: string; text: string }[],
  allow: Readonly<Record<string, readonly string[]>> = TOUCH_AREA,
): string[] {
  return files
    .filter((f) => hasHandBleed((allow[f.rel] ?? []).reduce((text, snippet) => text.split(snippet).join(''), f.text)))
    .map((f) => f.rel);
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

  it('không lề âm ngang viết tay: dùng .tubu-bleed', () => {
    expect(bleedHits(FILES)).toEqual([]);
  });

  it('bleedHits bắt từng dạng lề âm ngang tay (fixture cố ý vi phạm)', () => {
    const bad = [
      "<div style={{ margin: '0 -16px' }} />",
      "<div style={{ margin: '8px -16px' }} />",
      "<div style={{ margin: '0 0 0 -16px' }} />",
      '<div className="-mx-4" />',
      '<div className="-ml-4" />',
      '<div className="max-md:-mr-4" />',
      '<div className="-ms-4" />',
      '<div className="md:-me-[10px]" />',
      '<div style={{ marginInline: -16 }} />',
      '<div style={{ marginInlineStart: -16 }} />',
      '<div style={{ marginInlineEnd: -16 }} />',
      '<div style={{ marginLeft: -8 }} />',
      '<div style={{ marginRight: -8 }} />',
    ];
    for (const text of bad) expect(bleedHits([{ rel: 'components/ui/x.tsx', text }]), text).toEqual(['components/ui/x.tsx']);
  });

  it('bleedHits bỏ qua lề âm dọc, .tubu-bleed và chỗ nới vùng chạm đã khai', () => {
    const ok = [
      '<div className="-my-2 -mt-1 -mb-1" />',
      "<div style={{ margin: '-4px 0' }} />",
      "<div style={{ margin: '-4px 0 -4px', marginTop: -2 }} />",
      '<div className="tubu-bleed" />',
      '<div className="-ms-overflow-style" />',
    ];
    for (const text of ok) expect(bleedHits([{ rel: 'pages/y.tsx', text }]), text).toEqual([]);
    expect(bleedHits([{ rel: 'pages/profile.tsx', text: "style={{ minHeight: 44, margin: '-12px -6px' }}" }])).toEqual([]);
    expect(bleedHits([{ rel: 'pages/new.tsx', text: "style={{ minHeight: 44, margin: '-12px -6px' }}" }])).toEqual(['pages/new.tsx']);
    expect(bleedHits([{ rel: 'pages/profile.tsx', text: "margin: '-12px -6px' }} /><div style={{ margin: '0 -16px' }} />" }])).toEqual(['pages/profile.tsx']);
  });
});
