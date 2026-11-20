import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDP_BLOCK_ORDER } from '@tubutree/app-core/commerce/pdp-info';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchProduct: vi.fn(),
  fetchRelated: vi.fn(),
  fetchBoughtTogether: vi.fn(),
  fetchForYou: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  fetchCompare: vi.fn(),
  addToCart: vi.fn(),
  fetchRefillPair: vi.fn(),
  authStatus: 'authenticated',
  subscribeDiscountPct: 0.12 as number | undefined,
  refillFirst: false,
}));
vi.mock('../utils/features', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), SUBSCRIPTIONS_IN_MINIAPP: true }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: mocks.fetchRelated,
  fetchBoughtTogether: mocks.fetchBoughtTogether,
  fetchForYou: mocks.fetchForYou,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  fetchReviews: vi.fn().mockResolvedValue({ count: 0, average: 0, items: [] }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: mocks.addToCart,
}));
vi.mock('@tubutree/app-core/api/product-compare', () => ({ fetchProductCompare: (_http: unknown, slug: string) => mocks.fetchCompare(slug) }));
vi.mock('@tubutree/app-core/refill/refill-saving', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refillPairQuery: (_http: unknown, id: string) => ({ queryKey: ['refill-pairs', 'public', id], queryFn: () => mocks.fetchRefillPair(id), retry: false }),
}));
vi.mock('../services/bundle-api', () => ({ getProductBundles: vi.fn().mockResolvedValue({ combos: [], addons: [] }) }));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: true, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.authStatus, login: vi.fn(), user: null });
  return { useAuthStore: Object.assign(state, { getState: state }) };
});
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ isLoaded: true, freeshipThreshold: 200_000, subscribeDiscountPct: mocks.subscribeDiscountPct, returnWindowDays: 7, refillFirstEnabled: mocks.refillFirst }),
}));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => <section aria-label="Đánh giá sản phẩm" id="danh-gia" />, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const LAYER = { id: 'l', spriteId: 'honey-drop', label: 'Mật', from: 'top', xPct: 50, yPct: 50, scale: 1, rotateDeg: 0 };
const OWN_STORY = {
  version: 1,
  enabled: true,
  scenes: [{ kind: 'ingredient_assembly', steps: [{ title: 'Hái sả', body: 'Sả tươi', layers: [LAYER] }, { title: 'Ép lạnh', body: 'Giữ mùi', layers: [LAYER] }] }],
};
const INGREDIENTS = ['Sả chanh', 'Enzyme dứa', 'Muối biển', 'Bồ hòn', 'Tinh dầu bưởi'].map((name) => ({ name, percentage: null, benefit: null }));
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: 'Lên men enzyme dứa.',
  description: '<p>Nước <strong>rửa</strong> chén</p><ul><li>Không mùi hắc</li></ul>',
  images: ['https://img/1.jpg', 'https://img/2.jpg'], thumbnail: 'https://img/1.jpg', basePrice: 75_000, salePrice: null,
  certifications: ['USDA Organic'], ingredients: INGREDIENTS, sold: 0, storyConfig: OWN_STORY,
  fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' },
  variations: [
    { id: 'v1', sku: 'S1', name: '1L', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 },
    { id: 'v2', sku: 'S2', name: 'Can 5L', attributes: {}, retailPrice: 300_000, salePrice: null, stock: 5 },
  ],
  ...over,
});
const card = (id: string) => ({ id, slug: id, brand: 'Cô Lan', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 65_000, salePrice: null, sold: 0, inStock: true, isFeatured: false, repVariationId: `v-${id}` });
// 20:00 UTC ngày 02/11 là 03:00 ngày 03/11 giờ Việt Nam: dòng ghi theo giờ Việt Nam.
const purchased = (over: Record<string, unknown> = {}) => ({
  variationId: 'v2', productId: 'p1', slug: 'xa-phong', productName: 'Xà phòng sả chanh', variationName: 'Can 5L', brand: 'Cô Lan', thumbnail: null,
  price: 300_000, salePrice: null, stock: 5, inStock: true, timesBought: 1, lastPurchasedAt: '2026-11-02T20:00:00.000Z', ...over,
});
const col = (productId: string, name: string, over: Record<string, unknown> = {}) => ({
  productId, slug: `slug-${productId}`, name, brand: 'Cô Lan', thumbnail: null, price: 75_000, variationName: '1L', size: '1L',
  unitPrice: { per: '100ml', value: 7_500 }, keyIngredients: ['Sả chanh', 'Enzyme dứa'], ...over,
});
const COMPARE = {
  current: col('p1', 'Xà phòng sả chanh'),
  others: [
    col('c2', 'Nước rửa chén bồ hòn', { price: 90_000, size: '500ml', unitPrice: { per: '100ml', value: 18_000 }, keyIngredients: ['Bồ hòn'] }),
    col('c3', 'Nước rửa chén vỏ bưởi', { price: 120_000, size: null, unitPrice: null, keyIngredients: [] }),
  ],
};

