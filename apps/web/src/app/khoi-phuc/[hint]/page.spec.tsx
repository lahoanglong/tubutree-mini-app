// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'idle', initialized: false, sessionUnavailable: false, user: null }) }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import RestoringHomePage, { generateStaticParams, metadata } from './page';

const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 200000, salePrice: null, isFeatured: false, inStock: true });
const pageOf = (data: unknown[]) => ({ data, meta: { page: 1, limit: 6, total: data.length } });

const render = async (hint: string) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {await RestoringHomePage({ params: Promise.resolve({ hint }) })}
    </QueryClientProvider>,
  );

const blocks = (html: string) => Array.from(html.matchAll(/data-home-block="(\w+)"/g)).map((m) => m[1]!);

beforeEach(() => {
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/products') return pageOf([card('bs', 'Bán chạy nhất')]);
    if (path === '/categories') return [{ id: 'c1', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 }];
    if (path === '/brands') return [{ brand: 'Tubu', count: 3 }];
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

describe('Trang chủ dựng sẵn cho khách đã có cookie phiên (HTML đầu, chưa hydrate)', () => {
  it('khách cũ: thẻ thành viên, Việc cần làm và Mua lại đã ở dạng khung chờ trong HTML server, không có kệ Bán chạy', async () => {
    const html = await render('returning-2');
    expect(html).toContain('data-testid="member-card-loading"');
    expect(html).toContain('data-testid="todo-strip-loading"');
    expect(blocks(html)).toEqual(expect.arrayContaining(['member', 'purchased']));
    expect(blocks(html)).not.toContain('bestSellers');
    expect(blocks(html).indexOf('purchased')).toBeLessThan(blocks(html).indexOf('categories'));
  });

  it('khách cũ không có việc cần làm lần trước: không dựng khung Việc cần làm', async () => {
    expect(await render('returning-0')).not.toContain('data-testid="todo-strip-loading"');
  });

  it('chưa biết loại khách: khung chờ trung tính ở chỗ thẻ thành viên, không dựng Mua lại, Quà khách mới hay Bán chạy', async () => {
    const html = await render('unknown');
    expect(html).toContain('data-testid="member-card-loading"');
    expect(blocks(html)).not.toContain('purchased');
    expect(blocks(html)).not.toContain('bestSellers');
  });

  it('khách mới đã nhớ: bố cục khách mới (có kệ Bán chạy), không thẻ thành viên', async () => {
    const html = await render('new');
    expect(html).not.toContain('data-testid="member-card-loading"');
    expect(blocks(html)).toContain('bestSellers');
  });

  it('chỉ có đúng 5 bản, gợi ý lạ thì 404, không cho lập chỉ mục, canonical về "/"', async () => {
    expect(generateStaticParams()).toEqual(['unknown', 'new', 'returning-0', 'returning-1', 'returning-2'].map((hint) => ({ hint })));
    await expect(render('admin')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(metadata.alternates?.canonical).toBe('/');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
