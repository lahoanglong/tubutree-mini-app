import { useContext } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { QUICK_ADD_SOLD_OUT } from '@tubutree/app-core/quick-add';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  fetchFlash: vi.fn(),
  getCart: vi.fn(),
  notify: vi.fn(),
  login: vi.fn(),
  feedback: vi.fn(),
  auth: { status: 'authenticated' as string },
}));
vi.mock('../../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  addToCart: mocks.addToCart,
  fetchActiveFlashSales: mocks.fetchFlash,
  fetchFlashAllowance: async () => [],
  getCart: mocks.getCart,
}));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../utils/cart-feedback', () => ({ playCartFeedback: mocks.feedback }));
vi.mock('../../store/auth', () => ({
  useAuthStore: Object.assign((sel: (s: { status: string }) => unknown) => sel(mocks.auth), { getState: () => mocks.auth }),
}));
vi.mock('../variation-sheet', () => ({
  VariationSheet: (p: { open: boolean; busy?: boolean; variations: { id: string }[]; onConfirm: (v: { id: string }, qty: number) => Promise<void> | void; onClose: () => void }) =>
    p.open ? (
      <div data-testid="variation-sheet" data-busy={p.busy ? 'true' : 'false'}>
        <button type="button" onClick={() => void p.onConfirm(p.variations[1]!, 2)}>
          xác nhận phân loại
        </button>
        <button type="button" onClick={p.onClose}>
          đóng bảng
        </button>
      </div>
    ) : null,
}));

import { HttpError } from '../../services/http';
import { ProductCardQuickAddContext, QuickAddButton } from '../ui/product-card-quick-add';
import { HomeQuickAddProvider } from './home-quick-add';

const card = (n: number): ProductCardData => ({
  id: `p${n}`, slug: `mon-${n}`, brand: 'Tubu', name: `Món ${n}`, thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true,
});
const variation = (id: string, stock = 5) => ({ id, sku: id, name: `Loại ${id}`, attributes: {}, retailPrice: 50_000, salePrice: null, stock });
const detail = (n: number, variations = [variation(`v${n}`)]) => ({
  id: `p${n}`, slug: `mon-${n}`, brand: 'Tubu', name: `Món ${n}`, shortDesc: null, description: '', images: [], thumbnail: null,
  basePrice: 50_000, salePrice: null, certifications: [], ingredients: null, variations,
});

function Cards({ products }: { products: ProductCardData[] }) {
  const quickAdd = useContext(ProductCardQuickAddContext)!;
  return (
    <>
      {products.map((p) => (
        <QuickAddButton key={p.id} name={p.name} busy={quickAdd.busyId === p.id} onPress={(origin) => quickAdd.add(p, origin)} />
      ))}
    </>
  );
}

function renderHost(products = [card(1), card(2)]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <HomeQuickAddProvider>
        <Cards products={products} />
      </HomeQuickAddProvider>
    </QueryClientProvider>,
  );
  return { qc, invalidate, ...utils };
}
const plus = (n: number) => screen.getByRole('button', { name: `Thêm Món ${n} vào giỏ` });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.fetchProduct.mockImplementation(async (slug: string) => detail(Number(slug.split('-')[1])));
  mocks.fetchFlash.mockResolvedValue([]);
  mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  mocks.addToCart.mockResolvedValue({ items: [{ id: 'l1' }], itemCount: 1 });
  mocks.login.mockResolvedValue(undefined);
});

