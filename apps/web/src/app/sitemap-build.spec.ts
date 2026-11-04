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

  it('runtime (không phải build): lỗi API vẫn nổi lên, không nuốt', async () => {
    vi.stubEnv('NEXT_PHASE', '');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(sitemap()).rejects.toThrow();
  });
});
