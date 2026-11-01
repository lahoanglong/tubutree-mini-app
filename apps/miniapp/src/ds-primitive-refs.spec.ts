import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DS-08: bậc primitive của tokens.css (lớp 1) chỉ dùng trong tokens.css; thành phần dùng token ngữ nghĩa.
 * Danh sách dưới là các file mua sắm đã chuyển (gói P1); file khác còn primitive thì thêm vào đây khi chuyển.
 * `components/loyalty/coupon-card.tsx` chưa nằm trong danh sách: gói commerce-core sở hữu và sẽ chuyển.
 */
const MIGRATED = [
  'components/ui/chip.tsx',
  'components/ui/product-tile.tsx',
  'components/ui/progress-bar.tsx',
  'components/flash-sale.tsx',
  'components/catalog/recently-viewed-rail.tsx',
  'components/storefront-preview.tsx',
  'pages/product-detail.tsx',
  'pages/storefront-builder.tsx',
  'components/waste-item-thumb.tsx',
];

const PRIMITIVE = /var\(--(?:stone|forest|sage|clay|honey|terracotta|orange|tubu-orange)(?:-\d+)?\)/g;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const primitives = (src: string) => stripComments(src).match(PRIMITIVE) ?? [];

describe('file mua sắm đã chuyển không còn tham chiếu primitive màu (DS-08)', () => {
  it('bắt được var(--stone-100) và var(--clay-700) nhưng không bắt token ngữ nghĩa', () => {
    expect(primitives("background: 'var(--stone-100)'; color: var(--clay-700)")).toEqual(['var(--stone-100)', 'var(--clay-700)']);
    expect(primitives("background: 'var(--color-bg-media)'")).toEqual([]);
  });

  it.each(MIGRATED)('%s', (file) => {
    expect(primitives(readFileSync(join(__dirname, file), 'utf8'))).toEqual([]);
  });
});
