import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REPURCHASE_DUE_DISMISS_STORAGE_KEY, resetRepurchaseDueMemoryForTest } from '@tubutree/app-core/refill/repurchase-due-card';

// Thẻ Mua lại hàng tiêu hao (Mini App, w36-01): cùng chữ, cùng luật ẩn với web RepurchaseDueCard.

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  snackbar: vi.fn(),
  coreGet: vi.fn(),
  addToCart: vi.fn(),
  track: vi.fn(),
  announce: vi.fn(),
  status: 'authenticated' as string,
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.snackbar }),
}));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../services/shop-api', () => ({ addToCart: mocks.addToCart }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../../lib/announce', () => ({ announce: mocks.announce }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../utils/cart-feedback', () => ({ playCartFeedback: vi.fn() }));

import RepurchaseDueCard from './repurchase-due-card';

const item = {
  key: 'o1:v-refill',
  days: 31,
  boughtName: 'Nước rửa chén Fuwa3e 500ml',
  kind: 'refill',
  variationId: 'v-refill',
  productId: 'p-refill',
  slug: 'refill-fuwa3e-1l',
  productName: 'Túi Refill nước rửa chén Fuwa3e 1L',
  variationName: '',
  thumbnail: null,
  price: 89_000,
  listPrice: 99_000,
};

function renderCard(surface: 'account' | 'cart_empty' = 'account') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <RepurchaseDueCard surface={surface} />
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetRepurchaseDueMemoryForTest();
  mocks.status = 'authenticated';
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === '/me/repurchase-due') return { item };
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.addToCart.mockResolvedValue({ items: [{ id: 'ci1' }] });
});

describe('RepurchaseDueCard (Mini App)', () => {
  it('có món: một vùng "Gợi ý mua lại", tiêu đề theo ngày, thân gói Refill, MỘT nút kèm giá, nút × có nhãn; ghi view một lần', async () => {
    renderCard();
    const region = await screen.findByRole('region', { name: 'Gợi ý mua lại' });
    expect(region.textContent).toContain('Đã 31 ngày từ khi bạn nhận Nước rửa chén Fuwa3e 500ml');
    expect(region.textContent).toContain('Châm lại bằng Túi Refill nước rửa chén Fuwa3e 1L, tiết kiệm hơn và bớt một chai nhựa.');
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ · 89.000đ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ẩn gợi ý này' })).toBeTruthy();
    expect(region.querySelectorAll('button')).toHaveLength(2);
    expect(mocks.coreGet).toHaveBeenCalledWith('/me/repurchase-due');
    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith('repurchase_due_view', 'miniapp', { surface: 'account', variationId: 'v-refill' }));
    expect(mocks.track.mock.calls.filter((c) => c[0] === 'repurchase_due_view')).toHaveLength(1);
  });

  it('thêm một chạm: đúng phân loại, số lượng 1, nguồn repurchase_due; chạm đúp một lệnh; báo "Đã thêm" kèm "Xem giỏ", thẻ biến mất', async () => {
    let resolve!: (v: unknown) => void;
    mocks.addToCart.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderCard();
    const add = await screen.findByRole('button', { name: 'Thêm vào giỏ · 89.000đ' });
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v-refill', 1, 'repurchase_due');
    await act(async () => resolve({ items: [{ id: 'ci1' }] }));
    await waitFor(() => expect(screen.queryByTestId('repurchase-due-card')).toBeNull());
    expect(mocks.track).toHaveBeenCalledWith('repurchase_due_add', 'miniapp', { surface: 'account', variationId: 'v-refill' });
    const snack = mocks.snackbar.mock.calls[0]![0] as { text: string; action?: { text: string; onClick: () => void } };
    expect(snack.text).toBe('Đã thêm');
    expect(snack.action?.text).toBe('Xem giỏ');
    snack.action!.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    expect(mocks.announce).toHaveBeenCalledWith('status', 'Đã thêm');
  });

  it('ở giỏ trống: báo "Đã thêm" không kèm lối "Xem giỏ" (giỏ tự hiện món)', async () => {
    renderCard('cart_empty');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ · 89.000đ' }));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalled());
    expect(mocks.snackbar.mock.calls[0]![0]).not.toHaveProperty('action');
    expect(mocks.track).toHaveBeenCalledWith('repurchase_due_add', 'miniapp', { surface: 'cart_empty', variationId: 'v-refill' });
  });

  it('× ẩn thẻ, ghi dismiss, nhớ khoá orderId:variationId vào localStorage: mở lại vẫn ẩn', async () => {
    const first = renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Ẩn gợi ý này' }));
    expect(screen.queryByTestId('repurchase-due-card')).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('repurchase_due_dismiss', 'miniapp', { surface: 'account', variationId: 'v-refill' });
    expect(Object.keys(JSON.parse(window.localStorage.getItem(REPURCHASE_DUE_DISMISS_STORAGE_KEY)!))).toEqual(['o1:v-refill']);
    first.unmount();
    resetRepurchaseDueMemoryForTest();
    renderCard();
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('repurchase-due-card')).toBeNull();
  });

  it('chưa đăng nhập: không gọi API, không vẽ', async () => {
    mocks.status = 'guest';
    const { container } = renderCard();
    await act(async () => undefined);
    expect(mocks.coreGet).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('cờ tắt (item null) hay lỗi mạng: không vẽ gì', async () => {
    mocks.coreGet.mockResolvedValueOnce({ item: null });
    const off = renderCard();
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalled());
    expect(off.container.innerHTML).toBe('');
    off.unmount();
    mocks.coreGet.mockRejectedValueOnce(new Error('offline'));
    const failed = renderCard();
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalledTimes(2));
    expect(failed.container.innerHTML).toBe('');
  });

  it('máy chủ từ chối (hết hàng): báo lỗi, thẻ còn để khách đọc lại', async () => {
    mocks.addToCart.mockRejectedValueOnce(Object.assign(new Error('Sản phẩm đã hết hàng'), { response: { status: 400, data: { message: 'Sản phẩm đã hết hàng' } } }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ · 89.000đ' }));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.track).not.toHaveBeenCalledWith('repurchase_due_add', expect.anything(), expect.anything());
  });
});
