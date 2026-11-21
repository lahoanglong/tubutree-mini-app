import { afterEach, describe, expect, it, vi } from 'vitest';

// Dùng lib/api thật (không mock): `next build` chạy khi API chưa lên, sitemap không được làm hỏng bản build.
vi.mock('@/lib/route-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/route-map')>()),
  publicStaticRoutes: () => ['/'],
}));

import sitemap from './sitemap';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sitemap lúc build với API không chạm tới được', () => {
  it('NEXT_PHASE=phase-production-build: trả sitemap rút gọn thay vì ném ApiUnavailableError', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const out = await sitemap();
    expect(out.map((e) => e.url)).toEqual(['https://app.tubutree.com/']);
  });

  it('NEXT_PHASE=phase-production-build, API trả 503 cho mọi lời gọi (kể cả /campaigns/public-slugs): build không hỏng', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const out = await sitemap();
    expect(out.map((e) => e.url)).toEqual(['https://app.tubutree.com/']);
  });

  it('runtime: API cũ chưa có /campaigns/public-slugs (404) còn mọi danh sách khác rỗng: sitemap vẫn dựng, không có URL chiến dịch', async () => {
    vi.stubEnv('NEXT_PHASE', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/campaigns/public-slugs')) return new Response('{"message":"Chương trình không còn hoặc chưa mở."}', { status: 404 });
        if (String(url).includes('/legal/')) return new Response(JSON.stringify({ content: null, vars: {} }), { status: 200 });
        if (String(url).includes('/products?')) return new Response(JSON.stringify({ data: [], meta: { page: 1, limit: 100, total: 0 } }), { status: 200 });
        return new Response('[]', { status: 200 });
      }),
    );
    const out = await sitemap();
    expect(out.filter((e) => e.url.includes('/chien-dich/'))).toEqual([]);
    expect(out[0]!.url).toBe('https://app.tubutree.com/');
  });

  it('runtime (không phải build): lỗi API vẫn nổi lên, không nuốt', async () => {
    vi.stubEnv('NEXT_PHASE', '');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(sitemap()).rejects.toThrow();
  });
});
