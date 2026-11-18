import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  fetchProducts: vi.fn(),
  get: vi.fn(),
}));
vi.mock('../../../services/shop-api', () => ({
  getPublicConfig: mocks.getPublicConfig,
  fetchProducts: mocks.fetchProducts,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../services/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { FreeshipBoosterRail } from './freeship-booster-rail';

const card = (slug: string, price: number, over: Record<string, unknown> = {}) => ({
  id: `id-${slug}`,
  slug,
  brand: 'Tubu',
  name: `Món ${slug}`,
  thumbnail: null,
  basePrice: price,
  salePrice: null,
  repVariationId: `v-${slug}`,
  isFeatured: false,
  inStock: true,
  ...over,
});
const CFG = (on: boolean) => ({ freeshipThreshold: 200_000, subscribeDiscountPct: 0.12, affiliateWalletMultiplier: 1.5, cashbackHoldDays: 30, freeshipBoosterEnabled: on });
// Còn thiếu 150.000đ: cửa sổ 45.000đ tới 195.000đ; "xb" đã trong giỏ.
const UPSELL = [card('hot', 190_000), card('close', 150_000), card('over', 195_001), card('cheap', 40_000), card('xb', 160_000)];
const LINES = [{ slug: 'xb', variationId: 'v-xb' }];

function mount(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <FreeshipBoosterRail remaining={150_000} lines={LINES} onAdd={vi.fn()} />
    </QueryClientProvider>,
  );
}
const slugs = () => within(screen.getByTestId('freeship-addons')).getAllByTestId('freeship-addon').map((c) => c.getAttribute('data-slug'));

describe('FreeshipBoosterRail (Mini, tubu-w3-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async () => UPSELL);
    mocks.fetchProducts.mockResolvedValue({ data: [card('a', 150_000), card('b', 160_000), card('c', 60_000), card('d', 190_000)], meta: { page: 1, limit: 8, total: 4 } });
  });

  it('cờ bật: hỏi /upsell/freeship đúng số thiếu và slug trong giỏ, không hỏi kệ Bán chạy; tiêu đề "Thêm 1 món nhỏ", giữ thứ tự máy chủ, cửa sổ 45.000đ', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mount();
    expect(await screen.findByRole('heading', { name: 'Thêm 1 món nhỏ để đủ Miễn phí giao hàng' })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/upsell/freeship', { query: { gap: 150_000, exclude: 'xb' } });
    expect(mocks.fetchProducts).not.toHaveBeenCalled();
    expect(slugs()).toEqual(['hot', 'close', 'cheap']);
  });

  it('cờ tắt: dải cũ từ kệ Bán chạy (cửa sổ 25.000đ, rẻ trước), tiêu đề cũ, không hỏi /upsell/freeship', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(false));
    mount();
    expect(await screen.findByRole('heading', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' })).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(slugs()).toEqual(['a', 'b', 'c']);
  });

  it('cấu hình lỗi: vẫn có dải cũ như trước khi có cờ', async () => {
    mocks.getPublicConfig.mockRejectedValue(new Error('mạng'));
    mount();
    expect(await screen.findByRole('heading', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' })).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('cấu hình còn chờ: chưa hỏi nguồn nào, chưa vẽ gì (không hiện món cũ rồi đổi)', async () => {
    mocks.getPublicConfig.mockReturnValue(new Promise(() => {}));
    mount();
    await act(async () => {});
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.fetchProducts).not.toHaveBeenCalled();
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
  });

  it('cấu hình còn chờ mà kệ Bán chạy đã có sẵn từ Trang chủ: vẫn chưa vẽ gì', async () => {
    mocks.getPublicConfig.mockReturnValue(new Promise(() => {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['products', 'home-best-seller'], { data: [card('a', 150_000), card('b', 160_000), card('c', 60_000)], basis: 'best_seller_30d' });
    mount(qc);
    await act(async () => {});
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
  });

  it('/upsell/freeship lỗi (cờ vừa tắt, cấu hình còn trong bộ nhớ đệm nên máy chủ trả 404): lùi về dải cũ từ kệ Bán chạy', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mocks.get.mockRejectedValue(new Error('404'));
    mount();
    expect(await screen.findByRole('heading', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalled();
    expect(slugs()).toEqual(['a', 'b', 'c']);
  });

  it('dưới 3 món hợp lệ: không vẽ gì', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mocks.get.mockResolvedValue([card('hot', 190_000), card('over', 260_000)]);
    mount();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
  });
});
