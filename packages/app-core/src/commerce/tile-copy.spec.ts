import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHOP_COPY } from '../shop-copy';
import { TILE_COPY, fillTileCopy } from './tile-copy';

describe('TILE_COPY', () => {
  it('mọi khoá có trong SHOP_COPY với cùng chữ (một nguồn, không lệch)', () => {
    for (const [key, text] of Object.entries(TILE_COPY)) expect(SHOP_COPY[key], key).toBe(text);
  });

  it('điền biến và ném lỗi khi thiếu biến', () => {
    expect(fillTileCopy('badge.discount', { pct: 25 })).toBe('-25%');
    expect(() => fillTileCopy('badge.discount')).toThrow(/pct/);
  });

  // Gói đầu Mini App có trần 700 KB: import shop-copy kéo cả bảng ~140 khoá (+7 KB) vào đường nạp đầu.
  it.each(['product-card-view.ts', 'card-meta.ts'])('%s không import shop-copy', (file) => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]\.\.\/shop-copy['"]/);
  });
});
