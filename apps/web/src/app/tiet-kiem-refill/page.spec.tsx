// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Trang server của /tiet-kiem-refill: tải sẵn cặp chai ↔ gói Refill để crawler thấy giá, khai CollectionPage + ItemList (gói Refill thật) + FAQPage từ cùng
// mảng câu hỏi hiển thị, noindex khi không có thẻ nào bán được. API lỗi lúc chạy thì ném (Next giữ bản cũ); lúc next build thì dựng rỗng.

const mocks = vi.hoisted(() => ({ get: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('./refill-landing-view', () => ({
  default: (props: unknown) => {
    mocks.view(props);
    return <div data-testid="refill-landing-view" />;
  },
}));

import { SITE_URL } from '@/lib/site';
import RefillLandingPage, { generateMetadata, revalidate } from './page';

const offer = (id: string, price: number, inStock = true) => ({
  productId: `p-${id}`, slug: `refill-${id}`, name: `Túi Refill ${id} 2L`, thumbnail: null, variationId: `v-${id}`, price, compareAt: null, sizeLabel: '2L', inStock, tubu: true,
});
const bottle = (id: string) => ({ productId: `b-${id}`, slug: `chai-${id}`, name: `Chai ${id} 500ml`, thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true });
const LANDING = {
  enabled: true,
  pairs: [
    { bottle: bottle('a'), refill: offer('a', 200_000), savingPct: 26 },
    { bottle: bottle('b'), refill: offer('a', 200_000), savingPct: 26 },
    { bottle: bottle('c'), refill: offer('c', 230_000), savingPct: 15 },
    { bottle: bottle('d'), refill: offer('d', 230_000, false), savingPct: 15 },
  ],
};

let body: unknown = LANDING;
beforeEach(() => {
  body = LANDING;
  mocks.view.mockReset();
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/catalog/refill-pairs/landing') {
      if (body instanceof Error) throw body;
      return body;
    }
    if (path === '/config/public') return {};
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

const ldBlocks = (html: string): Record<string, unknown>[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));

describe('metadata', () => {
  it('có thẻ bán được: lập chỉ mục, canonical /tiet-kiem-refill, og/twitter, mô tả không ghi số; ISR 5 phút', async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe('Tiết kiệm với Refill');
    expect(meta.alternates?.canonical).toBe('/tiet-kiem-refill');
    expect(meta.robots).toBeUndefined();
    expect(meta.openGraph).toMatchObject({ url: '/tiet-kiem-refill', title: 'Tiết kiệm với Refill — Tubu Tree' });
    expect(String(meta.description)).not.toMatch(/\d/);
    expect(revalidate).toBe(300);
  });

  it('cờ tắt, không có cặp hay mọi gói hết hàng: noindex, follow', async () => {
    for (const b of [{ enabled: false, pairs: [] }, { enabled: true, pairs: [] }, { enabled: true, pairs: [LANDING.pairs[3]] }]) {
      body = b;
      expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
    }
  });
});

describe('RefillLandingPage', () => {
  it('đưa dữ liệu máy chủ xuống view; CollectionPage + ItemList mỗi gói một lần (bỏ gói hết hàng); FAQPage khớp phần hiển thị', async () => {
    const html = renderToStaticMarkup(await RefillLandingPage());
    expect(mocks.get).toHaveBeenCalledWith('/catalog/refill-pairs/landing', { anonymous: true });
    const props = mocks.view.mock.calls[0]![0] as { initial: unknown; initialFetchedAt: number };
    expect(props.initial).toEqual(LANDING);
    expect(typeof props.initialFetchedAt).toBe('number');

    const blocks = ldBlocks(html);
    const graph = blocks.find((b) => Array.isArray(b['@graph']))!['@graph'] as Record<string, unknown>[];
    const page = graph.find((n) => n['@type'] === 'CollectionPage')!;
    expect(page.url).toBe(`${SITE_URL}/tiet-kiem-refill`);
    expect(page.name).toBe('Tiết kiệm với Refill');
    expect(page.mainEntity).toEqual({
      '@type': 'ItemList',
      numberOfItems: 2,
      itemListElement: [
        { '@type': 'ListItem', position: 1, url: `${SITE_URL}/san-pham/refill-a`, name: 'Túi Refill a 2L' },
        { '@type': 'ListItem', position: 2, url: `${SITE_URL}/san-pham/refill-c`, name: 'Túi Refill c 2L' },
      ],
    });
    expect(graph.some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);

    const faq = blocks.find((b) => b['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const visible = [...doc.querySelectorAll('[data-testid="refill-landing-faq"] details')].map((d) => ({
      q: d.querySelector('summary')!.textContent!.trim(),
      a: d.querySelector('p')!.textContent!.trim(),
    }));
    expect(visible).toHaveLength(3);
    expect(faq.mainEntity.map((e) => ({ q: e.name, a: e.acceptedAnswer.text }))).toEqual(visible);
    expect(doc.querySelectorAll('h1')).toHaveLength(0);
  });

  it('không có thẻ bán được: không JSON-LD, không FAQ, view vẫn nhận dữ liệu để vẽ lời trống', async () => {
    body = { enabled: false, pairs: [] };
    const html = renderToStaticMarkup(await RefillLandingPage());
    expect(ldBlocks(html)).toEqual([]);
    expect(html).not.toContain('refill-landing-faq');
    expect((mocks.view.mock.calls[0]![0] as { initial: unknown }).initial).toEqual({ enabled: false, pairs: [] });
  });

  it('API lỗi lúc chạy (ISR làm mới): ném để Next giữ bản đã dựng', async () => {
    body = new Error('down');
    await expect(RefillLandingPage()).rejects.toThrow('down');
    expect(mocks.view).not.toHaveBeenCalled();
  });

  it('API chưa lên lúc next build: dựng không dữ liệu, không JSON-LD, noindex, rút hạn làm mới', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    try {
      body = new Error('down');
      const html = renderToStaticMarkup(await RefillLandingPage());
      expect((mocks.view.mock.calls[0]![0] as { initial: unknown }).initial).toBeUndefined();
      expect(ldBlocks(html)).toEqual([]);
      expect(mocks.get).toHaveBeenCalledWith('/config/public');
      expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
