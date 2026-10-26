import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Q-19 (C-096): cổng /merchant trùng gian hàng trên miniapp và chỉ xem, nên web khách không được quảng bá nó.
// Đối tác vẫn vào được bằng URL trực tiếp: trang giữ nguyên, nhưng không có lối dẫn từ web khách, không vào
// sitemap, bị chặn ở robots.txt và có thẻ noindex.
vi.mock('@/lib/api', () => ({
  getProducts: vi.fn().mockResolvedValue([{ slug: 'sp-1' }]),
  getStorefrontList: vi.fn().mockResolvedValue([{ slug: 'cua-hang-1', updatedAt: '2026-10-01T00:00:00.000Z' }]),
}));

import robots from './app/robots';
import sitemap from './app/sitemap';
import { metadata as merchantMetadata } from './app/merchant/layout';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Khu vực sở hữu hợp lệ của /merchant: chính cổng, khu quản trị (duyệt SP đối tác gọi API /admin/merchant-*), client API
// gọi endpoint /merchant/* của backend, và cấu hình đường dẫn riêng tư (site.ts, robots.ts) vốn phải nêu tên /merchant.
const OWNERS = [
  'app/merchant/',
  'app/admin/',
  'components/admin/',
  'lib/merchant-client.ts',
  // Hub đại lý đã duyệt (không phải web khách): thẻ "Gian hàng đối tác" dẫn đối tác sang cổng quản lý (B-41).
  'components/dealer/dealer-hub.tsx',
  'lib/admin-',
  'lib/site.ts',
  'app/robots.ts',
  'test-utils/',
];

const guestSources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
  .filter((s) => !OWNERS.some((o) => s.file.startsWith(o)));

const offenders = (re: RegExp) => guestSources.filter((s) => re.test(s.text)).map((s) => s.file);

describe('web khách không dẫn vào /merchant (C-096, Q-19)', () => {
  it('quét được mã nguồn khách (header, footer, trang chủ, tài khoản, đăng nhập, 404)', () => {
    const files = guestSources.map((s) => s.file);
    for (const f of ['components/site-header.tsx', 'components/site-footer.tsx', 'app/page.tsx', 'app/not-found.tsx', 'app/tai-khoan/page.tsx', 'app/dang-nhap/page.tsx', 'app/sitemap.ts']) {
      expect(files, f).toContain(f);
    }
  });

  it('không có chuỗi đường dẫn "/merchant" (href, router.push, redirect, template) ngoài khu của đối tác', () => {
    expect(offenders(/['"`]\/merchant(?![\w-])/)).toEqual([]);
  });

  it('không có chữ mời "Kênh Đối Tác" / "Cổng đối tác" cho khách', () => {
    expect(offenders(/Kênh Đối Tác|Cổng đối tác/iu)).toEqual([]);
  });

  it('sitemap không liệt kê /merchant (cũng không /admin)', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.length).toBeGreaterThan(2);
    expect(urls.filter((u) => /\/(merchant|admin)(\/|$)/.test(u))).toEqual([]);
  });

  it('robots.txt chặn cả /merchant lẫn cây con /merchant/', () => {
    const rule = [robots().rules].flat()[0]!;
    expect(rule.disallow).toEqual(expect.arrayContaining(['/merchant', '/merchant/']));
  });

  it('trang /merchant giữ thẻ noindex, nofollow (URL đã biết cũng không vào kết quả tìm kiếm)', () => {
    expect(merchantMetadata.robots).toEqual({ index: false, follow: false });
  });
});
