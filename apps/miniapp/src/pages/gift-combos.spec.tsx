import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Trang Bộ quà tặng & combo khởi đầu (Mini App): cùng dữ liệu và luật với web /bo-qua-tang.

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), coreGet: vi.fn(), addAll: vi.fn(), notify: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../services/cart-batch', () => ({ addAllToCart: mocks.addAll }));
vi.mock('../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import GiftCombosPage from './gift-combos';

const card = (id: string, price: number) => ({ id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}` });
const combo = (id: string, a: [string, number], b: [string, number], pct = 10) => ({
  id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct, endAt: new Date(Date.now() + 86_400_000).toISOString(), anchorProductId: null,
  items: [a, b].map(([pid, price]) => ({ productId: pid, variationId: `v-${pid}`, maxQty: 1, addonPrice: null, inStock: true, product: card(pid, price) })),
});
let landing: Record<string, unknown>;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/gift-combos']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GiftCombosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const addAllButtons = () => screen.getAllByRole('button').filter((b) => /Thêm cả combo/.test(b.textContent ?? ''));

beforeEach(() => {
  vi.clearAllMocks();
  landing = {
    combos: [combo('c1', ['a', 120_000], ['b', 85_000]), combo('c2', ['c', 300_000], ['d', 100_000], 15)],
    freeshipThreshold: 199_000,
    giftTrialMinOrder: 299_000,
  };
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === '/bundles/gift-landing') return landing;
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.addAll.mockResolvedValue({});
});

describe('GiftCombosPage (Mini App)', () => {
  it('h1 tiêu đề, mỗi combo một thẻ với giá cả bộ tính từ giá thật của món', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Bộ quà tặng & combo khởi đầu' })).toBeTruthy();
    const list = await screen.findByTestId('gift-combos-list');
    expect(within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Combo c1', 'Combo c2']);
    expect(list.textContent).toContain('184.500đ');
    expect(list.textContent).toContain('Tiết kiệm 20.500đ');
    expect(list.textContent).toContain('340.000đ');
    expect(list.style.fontVariantNumeric).toBe('tabular-nums');
    expect(mocks.coreGet).toHaveBeenCalledWith('/bundles/gift-landing', { anonymous: true });
  });

  it('hai mốc đọc từ máy chủ; mốc null thì không hứa', async () => {
    landing.giftTrialMinOrder = null;
    landing.freeshipThreshold = 250_000;
    renderPage();
    await screen.findByTestId('gift-combos-list');
    expect(screen.getAllByTestId('gift-combos-callout').map((el) => el.textContent)).toEqual(['Miễn phí giao hàng cho đơn từ 250.000đ']);
  });

  it('"Thêm cả combo" một chạm thêm đúng món của combo đó và báo thành công', async () => {
    renderPage();
    await screen.findByTestId('gift-combos-list');
    fireEvent.click(addAllButtons()[1]!);
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-c', quantity: 1 }, { variationId: 'v-d', quantity: 1 }]));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text: 'Đã thêm cả combo vào giỏ' })));
  });

  it('0 combo: trạng thái trống, nút sang trang Sản phẩm; hai mốc vẫn hiện', async () => {
    landing.combos = [];
    renderPage();
    expect(await screen.findByText('Chưa có combo nào đang mở bán')).toBeTruthy();
    expect(screen.getAllByTestId('gift-combos-callout')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm khác' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('tải lỗi: báo lỗi kèm Thử lại, không vẽ danh sách', async () => {
    mocks.coreGet.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByTestId('gift-combos-list')).toBeNull();
  });
});