describe('HomeQuickAddProvider — nút ＋ trên thẻ', () => {
  it('món một phân loại còn hàng: thêm thẳng 1 cái, báo đã thêm, ghi giỏ vào cache và chạy hiệu ứng bay từ nút', async () => {
    const { qc } = renderHost();
    fireEvent.click(plus(1));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1);
    expect(mocks.fetchProduct).toHaveBeenCalledWith('mon-1');
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã thêm vào giỏ 🌿', type: 'success' })));
    expect(qc.getQueryData(['cart', null])).toEqual({ items: [{ id: 'l1' }], itemCount: 1 });
    expect(mocks.feedback).toHaveBeenCalledWith(plus(1));
    expect(screen.queryByTestId('variation-sheet')).toBeNull();
  });

  it('chạm đúp rất nhanh vào cùng một thẻ: chỉ MỘT lệnh thêm giỏ (khoá đồng bộ theo sản phẩm), thẻ báo bận tới khi xong', async () => {
    const detailGate = deferred<ReturnType<typeof detail>>();
    mocks.fetchProduct.mockReturnValue(detailGate.promise);
    renderHost();
    const btn = plus(1);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(plus(1)).toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(plus(1));
    detailGate.resolve(detail(1));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(plus(1)).toHaveAttribute('aria-busy', 'false'));
    expect(mocks.fetchProduct).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('hai thẻ khác nhau chạm sát nhau: mỗi thẻ một lệnh (khoá theo sản phẩm, không khoá chung)', async () => {
    renderHost();
    fireEvent.click(plus(1));
    fireEvent.click(plus(2));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    expect(mocks.addToCart.mock.calls.map((c) => c[0]).sort()).toEqual(['v1', 'v2']);
  });

  it('hết hàng khi chạm (tồn mới nhất về 0): báo hết hàng, KHÔNG thêm, tải lại các danh sách đang hiện tồn cũ', async () => {
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1', 0)]));
    const { invalidate } = renderHost();
    fireEvent.click(plus(1));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: QUICK_ADD_SOLD_OUT, type: 'error' }));
    expect(mocks.addToCart).not.toHaveBeenCalled();
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(['products', 'home-suggest']), JSON.stringify(['for-you'])]));
  });

  it('món từ hai phân loại: mở bảng chọn, chưa thêm gì; xác nhận mới thêm đúng phân loại và số lượng, rồi đóng bảng', async () => {
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1'), variation('v1b')]));
    renderHost();
    fireEvent.click(plus(1));
    expect(await screen.findByTestId('variation-sheet')).toBeInTheDocument();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'xác nhận phân loại' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1b', 2));
    await waitFor(() => expect(screen.queryByTestId('variation-sheet')).toBeNull());
  });

  it('đóng bảng chọn không thêm gì', async () => {
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1'), variation('v1b')]));
    renderHost();
    fireEvent.click(plus(1));
    fireEvent.click(await screen.findByRole('button', { name: 'đóng bảng' }));
    expect(screen.queryByTestId('variation-sheet')).toBeNull();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập: mời đăng nhập trước; vẫn chưa đăng nhập thì dừng, không tải chi tiết hay thêm giỏ', async () => {
    mocks.auth.status = 'guest';
    renderHost();
    fireEvent.click(plus(1));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(plus(1)).toHaveAttribute('aria-busy', 'false'));
    expect(mocks.fetchProduct).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập nhưng đăng nhập xong thì thêm tiếp luôn', async () => {
    mocks.auth.status = 'guest';
    mocks.login.mockImplementation(async () => {
      mocks.auth.status = 'authenticated';
    });
    renderHost();
    fireEvent.click(plus(1));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
  });

  it('đang khôi phục phiên (loading): chưa biết là ai nên im lặng, không mời đăng nhập, không gọi gì', async () => {
    mocks.auth.status = 'loading';
    renderHost();
    fireEvent.click(plus(1));
    await waitFor(() => expect(plus(1)).toHaveAttribute('aria-busy', 'false'));
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.fetchProduct).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('lỗi mạng khi thêm: báo lỗi và nhả khoá ngay để thử lại được', async () => {
    mocks.addToCart.mockRejectedValueOnce(new Error('offline'));
    renderHost();
    fireEvent.click(plus(1));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(plus(1)).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(plus(1));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
  });

  it('máy chủ từ chối (409): báo lỗi và tải lại danh sách để thẻ không còn nút ＋ trên tồn cũ', async () => {
    mocks.addToCart.mockRejectedValueOnce(new HttpError('Hết hàng', undefined, { status: 409, data: { message: 'Hết hàng' }, headers: {} }));
    const { invalidate } = renderHost();
    fireEvent.click(plus(1));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['products', 'home-suggest']));
  });
});
