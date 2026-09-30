import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dự án 4a: file mới/viết lại không được dùng biến CSS v1 (`--neutral-*`, `--primary-*`, `--leaf-*`)
 * — khối alias legacy trong css/tokens.css chỉ còn để đỡ ~35 trang CHƯA migrate (spec §11).
 * Plan sau (4b/4c/4d) thêm file của mình vào danh sách.
 */
const FILES_4A = [
  'src/components/nav-config.ts',
  'src/components/bottom-nav.tsx',
  'src/components/back-button.tsx',
  'src/components/cart-button.tsx',
  'src/components/ui/cart-badge.tsx',
  'src/components/ui/segmented-tabs.tsx',
  'src/components/ui/product-tile.tsx',
  'src/components/reorder/reorder-sheet.tsx',
  'src/components/reorder/purchased-rail.tsx',
  'src/components/orders/order-card.tsx',
  'src/components/subscriptions-panel.tsx',
  'src/components/checkout/order-success.tsx',
  'src/pages/orders.tsx',
];
const LEGACY = /var\(--(neutral|primary|leaf)-/;

describe('4a — không dùng biến CSS cũ', () => {
  it.each(FILES_4A)('%s', (file) => {
    const lines = readFileSync(join(process.cwd(), file), 'utf8').split('\n');
    const hits = lines.map((l, i) => `${i + 1}: ${l.trim()}`).filter((l) => LEGACY.test(l));
    expect(hits).toEqual([]);
  });
});
