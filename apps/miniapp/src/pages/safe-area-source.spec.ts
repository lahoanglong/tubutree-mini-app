import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `Page` của zmp-ui bị mock ở các spec trang nên style của nó không đo được: khoá bằng nguồn.
const src = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

describe('vùng an toàn của trang gốc', () => {
  it('Ưu đãi không dùng class "page": PageHeader đã cộng safe-top, thêm .page là cộng đôi', () => {
    expect(src('offers.tsx')).not.toMatch(/<Page[^>]*className="page"/);
  });

  it('Trang chủ và Danh mục chừa safe-bottom dưới thanh dưới (60px + vùng an toàn)', () => {
    expect(src('home.tsx')).toContain("paddingBottom: 'calc(72px + var(--safe-bottom))'");
    expect(src('browse.tsx')).toContain("paddingBottom: 'calc(72px + var(--safe-bottom))'");
  });
});