function renderPdp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/product/xa-phong']} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const blockKeys = () => Array.from(document.querySelectorAll('[data-pdp-block]')).map((el) => el.getAttribute('data-pdp-block'));
const block = (key: string) => document.querySelector<HTMLElement>(`[data-pdp-block="${key}"]`);

describe('ProductDetailPage — sắp xếp thông tin trang sản phẩm (tubu-pdp-information)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.subscribeDiscountPct = 0.12;
    mocks.fetchProduct.mockResolvedValue(product());
    mocks.fetchRelated.mockResolvedValue([card('n1'), card('n2')]);
    mocks.fetchBoughtTogether.mockResolvedValue([card('b1'), card('b2'), card('b3')]);
    mocks.fetchForYou.mockResolvedValue([card('f1'), card('f2')]);
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [purchased()], nextCursor: null });
    mocks.fetchCompare.mockResolvedValue(COMPARE);
    mocks.addToCart.mockResolvedValue({ items: [], itemCount: 1 });
    mocks.fetchRefillPair.mockResolvedValue({});
    mocks.refillFirst = false;
  });
  afterEach(() => {
    mocks.authStatus = 'authenticated';
  });

  it('đủ dữ liệu: mọi khối có mặt, mỗi khối một lần, đúng thứ tự PDP_BLOCK_ORDER', async () => {
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    await screen.findByTestId('product-story');
    await waitFor(() => expect(blockKeys()).toEqual([...PDP_BLOCK_ORDER]));
  });

  it('thiếu dữ liệu: khối trống không vẽ, các khối còn lại giữ đúng thứ tự', async () => {
    mocks.authStatus = 'guest';
    mocks.fetchProduct.mockResolvedValue(product({ ingredients: null, storyConfig: null, shortDesc: null, certifications: [] }));
    mocks.fetchBoughtTogether.mockResolvedValue([]);
    mocks.fetchCompare.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    await waitFor(() => expect(block('suggestions')).not.toBeNull());
    await waitFor(() => expect(mocks.fetchCompare).toHaveBeenCalled());
    const keys = blockKeys();
    for (const gone of ['rebuy', 'benefits', 'ingredients', 'story', 'addons', 'compare']) expect(keys, gone).not.toContain(gone);
    expect(keys).toEqual(PDP_BLOCK_ORDER.filter((k) => keys.includes(k)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe('Mua lại', () => {
    it('đã mua (đơn đã giao): một dòng "Bạn đã mua ngày 03/11" + một nút phụ; chạm thêm đúng phân loại lần trước, số lượng 1', async () => {
      renderPdp();
      const btn = await screen.findByRole('button', { name: 'Mua lại phân loại Can 5L đã mua ngày 03/11' });
      const row = block('rebuy')!;
      expect(row).toHaveTextContent('Bạn đã mua ngày 03/11');
      expect(within(row).getAllByRole('button')).toHaveLength(1);
      expect(mocks.fetchPurchasedItems).toHaveBeenCalledWith({ limit: 50 });
      fireEvent.click(btn);
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v2', 1));
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      // Không mở bảng chọn phân loại: dòng đã nói rõ phân loại nào.
      expect(screen.queryByRole('group', { name: 'Phân loại' })).toBeNull();
    });

    it('khách chưa đăng nhập: không có dòng Mua lại, không hỏi lịch sử mua', async () => {
      mocks.authStatus = 'guest';
      renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
      expect(block('rebuy')).toBeNull();
      expect(mocks.fetchPurchasedItems).not.toHaveBeenCalled();
    });

    it('phân loại lần trước hết hàng hoặc lịch sử lỗi: không có dòng (không lặng lẽ thêm phân loại khác)', async () => {
      mocks.fetchProduct.mockResolvedValue(product({ variations: [product().variations[0], { ...product().variations[1], stock: 0 }] }));
      const first = renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(block('rebuy')).toBeNull();
      first.unmount();

      mocks.fetchProduct.mockResolvedValue(product());
      mocks.fetchPurchasedItems.mockRejectedValue(new Error('500'));
      renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(block('rebuy')).toBeNull();
    });

    describe('chai đã ghép gói Refill (tubu-w9-03)', () => {
      const BOTTLE = { name: 'Nước rửa chén Fuwa3e 500ml', basePrice: 68_000 };
      const REFILL = {
        productId: 'p-refill', slug: 'refill-nuoc-rua-chen-fuwa3e-10l-69f244', name: 'Refill Nước rửa chén Fuwa3e 10L', thumbnail: null,
        variationId: 'v-refill', price: 890_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true,
      };
      const SPOKEN = 'Đổi sang túi Refill 10L, rẻ hơn 34% mỗi 100ml';

      it('cờ bật, khách đã nhận chai: liên kết đổi sang Refill kèm huy hiệu rẻ hơn mỗi 100ml dưới dòng Mua lại; chạm mở trang gói Refill', async () => {
        mocks.refillFirst = true;
        mocks.fetchProduct.mockResolvedValue(product(BOTTLE));
        mocks.fetchRefillPair.mockResolvedValue({ p1: REFILL });
        renderPdp();
        const link = await screen.findByRole('button', { name: SPOKEN });
        expect(link).toHaveTextContent('Đổi sang túi Refill 10L');
        expect(link).toHaveTextContent('Rẻ hơn 34%/100ml');
        expect(mocks.fetchRefillPair).toHaveBeenCalledWith('p1');
        expect(within(block('rebuy')!).getAllByRole('button')).toHaveLength(1);
        expect(block('rebuy')!.contains(link)).toBe(false);
        fireEvent.click(link);
        expect(mocks.navigate).toHaveBeenCalledWith('/product/refill-nuoc-rua-chen-fuwa3e-10l-69f244');
        expect(mocks.addToCart).not.toHaveBeenCalled();
      });

      it('cờ tắt, khách chưa mua sản phẩm này hay chưa đăng nhập: không hỏi cặp, không có liên kết', async () => {
        mocks.fetchProduct.mockResolvedValue(product(BOTTLE));
        mocks.fetchRefillPair.mockResolvedValue({ p1: REFILL });
        const off = renderPdp();
        await screen.findByRole('button', { name: 'Mua lại phân loại Can 5L đã mua ngày 03/11' });
        off.unmount();

        mocks.refillFirst = true;
        mocks.fetchPurchasedItems.mockResolvedValue({ items: [purchased({ productId: 'p-khac', slug: 'khac' })], nextCursor: null });
        const notBought = renderPdp();
        await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
        await screen.findByRole('heading', { level: 1, name: BOTTLE.name });
        notBought.unmount();

        mocks.authStatus = 'guest';
        renderPdp();
        await screen.findByRole('heading', { level: 1, name: BOTTLE.name });
        expect(mocks.fetchRefillPair).not.toHaveBeenCalled();
        expect(screen.queryByTestId('pdp-refill')).toBeNull();
      });

      it('gói Refill hết hàng hay chai không có cặp: dòng Mua lại giữ nguyên, không có liên kết', async () => {
        mocks.refillFirst = true;
        mocks.fetchProduct.mockResolvedValue(product(BOTTLE));
        mocks.fetchRefillPair.mockResolvedValue({ p1: { ...REFILL, inStock: false } });
        const soldOut = renderPdp();
        await screen.findByRole('button', { name: 'Mua lại phân loại Can 5L đã mua ngày 03/11' });
        await waitFor(() => expect(mocks.fetchRefillPair).toHaveBeenCalledWith('p1'));
        expect(screen.queryByTestId('pdp-refill')).toBeNull();
        soldOut.unmount();

        mocks.fetchRefillPair.mockResolvedValue({});
        renderPdp();
        await screen.findByRole('button', { name: 'Mua lại phân loại Can 5L đã mua ngày 03/11' });
        await waitFor(() => expect(mocks.fetchRefillPair).toHaveBeenCalledTimes(2));
        expect(screen.queryByTestId('pdp-refill')).toBeNull();
      });
    });
  });

  it('Đặt định kỳ: số đọc từ cấu hình (0.12 → 12%), nằm sau dòng Mua lại; thiếu cấu hình thì không nêu số', async () => {
    const first = renderPdp();
    expect(await screen.findByText('Đặt định kỳ — tiết kiệm 12%')).toBeInTheDocument();
    await screen.findByRole('button', { name: /^Mua lại/ });
    expect(block('rebuy')!.compareDocumentPosition(block('subscribe')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    first.unmount();

    mocks.subscribeDiscountPct = undefined;
    renderPdp();
    expect(await screen.findByText('Đặt định kỳ — tiết kiệm mỗi kỳ')).toBeInTheDocument();
    expect(block('subscribe')!.textContent).not.toMatch(/\d+%/);
  });

  it('mô tả HTML (<p>, <strong>, <ul>): đọc thành chữ, không hiện thẻ dạng chữ', async () => {
    renderPdp();
    const body = await screen.findByTestId('pdp-description-body');
    expect(body.textContent).not.toMatch(/<\/?(p|strong|ul|li)>/);
    expect(document.body.textContent).not.toContain('<p>');
    expect(within(body).getByText('rửa').tagName).toBe('STRONG');
    expect(within(body).getByRole('listitem')).toHaveTextContent('Không mùi hắc');
  });

  it('mô tả ngắn có HTML: khối Lợi ích chỉ hiện chữ', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ shortDesc: '<p>Lên men <b>enzyme</b> dứa.</p>' }));
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    const benefits = block('benefits')!;
    expect(benefits).toHaveTextContent('Lên men enzyme dứa.');
    expect(benefits.textContent).not.toContain('<');
  });

  it('Thành phần: mở sẵn 3 dòng, "Xem đủ (5)" mở hết, "Thu gọn" thu lại (aria-expanded)', async () => {
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    const section = block('ingredients')!;
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    const more = within(section).getByRole('button', { name: 'Xem đủ (5)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
    const less = within(section).getByRole('button', { name: 'Thu gọn' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(less);
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
  });

  describe('So với món tương tự', () => {
    it('có dữ liệu: bảng 3 cột đủ hàng Giá, Giá/100ml, Dung tích, Thành phần chính và nút Xem từng món', async () => {
      renderPdp();
      const region = await screen.findByRole('region', { name: 'So với món tương tự' });
      expect(mocks.fetchCompare).toHaveBeenCalledWith('xa-phong');
      const heads = within(region).getAllByRole('columnheader').map((h) => h.textContent);
      expect(heads).toEqual(['Món này', 'Nước rửa chén bồ hòn', 'Nước rửa chén vỏ bưởi']);
      const rows = within(region).getAllByRole('rowheader').map((h) => h.textContent);
      expect(rows).toEqual(['Giá', 'Giá/100ml', 'Dung tích', 'Thành phần chính']);
      const unitRow = within(region).getByRole('rowheader', { name: 'Giá/100ml' }).closest('tr')!;
      expect(within(unitRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['7.500đ', '18.000đ', '—']);
      const sizeRow = within(region).getByRole('rowheader', { name: 'Dung tích' }).closest('tr')!;
      expect(within(sizeRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1L', '500ml', '—']);
      const ingRow = within(region).getByRole('rowheader', { name: 'Thành phần chính' }).closest('tr')!;
      expect(within(ingRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Sả chanh, Enzyme dứa', 'Bồ hòn', '—']);
      fireEvent.click(within(region).getByRole('button', { name: 'Xem Nước rửa chén vỏ bưởi' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/product/slug-c3');
      expect(within(region).getAllByRole('button')).toHaveLength(2);
    });

    it.each([
      ['404 (cờ tắt)', () => mocks.fetchCompare.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))],
      ['lỗi máy chủ', () => mocks.fetchCompare.mockRejectedValue(new Error('500'))],
      ['không có món để so', () => mocks.fetchCompare.mockResolvedValue({ current: COMPARE.current, others: [] })],
      ['dữ liệu sai dạng', () => mocks.fetchCompare.mockResolvedValue({ current: COMPARE.current, others: null })],
    ])('%s: không vẽ khối, không báo lỗi', async (_n, arrange) => {
      arrange();
      renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
      await waitFor(() => expect(mocks.fetchCompare).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(block('compare')).toBeNull();
      expect(screen.queryByRole('region', { name: 'So với món tương tự' })).toBeNull();
      expect(mocks.fetchCompare).toHaveBeenCalledTimes(1);
    });
  });
});
