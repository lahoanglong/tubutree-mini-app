import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWishlist: vi.fn(),
  getCart: vi.fn(),
  snackbar: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/wishlist', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.snackbar }),
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  getCart: mocks.getCart,
  fetchActiveFlashSales: async () => [],
}));
vi.mock('../services/wishlist-api', () => ({ getWishlist: mocks.getWishlist }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, delete: mocks.del } }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../components/ui/product-card', () => ({
  ProductCard: ({ product, imageOverlay, note }: { product: { id: string; name: string }; imageOverlay?: ReactNode; note?: string }) => (
    <div data-testid="product-card" data-id={product.id}>
      <span>{product.name}</span>
      {note && <span data-testid="note">{note}</span>}
      {imageOverlay}
    </div>
  ),
}));

import WishlistPage from './wishlist';

const item = (id: string, name: string, inStock: boolean, rep?: string) => ({ id, slug: `sp-${id}`, name, basePrice: 100_000, salePrice: null, inStock, ...(rep ? { repVariationId: rep } : {}) });
const alert = (productId: string, variationId: string) => ({ variationId, productId, productSlug: `sp-${productId}`, productName: productId, variationName: 'Loại', stock: 0, createdAt: '2026-11-24T01:00:00.000Z' });

let server: { enabled: boolean; items: ReturnType<typeof alert>[] };

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WishlistPage />
    </QueryClientProvider>,
  );
}
const card = (id: string) => screen.getAllByTestId('product-card').find((n) => n.getAttribute('data-id') === id)!;
const bell = (name: string) => screen.getByRole('button', { name: `Báo khi ${name} có hàng` });
const chip = (label: string) => screen.queryByRole('button', { name: new RegExp(`^${label}`) });

beforeEach(() => {
  vi.clearAllMocks();
  server = { enabled: true, items: [alert('c', 'vC')] };
  mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  mocks.getWishlist.mockResolvedValue([item('a', 'Nước rửa chén', true, 'vA'), item('c', 'Dầu gội', false, 'vC'), item('d', 'Nước giặt', false, 'vD')]);
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/me/restock-alerts') return structuredClone(server);
    throw new Error(`GET lạ ${path}`);
  });
  mocks.post.mockImplementation(async (_path: string, body: { variationId: string }) => {
    const owner = body.variationId === 'vD' ? 'd' : 'c';
    server.items.push(alert(owner, body.variationId));
    return { variationId: body.variationId, subscribed: true };
  });
  mocks.del.mockImplementation(async (path: string) => {
    const id = decodeURIComponent(path.split('/').pop()!);
    server.items = server.items.filter((a) => a.variationId !== id);
    return { variationId: id, subscribed: false };
  });
});

