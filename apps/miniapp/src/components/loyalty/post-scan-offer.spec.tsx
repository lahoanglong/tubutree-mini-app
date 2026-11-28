import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Thẻ gợi ý sau khi quét (Mini App, w55-01): cùng chữ và luật với web PostScanOffer.

const mocks = vi.hoisted(() => ({
  coreGet: vi.fn(),
  addToCart: vi.fn(),
  notify: vi.fn(),
  config: { loyalty: { vndPerPointRedeem: 1 } } as { loyalty?: { vndPerPointRedeem?: number } },
}));

vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../services/shop-api', () => ({ addToCart: mocks.addToCart }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.config }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../utils/cart-feedback', () => ({ playCartFeedback: vi.fn() }));

import PostScanOffer from './post-scan-offer';

const refill = (id: string, price: number) => ({
  productId: `p-${id}`, slug: `refill-${id}`, name: `Túi Refill ${id} 2L`, thumbnail: null, variationId: `v-${id}`, price, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true,
});
const bottle = (id: string) => ({ productId: `b-${id}`, slug: `chai-${id}`, name: `Nước rửa chén ${id} 500ml`, thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true });
const pair = (id: string, price: number) => ({ bottle: bottle(id), refill: refill(id, price), savingPct: 20 });

let landing: unknown;

function renderCard(points: number | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <PostScanOffer points={points} />
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config = { loyalty: { vndPerPointRedeem: 1 } };
  landing = { enabled: true, pairs: [pair('a', 200_000), pair('b', 230_000), pair('c', 250_000)] };
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === '/catalog/refill-pairs/landing') return landing;
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.addToCart.mockResolvedValue({ items: [{ id: 'ci1' }] });
});

describe('PostScanOffer (Mini App)', () => {
  it('đơn 199.000đ tích 0,2% = 398 điểm = 398đ (1 Điểm Xanh = 1đ): một dòng giá trị + đúng hai gói, mỗi gói một nút "Thêm"', async () => {
    renderCard(398);
    const region = await screen.findByRole('region', { name: 'Gợi ý sau khi tích điểm' });
    expect(within(region).getByTestId('post-scan-value')).toHaveTextContent('≈ 398đ giảm cho lần mua sau');
    const rows = await screen.findAllByTestId('post-scan-offer-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Túi Refill a 2L');
    expect(rows[0]).toHaveTextContent('200.000đ');
    expect(screen.getByRole('button', { name: 'Thêm Túi Refill a 2L vào giỏ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thêm Túi Refill b 2L vào giỏ' })).toBeTruthy();
    expect(screen.queryByText('Túi Refill c 2L')).toBeNull();
    expect(mocks.coreGet).toHaveBeenCalledWith('/catalog/refill-pairs/landing', { anonymous: true });
  });

  it('số đồng theo cấu hình đổi điểm: 299.000đ tích 0,2% = 598 điểm; cấu hình 100đ/điểm thì 59.800đ', async () => {
    mocks.config = { loyalty: { vndPerPointRedeem: 100 } };
    renderCard(598);
    expect(await screen.findByTestId('post-scan-value')).toHaveTextContent('≈ 59.800đ giảm cho lần mua sau');
  });

  it('thêm một chạm: đúng phân loại, số lượng 1; chạm đúp một lệnh; nút thành "Đã thêm" và khoá, báo thành công', async () => {
    let resolve!: (v: unknown) => void;
    mocks.addToCart.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderCard(398);
    const add = await screen.findByRole('button', { name: 'Thêm Túi Refill a 2L vào giỏ' });
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v-a', 1);
    await act(async () => resolve({ items: [{ id: 'ci1' }] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã thêm' })).toBeDisabled());
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(screen.getByRole('button', { name: 'Thêm Túi Refill b 2L vào giỏ' })).not.toBeDisabled();
  });

  it('máy chủ từ chối vì hết hàng: báo lỗi, nút còn để bấm lại, tải lại trang Refill', async () => {
    mocks.addToCart.mockRejectedValueOnce(Object.assign(new Error('Sản phẩm đã hết hàng'), { isHttpError: true, response: { status: 400, data: { message: 'Sản phẩm đã hết hàng' } } }));
    renderCard(398);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Túi Refill a 2L vào giỏ' }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(mocks.coreGet.mock.calls.filter((c) => c[0] === '/catalog/refill-pairs/landing').length).toBeGreaterThanOrEqual(2));
  });

  it('chưa có điểm (REVIEW, points null) vẫn có gói gợi ý nhưng không có dòng giá trị', async () => {
    renderCard(null);
    await screen.findAllByTestId('post-scan-offer-row');
    expect(screen.queryByTestId('post-scan-value')).toBeNull();
  });

  it('cờ Refill tắt hay lỗi mạng: chỉ còn dòng giá trị điểm, không có hàng gói', async () => {
    landing = { enabled: false, pairs: [] };
    const off = renderCard(398);
    expect(await screen.findByTestId('post-scan-value')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('post-scan-offer-row')).toBeNull());
    off.unmount();

    mocks.coreGet.mockRejectedValue(new Error('offline'));
    renderCard(398);
    expect(await screen.findByTestId('post-scan-value')).toBeTruthy();
    expect(screen.queryByTestId('post-scan-offer-row')).toBeNull();
  });

  it('không điểm và không gói để nói: không vẽ gì', async () => {
    landing = { enabled: false, pairs: [] };
    const { container } = renderCard(null);
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container.innerHTML).toBe('');
  });
});
