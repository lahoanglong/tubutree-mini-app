// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { resetFlashSales } from '@/lib/use-flash-sales';

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: http.get, post: async () => ({}), delete: async () => ({}) } }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { RecentlyViewedRail } from './recently-viewed-rail';

const STORED = (n: number) => ({ slug: `sp-${n}`, name: `Sản phẩm ${n}`, thumbnail: `https://content.pancake.vn/2-26/stored-${n}.jpg`, viewedAt: 1_700_000_000_000 - n });
const LIVE = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: `https://content.pancake.vn/2-26/live-${n}.jpg`,
  basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true,
});

let mounted: Rendered | null = null;
const mount = async (ui: React.ReactElement, seen: ReturnType<typeof STORED>[]) => {
  localStorage.setItem('tubu_recently_viewed', JSON.stringify(seen));
  mounted = render(ui);
  await flush(8);
  return mounted.container;
};
const imgs = (c: HTMLElement) => Array.from(c.querySelectorAll('img'));

beforeEach(() => {
  resetFlashSales();
  localStorage.clear();
  http.get.mockReset().mockImplementation(async (_path: string, opts?: { query?: { slugs?: string } }) => {
    const slugs = (opts?.query?.slugs ?? '').split(',').filter(Boolean);
    const data = slugs.map((s) => LIVE(Number(s.replace('sp-', ''))));
    return { data, meta: { page: 1, limit: data.length, total: data.length } };
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('RecentlyViewedRail: ảnh ưu tiên', () => {
  const seen = [1, 2, 3, 4].map(STORED);

  it('priorityCount=2: hai ảnh đầu eager + fetchpriority=high, các ảnh sau lazy', async () => {
    const list = imgs(await mount(<RecentlyViewedRail priorityCount={2} />, seen));
    expect(list).toHaveLength(4);
    expect(list.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'eager', 'lazy', 'lazy']);
    expect(list.map((i) => i.getAttribute('fetchpriority'))).toEqual(['high', 'high', null, null]);
  });

  it('mặc định không có ảnh ưu tiên nào', async () => {
    const list = imgs(await mount(<RecentlyViewedRail />, seen));
    expect(list.every((i) => i.getAttribute('loading') === 'lazy' && i.getAttribute('fetchpriority') === null)).toBe(true);
  });
});

describe('RecentlyViewedRail: nguồn ảnh', () => {
  it('có dữ liệu hiện hành: ảnh hiện hành thắng URL lưu ở máy (URL cũ đã khỏi danh sách /img)', async () => {
    const list = imgs(await mount(<RecentlyViewedRail />, [STORED(1)]));
    expect(decodeURIComponent(list[0]!.getAttribute('src')!)).toContain('live-1.jpg');
    expect(decodeURIComponent(list[0]!.getAttribute('src')!)).not.toContain('stored-1.jpg');
  });

  it('chưa có dữ liệu hiện hành (API lỗi): dùng URL lưu ở máy', async () => {
    http.get.mockRejectedValue(new Error('offline'));
    const list = imgs(await mount(<RecentlyViewedRail />, [STORED(1)]));
    expect(decodeURIComponent(list[0]!.getAttribute('src')!)).toContain('stored-1.jpg');
  });
});

describe('RecentlyViewedRail: dọn mục API không trả lại', () => {
  it('API trả về thiếu món (đã ẩn): kho chỉ còn món còn sống; trả rỗng hết thì xoá khoá để script <head> không giữ chỗ lần sau', async () => {
    http.get.mockImplementation(async (_p: string, opts?: { query?: { slugs?: string } }) => {
      const slugs = (opts?.query?.slugs ?? '').split(',').filter(Boolean).filter((s) => s !== 'sp-2');
      return { data: slugs.map((s) => LIVE(Number(s.replace('sp-', '')))), meta: { page: 1, limit: slugs.length, total: slugs.length } };
    });
    await mount(<RecentlyViewedRail />, [1, 2, 3].map(STORED));
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!).map((i: { slug: string }) => i.slug)).toEqual(['sp-1', 'sp-3']);
    mounted?.unmount();
    localStorage.clear();
    http.get.mockResolvedValue({ data: [], meta: { page: 1, limit: 0, total: 0 } });
    const c = await mount(<RecentlyViewedRail />, [1, 2].map(STORED));
    expect(localStorage.getItem('tubu_recently_viewed')).toBeNull();
    expect(c.querySelector('#browse-recent')).toBeNull();
  });

  it('API lỗi: không dọn (mất mạng không được xoá lịch sử xem)', async () => {
    http.get.mockRejectedValue(new Error('offline'));
    await mount(<RecentlyViewedRail />, [1, 2].map(STORED));
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toHaveLength(2);
  });
});
