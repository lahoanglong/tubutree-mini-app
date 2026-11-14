import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), getCart: vi.fn(), status: 'authenticated' }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/product/xa-phong', search: '', state: null }),
}));
vi.mock('../services/shop-api', () => ({ getCart: mocks.getCart }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { CartButton } from './cart-button';
import { recordVisit, resetNavTrail } from '../lib/smart-nav';

/** `idx` đúng như react-router ghi vào `history.state`. */
const setIdx = (idx: number) => window.history.replaceState({ idx, key: `k${idx}`, usr: null }, '');

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CartButton /></QueryClientProvider>);
}

describe('CartButton + useCartCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    resetNavTrail();
    setIdx(0);
  });

  it('badge = itemCount của giỏ; nhãn a11y gồm số lượng; vùng chạm 44px; bấm → /cart', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 3 });
    renderButton();
    const btn = await screen.findByRole('button', { name: 'Giỏ hàng, 3 sản phẩm' });
    expect(btn).toHaveStyle({ width: '44px', height: '44px' });
    expect(screen.getByLabelText('3 sản phẩm trong giỏ')).toHaveTextContent('3');
    fireEvent.click(btn);
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('giỏ rỗng → nhãn đúng "Giỏ hàng" (e2e miniapp.spec dùng [aria-label="Giỏ hàng"])', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 0 });
    renderButton();
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });

  it('chưa đăng nhập → không gọi /cart (tránh 401 lúc restore chưa xong)', () => {
    mocks.status = 'loading';
    renderButton();
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });
});

describe('CartButton: đi tới Giỏ không chồng bản sao vào lịch sử (W163)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    mocks.getCart.mockResolvedValue({ itemCount: 0 });
    resetNavTrail();
    setIdx(0);
  });

  it('Giỏ → Sản phẩm → bấm giỏ: có vết /cart ở mục trước và idx hiện tại 2 ⇒ navigate(-1)', async () => {
    setIdx(1);
    recordVisit('/cart');
    setIdx(2);
    renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });

  it('không có vết /cart (trang trước là trang khác): đẩy /cart', async () => {
    setIdx(1);
    recordVisit('/browse');
    setIdx(2);
    renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('mở thẳng trang (idx 0): đẩy /cart', async () => {
    renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });
});
