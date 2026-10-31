import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PurchasedRail giữ sheet ngoài gói đầu (ngân sách entry 700 KB, thiết kế Q19)', () => {
  const src = readFileSync(resolve(__dirname, 'purchased-rail.tsx'), 'utf8');
  it('không import tĩnh ReorderSheet và SubscribeSheet; nạp bằng import() động', () => {
    expect(src).not.toMatch(/^import .*from '\.\/reorder-sheet'/m);
    expect(src).not.toMatch(/^import .*from '\.\.\/subscribe-sheet'/m);
    expect(src).toMatch(/import\('\.\/reorder-sheet'\)/);
    expect(src).toMatch(/import\('\.\.\/subscribe-sheet'\)/);
  });
});
