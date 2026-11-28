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

import { aovGiftExclusions, aovUpsellGoal, type AovUpsellGoal } from '@tubutree/app-core/cart/aov-upsell';
import { freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
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
const GIFT: GiftTrialSummaryDTO = {
  base: 258_000,
  minOrder: 300_000,
  nextMinOrder: 300_000,
  shortfall: 42_000,
  options: [{ variationId: 'v-fuwa3e', productName: 'Fuwa3e', variationName: '100ml', slug: 'fuwa3e', thumbnail: null, minOrder: 300_000, unlocked: false }],
  selectedVariationId: null,
  declined: false,
};
const goalAt = (base: number): AovUpsellGoal => aovUpsellGoal({ base, freeship: { ...freeshipProgress({ base, threshold: 200_000 }), threshold: 200_000 }, giftTrial: GIFT })!;
// Còn thiếu 35.000đ tới Miễn phí giao hàng: cửa sổ 45.000đ tới 80.000đ; "xb" đã trong giỏ, "fuwa3e" là quà dùng thử 0đ.
const UPSELL = [card('hot', 70_000), card('close', 36_000), card('over', 80_001), card('cheap', 20_000), card('xb', 40_000), card('fuwa3e', 40_000)];
const LINES = [{ slug: 'xb', variationId: 'v-xb' }];

function mount(goal = goalAt(165_000), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <FreeshipBoosterRail goal={goal} lines={LINES} exclude={aovGiftExclusions(GIFT)} onAdd={vi.fn()} />
    </QueryClientProvider>,
  );
}
const slugs = () => within(screen.getByTestId('freeship-addons')).getAllByTestId('freeship-addon').map((c) => c.getAttribute('data-slug'));

describe('FreeshipBoosterRail (Mini, tubu-w3-02 + tubu-w7-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async () => UPSELL);
    mocks.fetchProducts.mockResolvedValue({ data: [card('a', 40_000), card('b', 50_000), card('c', 20_000), card('d', 70_000)], meta: { page: 1, limit: 8, total: 4 } });
  });

  it('cờ bật: hỏi /upsell/freeship đúng số thiếu và slug trong giỏ, không hỏi kệ Bán chạy; dòng đầu không lặp số của thanh, giữ thứ tự máy chủ, bỏ quà 0đ', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mount();
    expect(await screen.findByRole('heading', { name: 'Gợi ý thêm để được Miễn phí giao hàng' })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/upsell/freeship', { query: { gap: 35_000, exclude: 'fuwa3e,xb' } });
    expect(mocks.fetchProducts).not.toHaveBeenCalled();
    expect(screen.getByTestId('freeship-addons').getAttribute('data-stage')).toBe('freeship');
    expect(slugs()).toEqual(['hot', 'close']);
  });

  it('đã Miễn phí giao hàng, chưa đủ mốc quà: hỏi /upsell/freeship với số thiếu tới mốc quà, dòng đầu nói quà dùng thử 0đ', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mount(goalAt(258_000));
    expect(await screen.findByRole('heading', { name: 'Thêm 42.000đ nữa để nhận quà dùng thử 0đ' })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/upsell/freeship', { query: { gap: 42_000, exclude: 'fuwa3e,xb' } });
    expect(screen.getByTestId('freeship-addons').getAttribute('data-stage')).toBe('gift');
    // Cửa sổ 45.000đ trên 42.000đ: "over" (80.001đ) bù đủ mốc quà; món rẻ hơn khoảng thiếu xếp gần đủ trước.
    expect(slugs()).toEqual(['hot', 'over']);
  });

  it('cờ tắt: món từ kệ Bán chạy (cửa sổ 25.000đ, bù đủ rẻ trước rồi món gần đủ), không hỏi /upsell/freeship', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(false));
    mount();
    expect(await screen.findByRole('heading', { name: 'Gợi ý thêm để được Miễn phí giao hàng' })).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(slugs()).toEqual(['a', 'b']);
  });

  it('cấu hình lỗi: vẫn có dải từ kệ Bán chạy như trước khi có cờ', async () => {
    mocks.getPublicConfig.mockRejectedValue(new Error('mạng'));
    mount();
    expect(await screen.findByRole('heading', { name: 'Gợi ý thêm để được Miễn phí giao hàng' })).toBeInTheDocument();
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
    qc.setQueryData(['products', 'home-best-seller'], { data: [card('a', 40_000), card('b', 50_000), card('c', 20_000)], basis: 'best_seller_30d' });
    mount(goalAt(165_000), qc);
    await act(async () => {});
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
  });

  it('/upsell/freeship lỗi (cờ vừa tắt, cấu hình còn trong bộ nhớ đệm nên máy chủ trả 404): lùi về kệ Bán chạy', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mocks.get.mockRejectedValue(new Error('404'));
    mount();
    expect(await screen.findByRole('heading', { name: 'Gợi ý thêm để được Miễn phí giao hàng' })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalled();
    expect(slugs()).toEqual(['a', 'b']);
  });

  it('tối đa 2 món, giá không quá 120.000đ kể cả khi khoảng thiếu lớn', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mocks.get.mockResolvedValue([card('m1', 119_000), card('m2', 120_001), card('m3', 90_000), card('m4', 80_000), card('m5', 60_000), card('m6', 50_000)]);
    mount(goalAt(60_000));
    await screen.findByTestId('freeship-addons');
    expect(slugs()).toEqual(['m1', 'm3']);
  });

  it('dưới 2 món hợp lệ: không vẽ gì', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    mocks.get.mockResolvedValue([card('hot', 70_000), card('over', 260_000), card('fuwa3e', 40_000)]);
    mount();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
  });

  it('báo Giỏ dải còn chờ nguồn (null), đang hiện (true), rời màn (false) để Giỏ quyết ô quà khoá', async () => {
    mocks.getPublicConfig.mockResolvedValue(CFG(true));
    const onShownChange = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <FreeshipBoosterRail goal={goalAt(258_000)} lines={LINES} exclude={aovGiftExclusions(GIFT)} onAdd={vi.fn()} onShownChange={onShownChange} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('freeship-addons');
    expect(onShownChange.mock.calls[0]).toEqual([null]);
    expect(onShownChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(onShownChange).toHaveBeenLastCalledWith(false);
  });
});