describe('Yêu thích Mini: báo hàng về trên thẻ hết hàng (w24-03)', () => {
  it('một lần GET /me/restock-alerts cho cả trang; thẻ đang chờ có nhãn "Đang chờ hàng về" và chuông bật; thẻ còn hàng giữ nút giỏ nhanh', async () => {
    renderPage();
    expect(await screen.findByTestId('note')).toHaveTextContent('Đang chờ hàng về');
    expect(within(card('c')).getByTestId('note')).toBeInTheDocument();
    expect(within(card('d')).queryByTestId('note')).toBeNull();
    expect(bell('Dầu gội')).toHaveAttribute('aria-pressed', 'true');
    expect(bell('Nước giặt')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Báo khi Nước rửa chén có hàng' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Thêm Nước rửa chén vào giỏ' })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(chip('Chờ hàng về')!.textContent).toBe('Chờ hàng về(1)');
  });

  it('chuông cùng khuôn nút giỏ nhanh: vòng token, vùng chạm 44px qua tubu-hit-44-square', async () => {
    renderPage();
    await screen.findByTestId('note');
    for (const n of ['Dầu gội', 'Nước giặt']) {
      expect(bell(n)).toHaveClass('tubu-hit-44-square');
      expect(bell(n).style.width).toBe('var(--space-stack-xl)');
      expect(bell(n).style.height).toBe('var(--space-stack-xl)');
    }
  });

  it('vòng huỷ → đăng ký: một chạm huỷ (DELETE), nhãn và chip tắt; chạm lại đăng ký (POST phân loại đại diện), nhãn và chip về', async () => {
    renderPage();
    await screen.findByTestId('note');
    fireEvent.click(bell('Dầu gội'));
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/me/restock-alerts/vC'));
    await waitFor(() => expect(bell('Dầu gội')).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.queryByTestId('note')).toBeNull();
    expect(chip('Chờ hàng về')).toBeNull();
    expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã huỷ báo hàng về.', type: 'success' }));

    await waitFor(() => expect(bell('Dầu gội')).not.toHaveAttribute('aria-busy'));
    fireEvent.click(bell('Dầu gội'));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/me/restock-alerts', { variationId: 'vC' }));
    await waitFor(() => expect(bell('Dầu gội')).toHaveAttribute('aria-pressed', 'true'));
    expect(within(card('c')).getByTestId('note')).toHaveTextContent('Đang chờ hàng về');
    expect(chip('Chờ hàng về')!.textContent).toBe('Chờ hàng về(1)');
    expect(mocks.snackbar).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Có hàng Tubu sẽ báo bạn ở mục Thông báo.', type: 'success' }));
  });

  it('chạm chuông làm cũ danh sách đã mua: ô "Báo khi có" của kệ Mua lại ở Trang chủ không giữ trạng thái cũ', async () => {
    renderPage();
    await screen.findByTestId('note');
    qc.setQueryData(['purchased-items', 10], { items: [], nextCursor: null, restockAlertsEnabled: true });
    expect(qc.getQueryState(['purchased-items', 10])?.isInvalidated).toBe(false);
    fireEvent.click(bell('Dầu gội'));
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/me/restock-alerts/vC'));
    await waitFor(() => expect(qc.getQueryState(['purchased-items', 10])?.isInvalidated).toBe(true));
  });

  it('chip "Chờ hàng về" lọc đúng thẻ mang nhãn; huỷ món cuối thì chip mất và trang về Tất cả', async () => {
    renderPage();
    await screen.findByTestId('note');
    fireEvent.click(chip('Chờ hàng về')!);
    expect(screen.getAllByTestId('product-card').map((n) => n.getAttribute('data-id'))).toEqual(['c']);
    expect(chip('Chờ hàng về')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(bell('Dầu gội'));
    await waitFor(() => expect(chip('Chờ hàng về')).toBeNull());
    expect(chip('Tất cả')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('product-card')).toHaveLength(3);
  });

  // Lệnh xong trước không được tải lại danh sách khi lệnh kia chưa có trả lời: bản tải về chưa có thay đổi của thẻ kia và vẽ đè nó về trạng thái cũ.
  it.each([
    ['huỷ (Dầu gội) trả lời trước', 'del'],
    ['đăng ký (Nước giặt) trả lời trước', 'post'],
  ] as const)('chạm hai chuông sát nhau, %s: thẻ kia không nhấp nháy; tải lại một lần sau lệnh cuối', async (_label, first) => {
    const pending: Record<'del' | 'post', () => void> = { del: () => undefined, post: () => undefined };
    mocks.del.mockImplementationOnce(
      () =>
        new Promise((r) => {
          pending.del = () => {
            server.items = server.items.filter((a) => a.variationId !== 'vC');
            r({ variationId: 'vC', subscribed: false });
          };
        }),
    );
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((r) => {
          pending.post = () => {
            server.items.push(alert('d', 'vD'));
            r({ variationId: 'vD', subscribed: true });
          };
        }),
    );
    renderPage();
    await screen.findByTestId('note');
    fireEvent.click(bell('Dầu gội'));
    fireEvent.click(bell('Nước giặt'));
    await waitFor(() => expect(bell('Nước giặt')).toHaveAttribute('aria-pressed', 'true'));
    expect(bell('Dầu gội')).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(mocks.del).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const gets = mocks.get.mock.calls.length;

    pending[first]();
    await waitFor(() => expect(bell(first === 'del' ? 'Dầu gội' : 'Nước giặt')).not.toHaveAttribute('aria-busy'));
    await new Promise((r) => setTimeout(r, 20));
    expect(bell('Dầu gội')).toHaveAttribute('aria-pressed', 'false');
    expect(bell('Nước giặt')).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.get.mock.calls.length).toBe(gets);

    pending[first === 'del' ? 'post' : 'del']();
    await waitFor(() => expect(mocks.get.mock.calls.length).toBe(gets + 1));
    await waitFor(() => expect(bell('Nước giặt')).not.toHaveAttribute('aria-busy'));
    expect(bell('Dầu gội')).toHaveAttribute('aria-pressed', 'false');
    expect(bell('Nước giặt')).toHaveAttribute('aria-pressed', 'true');
  });

  describe('focus bàn phím khi huỷ trong chip "Chờ hàng về"', () => {
    const shownIds = () => screen.getAllByTestId('product-card').map((n) => n.getAttribute('data-id'));

    it('huỷ món không phải cuối: thẻ rời lưới, focus sang chuông của thẻ kế', async () => {
      server.items = [alert('c', 'vC'), alert('d', 'vD')];
      renderPage();
      await screen.findAllByTestId('note');
      fireEvent.click(chip('Chờ hàng về')!);
      expect(shownIds()).toEqual(['c', 'd']);
      bell('Dầu gội').focus();
      fireEvent.click(bell('Dầu gội'));
      await waitFor(() => expect(shownIds()).toEqual(['d']));
      await waitFor(() => expect(document.activeElement).toBe(bell('Nước giặt')));
    });

    it('huỷ món chờ cuối cùng: chip mất, bộ lọc về Tất cả và focus nằm ở chip Tất cả của thanh lọc', async () => {
      renderPage();
      await screen.findByTestId('note');
      fireEvent.click(chip('Chờ hàng về')!);
      bell('Dầu gội').focus();
      fireEvent.click(bell('Dầu gội'));
      await waitFor(() => expect(chip('Chờ hàng về')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(chip('Tất cả')));
      expect(chip('Tất cả')).toHaveAttribute('aria-pressed', 'true');
    });

    it('chuông không giữ focus lúc chạm: không kéo focus khỏi chỗ người dùng đang đứng', async () => {
      server.items = [alert('c', 'vC'), alert('d', 'vD')];
      renderPage();
      await screen.findAllByTestId('note');
      fireEvent.click(chip('Chờ hàng về')!);
      const all = chip('Tất cả')!;
      all.focus();
      fireEvent.click(bell('Dầu gội'));
      await waitFor(() => expect(shownIds()).toEqual(['d']));
      await new Promise((r) => setTimeout(r, 20));
      expect(document.activeElement).toBe(all);
    });
  });

  it('chạm đúp cùng một chuông chỉ gửi một lệnh', async () => {
    let release!: () => void;
    mocks.post.mockImplementationOnce(() => new Promise((r) => (release = () => r({ variationId: 'vD', subscribed: true }))));
    renderPage();
    await screen.findByTestId('note');
    fireEvent.click(bell('Nước giặt'));
    fireEvent.click(bell('Nước giặt'));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(bell('Nước giặt')).not.toHaveAttribute('aria-busy'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('máy chủ từ chối đăng ký: gỡ trạng thái vẽ trước, báo lỗi, tải lại danh sách yêu thích (món có thể đã có hàng)', async () => {
    const { HttpError } = await import('../services/http');
    const msg = 'Sản phẩm đang có hàng, bạn đặt mua được ngay.';
    mocks.post.mockRejectedValueOnce(new HttpError(msg, undefined, { status: 409, data: { message: msg } } as never));
    renderPage();
    await screen.findByTestId('note');
    const before = mocks.getWishlist.mock.calls.length;
    fireEvent.click(bell('Nước giặt'));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ text: msg, type: 'error' })));
    await waitFor(() => expect(bell('Nước giặt')).toHaveAttribute('aria-pressed', 'false'));
    expect(within(card('d')).queryByTestId('note')).toBeNull();
    await waitFor(() => expect(mocks.getWishlist.mock.calls.length).toBeGreaterThan(before));
  });

  it('cờ tắt: không chuông, không nhãn, không chip; danh sách không có món hết hàng thì không gọi API báo hàng về', async () => {
    server = { enabled: false, items: [] };
    const first = renderPage();
    await screen.findAllByTestId('product-card');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /^Báo khi/ })).toBeNull();
    expect(screen.queryByTestId('note')).toBeNull();
    expect(chip('Chờ hàng về')).toBeNull();
    first.unmount();

    mocks.get.mockClear();
    mocks.getWishlist.mockResolvedValue([item('a', 'Nước rửa chén', true, 'vA')]);
    renderPage();
    await screen.findAllByTestId('product-card');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
