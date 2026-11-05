// @vitest-environment jsdom
import { PRODUCT_SLUGS_QUERY_MAX_CHARS } from '@tubutree/shared-types';
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

  it('sau khi dọn: không gọi API thừa theo khoá mới, ảnh không lùi về URL lưu ở máy, giá không biến mất', async () => {
    http.get.mockImplementation(async (_p: string, opts?: { query?: { slugs?: string } }) => {
      const slugs = (opts?.query?.slugs ?? '').split(',').filter(Boolean).filter((s) => s !== 'sp-2');
      return { data: slugs.map((s) => LIVE(Number(s.replace('sp-', '')))), meta: { page: 1, limit: slugs.length, total: slugs.length } };
    });
    localStorage.setItem('tubu_recently_viewed', JSON.stringify([1, 2, 3].map(STORED)));
    mounted = render(<RecentlyViewedRail />);
    const container = mounted.container;
    // Từ lúc ảnh hiện hành xuất hiện lần đầu, ghi lại mọi trạng thái: không được có ảnh lưu ở máy hay thẻ mất giá.
    const bad: string[] = [];
    let live = false;
    const look = () => {
      const srcs = Array.from(container.querySelectorAll('img')).map((i) => decodeURIComponent(i.getAttribute('src') ?? ''));
      if (srcs.some((u) => u.includes('live-'))) live = true;
      if (!live) return;
      if (srcs.some((u) => u.includes('stored-'))) bad.push(`ảnh lưu: ${srcs.join('|')}`);
      if (container.querySelectorAll('[data-ds="product-tile"]').length && !container.textContent!.includes('50.000')) bad.push('mất giá');
    };
    new MutationObserver(look).observe(container, { childList: true, subtree: true, attributes: true });
    await flush(10);
    look();
    expect(live).toBe(true);
    expect(bad).toEqual([]);
    expect(http.get.mock.calls.filter(([p]) => p === '/products')).toHaveLength(1);
  });

  it('API lỗi: không dọn (mất mạng không được xoá lịch sử xem)', async () => {
    http.get.mockRejectedValue(new Error('offline'));
    await mount(<RecentlyViewedRail />, [1, 2].map(STORED));
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toHaveLength(2);
  });
});

describe('RecentlyViewedRail: trần độ dài slugs của API (20 slug × 240 ký tự vừa trần)', () => {
  const LONG = (i: number) => `${'x'.repeat(116)}-${String(i).padStart(3, '0')}`;
  const seen = Array.from({ length: 20 }, (_, i) => ({ slug: LONG(i), name: `SP ${i}`, thumbnail: `https://content.pancake.vn/2-26/stored-${i}.jpg`, viewedAt: 1_700_000_000_000 - i }));

  it('20 slug dài 120 ký tự: hỏi đủ cả 20 trong một chuỗi dưới trần của API (không HTTP 400), món bị ẩn thì bị dọn, các món còn lại nguyên', async () => {
    http.get.mockImplementation(async (_p: string, opts?: { query?: { slugs?: string } }) => {
      const asked = (opts?.query?.slugs ?? '').split(',').filter(Boolean);
      // Món mới nhất bị ẩn: bị dọn; mọi món khác đều được hỏi và còn nguyên.
      const data = asked.filter((s) => s !== LONG(0)).map((slug) => ({ ...LIVE(1), id: slug, slug, name: slug }));
      return { data, meta: { page: 1, limit: data.length, total: data.length } };
    });
    await mount(<RecentlyViewedRail />, seen);
    const sent = http.get.mock.calls.filter(([p]) => p === '/products').map(([, o]) => (o as { query: { slugs: string } }).query.slugs);
    expect(sent.length).toBeGreaterThan(0);
    for (const q of sent) expect(q.length).toBeLessThanOrEqual(PRODUCT_SLUGS_QUERY_MAX_CHARS);
    expect(sent[0]?.split(',')).toHaveLength(20);
    const left = JSON.parse(localStorage.getItem('tubu_recently_viewed')!).map((i: { slug: string }) => i.slug);
    expect(left).toEqual(seen.slice(1).map((i) => i.slug));
  });

  it('10 món slug 210 ký tự: đều vừa trần, hỏi đủ 10 và vẽ đủ 10 thẻ có giá, kho còn nguyên', async () => {
    const wide = (i: number) => `${'y'.repeat(206)}-${String(i).padStart(3, '0')}`;
    const stored10 = Array.from({ length: 10 }, (_, i) => ({ slug: wide(i), name: `SP ${i}`, thumbnail: `https://content.pancake.vn/2-26/stored-${i}.jpg`, viewedAt: 1_700_000_000_000 - i }));
    http.get.mockImplementation(async (_p: string, opts?: { query?: { slugs?: string } }) => {
      const data = (opts?.query?.slugs ?? '').split(',').filter(Boolean).map((slug) => ({ ...LIVE(1), id: slug, slug, name: slug }));
      return { data, meta: { page: 1, limit: data.length, total: data.length } };
    });
    const c = await mount(<RecentlyViewedRail />, stored10);
    const cards = c.querySelectorAll('[data-ds="product-tile"]');
    expect(cards).toHaveLength(10);
    for (const card of Array.from(cards)) expect(card.textContent).toContain('50.000');
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toHaveLength(10);
  });

  it('10 món slug 210 ký tự, API chưa trả lời: vẽ đủ 10 món đã hỏi', async () => {
    const wide = (i: number) => `${'y'.repeat(206)}-${String(i).padStart(3, '0')}`;
    const stored10 = Array.from({ length: 10 }, (_, i) => ({ slug: wide(i), name: `SP ${i}`, thumbnail: `https://content.pancake.vn/2-26/stored-${i}.jpg`, viewedAt: 1_700_000_000_000 - i }));
    http.get.mockImplementation(() => new Promise(() => undefined));
    const c = await mount(<RecentlyViewedRail />, stored10);
    expect(c.querySelectorAll('[data-ds="product-tile"]')).toHaveLength(10);
  });
});
