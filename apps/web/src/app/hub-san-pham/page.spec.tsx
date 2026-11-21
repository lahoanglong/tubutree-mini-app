import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// @vitest-environment jsdom
// Hub /san-pham mà crawler thật sự đọc: middleware viết lại /san-pham (không tham số lọc) sang bản ISR này, nên thẻ chia sẻ và JSON-LD
// của trang danh mục gốc phải nằm ở đây, khớp nhánh hub của app/san-pham/page.tsx.

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('@/components/catalog/browse-view', () => ({ default: () => <div data-testid="browse-view" /> }));

import BrowseHubPage, { metadata } from './page';

const PRODUCT = { id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', thumbnail: null, basePrice: 200000, salePrice: null, isFeatured: false, inStock: true };
const BEST = [PRODUCT, { ...PRODUCT, id: 'p2', slug: 'nuoc-rua-chen', name: 'Nước rửa chén </script>' }];

beforeEach(() => {
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/products') return { data: BEST, meta: { page: 1, limit: 10, total: BEST.length } };
    if (path === '/brands') return [{ brand: 'Tubu', count: 3 }];
    if (path === '/categories') return [];
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

const ldOf = (html: string) => Array.from(html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)).map((m) => JSON.parse(m[1]!));

describe('hub /san-pham (bản ISR) — og và JSON-LD', () => {
  it('og/twitter cùng canonical, tiêu đề và mô tả với thẻ meta', () => {
    expect(metadata.alternates?.canonical).toBe('/san-pham');
    expect(metadata.openGraph).toMatchObject({ url: '/san-pham', title: `${metadata.title} — Tubu Tree`, description: metadata.description, siteName: 'Tubu Tree' });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: `${metadata.title} — Tubu Tree` });
  });

  it('một @graph CollectionPage + ItemList (kệ Bán chạy) + BreadcrumbList Trang chủ › Danh mục; tên lạ không phá thẻ script', async () => {
    const html = renderToStaticMarkup(await BrowseHubPage());
    expect(html).not.toContain('</script>"');
    const blocks = ldOf(html);
    expect(blocks).toHaveLength(1);
    const [page, crumbs] = blocks[0]['@graph'];
    expect(page).toMatchObject({ '@type': 'CollectionPage', url: 'https://app.tubutree.com/san-pham', name: metadata.title, description: metadata.description });
    expect(page.mainEntity.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, url: 'https://app.tubutree.com/san-pham/dau-goi', name: 'Dầu gội bồ kết' },
      { '@type': 'ListItem', position: 2, url: 'https://app.tubutree.com/san-pham/nuoc-rua-chen', name: 'Nước rửa chén </script>' },
    ]);
    expect(crumbs['@type']).toBe('BreadcrumbList');
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Trang chủ', 'Danh mục']);
    expect(page.breadcrumb['@id']).toBe(crumbs['@id']);
  });

  it('kệ Bán chạy lỗi lúc build: vẫn có CollectionPage + BreadcrumbList, không có ItemList rỗng', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/products') throw new Error('API chưa lên');
      return path === '/brands' || path === '/categories' ? [] : {};
    });
    try {
      const [graph] = ldOf(renderToStaticMarkup(await BrowseHubPage()));
      expect(graph['@graph'][0]['@type']).toBe('CollectionPage');
      expect(graph['@graph'][0]).not.toHaveProperty('mainEntity');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
