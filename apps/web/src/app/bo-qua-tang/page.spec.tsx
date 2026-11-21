// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Trang server của /bo-qua-tang: tải sẵn combo thật và hai mốc (Miễn phí giao hàng, quà dùng thử) để crawler thấy giá, khai CollectionPage
// JSON-LD trỏ tới trang sản phẩm thật, rồi GiftCombosView tiếp quản. API lỗi lúc chạy thì ném (Next giữ bản cũ); lúc next build thì dựng rỗng.

const mocks = vi.hoisted(() => ({ get: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('./gift-combos-view', () => ({
  default: (props: unknown) => {
    mocks.view(props);
    return <div data-testid="gift-combos-view" />;
  },
}));

import { SITE_URL } from '@/lib/site';
import GiftCombosPage, { metadata, revalidate } from './page';

const card = (id: string, price: number) => ({ id, slug: `sp-${id}`, brand: 'Tubu', name: `Món ${id}`, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true });
const LANDING = {
  combos: [
    {
      id: 'c1',
      kind: 'BUNDLE_PCT',
      title: 'Combo bếp xanh',
      pct: 10,
      endAt: '2099-01-01T00:00:00Z',
      anchorProductId: null,
      items: [
        { productId: 'a', variationId: 'va', maxQty: 1, addonPrice: null, inStock: true, product: card('a', 120000) },
        { productId: 'b', variationId: 'vb', maxQty: 1, addonPrice: null, inStock: true, product: card('b', 85000) },
      ],
    },
  ],
  freeshipThreshold: 199000,
  giftTrialMinOrder: 299000,
};

beforeEach(() => {
  mocks.view.mockReset();
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/bundles/gift-landing') return LANDING;
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

const jsonLdOf = (html: string) => {
  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
  return m ? (JSON.parse(m[1]!) as { '@graph': Array<Record<string, unknown>> }) : null;
};

describe('metadata', () => {
  it('trang được lập chỉ mục, canonical /bo-qua-tang, có og/twitter; ISR 5 phút', () => {
    expect(metadata.title).toBe('Bộ quà tặng & combo khởi đầu');
    expect(metadata.alternates?.canonical).toBe('/bo-qua-tang');
    expect(metadata.robots).toBeUndefined();
    expect(metadata.openGraph).toMatchObject({ url: '/bo-qua-tang', title: 'Bộ quà tặng & combo khởi đầu — Tubu Tree' });
    expect(String(metadata.description)).not.toMatch(/\d/);
    expect(revalidate).toBe(300);
  });
});

describe('GiftCombosPage', () => {
  it('đưa dữ liệu máy chủ xuống view và khai CollectionPage + ItemList trỏ trang sản phẩm thật', async () => {
    const html = renderToStaticMarkup(await GiftCombosPage());
    expect(mocks.get).toHaveBeenCalledWith('/bundles/gift-landing', { anonymous: true });
    const props = mocks.view.mock.calls[0]![0] as { initial: unknown; initialFetchedAt: number };
    expect(props.initial).toEqual(LANDING);
    expect(typeof props.initialFetchedAt).toBe('number');
    const ld = jsonLdOf(html)!;
    const page = ld['@graph'].find((n) => n['@type'] === 'CollectionPage')!;
    expect(page.url).toBe(`${SITE_URL}/bo-qua-tang`);
    expect(page.name).toBe('Bộ quà tặng & combo khởi đầu');
    expect(page.mainEntity).toEqual({
      '@type': 'ItemList',
      numberOfItems: 2,
      itemListElement: [
        { '@type': 'ListItem', position: 1, url: `${SITE_URL}/san-pham/sp-a`, name: 'Món a' },
        { '@type': 'ListItem', position: 2, url: `${SITE_URL}/san-pham/sp-b`, name: 'Món b' },
      ],
    });
    expect(ld['@graph'].some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);
  });

  it('API lỗi lúc chạy (ISR làm mới): ném để Next giữ bản đã dựng, không lưu trang rỗng 5 phút', async () => {
    mocks.get.mockRejectedValue(new Error('down'));
    await expect(GiftCombosPage()).rejects.toThrow('down');
    expect(mocks.view).not.toHaveBeenCalled();
  });

  it('API chưa lên lúc next build: dựng không dữ liệu (view tự tải), JSON-LD không có ItemList giả, rút hạn làm mới', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    try {
      mocks.get.mockRejectedValue(new Error('down'));
      const html = renderToStaticMarkup(await GiftCombosPage());
      expect((mocks.view.mock.calls[0]![0] as { initial: unknown }).initial).toBeUndefined();
      const page = jsonLdOf(html)!['@graph'].find((n) => n['@type'] === 'CollectionPage')!;
      expect(page.mainEntity).toBeUndefined();
      expect(mocks.get).toHaveBeenCalledWith('/config/public');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
