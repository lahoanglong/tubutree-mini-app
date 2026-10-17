import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicStorefront: vi.fn(),
  shareSheetProps: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/storefront-api', () => ({ getPublicStorefront: mocks.getPublicStorefront }));
vi.mock('../components/share-sheet', () => ({
  ShareSheet: (props: Record<string, unknown>) => {
    mocks.shareSheetProps(props);
    return null;
  },
}));
vi.mock('../components/store-page-shell', () => ({
  StorePageShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import { useStorefrontContext } from '../store/storefront-context';
import StorefrontViewPage from './storefront-view';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const storefront = (over: Record<string, unknown>) => ({
  id: 'sf1', slug: 'abcd1234', type: 'CTV', title: 'Gian hàng Lan', headerNote: null, ownerTier: null,
  avatarUrl: null, coverUrl: null, theme: 'default', referralCode: 'ABCD1234', collections: [], ...over,
});

function renderPage(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/s/${slug}`]} future={FUTURE}>
        <Routes>
          <Route path="/s/:slug" element={<StorefrontViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StorefrontViewPage — mã giới thiệu lấy từ API, không suy từ slug (D3-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
  });

  it('gian hàng CTV: ngữ cảnh và nút chia sẻ dùng referralCode API trả về, kể cả khi slug khác mã', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ slug: 'lan-shop', referralCode: 'ABCD1234' }));
    renderPage('lan-shop');
    await screen.findByText('Gian hàng Lan');
    await waitFor(() => expect(useStorefrontContext.getState().referralCode).toBe('ABCD1234'));
    expect(useStorefrontContext.getState().slug).toBe('lan-shop');
    expect(mocks.shareSheetProps).toHaveBeenCalledWith(expect.objectContaining({ slug: 'lan-shop', referralCode: 'ABCD1234' }));
  });

  it('gian hàng đối tác (MERCHANT): API không trả mã → không có mã giới thiệu', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'MERCHANT', slug: 'doi-tac', referralCode: null }));
    renderPage('doi-tac');
    await screen.findByText('Gian hàng Lan');
    await waitFor(() => expect(useStorefrontContext.getState().slug).toBe('doi-tac'));
    expect(useStorefrontContext.getState().referralCode).toBeNull();
    expect(mocks.shareSheetProps).toHaveBeenCalledWith(expect.objectContaining({ referralCode: null }));
  });
});
