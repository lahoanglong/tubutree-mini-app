// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => {
  class FakeNotFound extends Error {
    constructor(readonly path: string) {
      super(`API ${path} không tìm thấy`);
    }
  }
  class FakeUnavailable extends Error {}
  return { get: vi.fn(), revalidates: [] as (number | undefined)[], FakeNotFound, FakeUnavailable };
});
const { FakeNotFound, FakeUnavailable } = mocks;

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/chien-dich/giua-thu',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/core-http-server', () => ({
  ApiNotFoundError: mocks.FakeNotFound,
  createServerHttp: (init?: { revalidate?: number }) => {
    mocks.revalidates.push(init?.revalidate);
    return { get: mocks.get };
  },
}));

import CampaignPage, { generateMetadata, revalidate } from './page';

const DETAIL = {
  id: 'c1',
  slug: 'giua-thu',
  title: 'Giữa Thu',
  subtitle: 'Giảm sâu mùa trăng',
  image: 'https://img.test/giua-thu.jpg',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2026-10-31T17:00:00.000Z',
  endAt: '2026-11-10T17:30:00.000Z',
  productCount: 2,
  coupons: [],
};
const card = (n: number) => ({ id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 10_000 * n, salePrice: null, isFeatured: false, inStock: true });

const params = Promise.resolve({ slug: 'giua-thu' });
const html = async () => {
  const el = (await CampaignPage({ params })) as ReactElement;
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
  return box;
};

beforeEach(() => {
  mocks.revalidates.length = 0;
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/campaigns/giua-thu') return DETAIL;
    if (path === '/campaigns/giua-thu/products') return { data: [card(1), card(2)], meta: { page: 1, limit: 20, total: 2 } };
    throw new Error(`không mock ${path}`);
  });
});
afterEach(() => vi.clearAllMocks());

describe('/chien-dich/[slug] — trang chiến dịch (server)', () => {
  it('dựng sẵn phía server cho SEO: h1 là tên chương trình và lưới sản phẩm trang 1 đã có trong HTML đầu', async () => {
    const box = await html();
    expect(box.querySelector('h1')!.textContent).toBe('Giữa Thu');
    expect(box.textContent).toContain('Sản phẩm 1');
    expect(box.textContent).toContain('Sản phẩm 2');
  });

  it('làm mới mỗi 60 giây (cả trang lẫn các lệnh fetch): admin tắt hay hết hạn thì trang không còn lâu', async () => {
    expect(revalidate).toBe(60);
    await CampaignPage({ params });
    expect(mocks.revalidates.length).toBeGreaterThan(0);
    expect(new Set(mocks.revalidates)).toEqual(new Set([60]));
  });

  it('API trả 404 (hết hạn, chưa mở, không có): 404 thật qua notFound()', async () => {
    mocks.get.mockRejectedValue(new FakeNotFound('/campaigns/giua-thu'));
    await expect(CampaignPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('API tạm lỗi (không phải 404): ném lỗi để Next giữ bản đã render, KHÔNG báo 404 làm khách nghĩ chương trình đã hết', async () => {
    mocks.get.mockRejectedValue(new FakeUnavailable('503'));
    await expect(CampaignPage({ params })).rejects.toThrow('503');
  });

  it('sản phẩm trang 1 lỗi: trang vẫn mở (client tải lại), không 404', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/campaigns/giua-thu') return DETAIL;
      throw new FakeUnavailable('503');
    });
    const box = await html();
    expect(box.querySelector('h1')!.textContent).toBe('Giữa Thu');
  });

  it('chiến dịch không có sản phẩm thì không gọi API sản phẩm', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/campaigns/giua-thu') return { ...DETAIL, productCount: 0 };
      throw new Error(`không nên gọi ${path}`);
    });
    const box = await html();
    expect(box.textContent).toContain('Chương trình chưa có sản phẩm');
  });

  it('tiêu đề tab và thẻ chia sẻ lấy từ chương trình; không có chương trình thì tiêu đề chung', async () => {
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe('Giữa Thu — Tubu Tree');
    expect(meta.description).toBe('Giảm sâu mùa trăng');
    expect((meta.openGraph as { images: string[] }).images).toEqual(['https://img.test/giua-thu.jpg']);
    mocks.get.mockRejectedValue(new FakeNotFound('/campaigns/giua-thu'));
    expect((await generateMetadata({ params })).title).toBe('Chương trình — Tubu Tree');
  });
});
