import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getAddresses: vi.fn(),
  getCart: vi.fn(),
  checkoutQuote: vi.fn(),
  placeOrder: vi.fn(),
  recordReferralTouch: vi.fn(),
  ensurePhone: vi.fn(),
  requestZaloProfile: vi.fn(),
  user: { id: 'u1', fullName: 'Long', phone: '0900000000' as string | null, walletBalance: 0, coinsBalance: 0, pointsBalance: 0 },
  sfCtx: { slug: null as string | null, referralCode: null as string | null, kind: 'ctv' as const },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/checkout', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  getAddresses: mocks.getAddresses,
  getCart: mocks.getCart,
  checkoutQuote: mocks.checkoutQuote,
  placeOrder: mocks.placeOrder,
  createAddress: vi.fn(),
}));
vi.mock('../services/account-api', () => ({
  getWallet: vi.fn().mockResolvedValue({ walletBalance: 0, coinsBalance: 0 }),
  getLoyalty: vi.fn().mockResolvedValue({ pointsBalance: 0 }),
  updateAddress: vi.fn(),
}));
vi.mock('../services/affiliate-api', () => ({ recordReferralTouch: mocks.recordReferralTouch }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/zalo-profile', () => ({
  requestZaloProfile: mocks.requestZaloProfile,
  usableProfileName: (n?: string | null) => ((n ?? '').trim().toLowerCase() === 'khách' ? '' : (n ?? '').trim()),
}));
vi.mock('../store/auth', () => {
  const state = {
    get user() {
      return mocks.user;
    },
    status: 'authenticated',
    ensurePhone: mocks.ensurePhone,
    restore: vi.fn().mockResolvedValue(undefined),
  };
  const useAuthStore = Object.assign((sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state), {
    getState: () => state,
  });
  return { useAuthStore };
});
vi.mock('../store/storefront-context', () => ({ useStorefrontContext: () => mocks.sfCtx }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, recyclingEnabled: false }) }));
vi.mock('../components/checkout/voucher-sheet', () => ({ VoucherSheet: () => null }));
vi.mock('../components/checkout/order-success', () => ({ OrderSuccess: () => <div data-testid="order-success" /> }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import CheckoutPage from './checkout';

const ADDRESS = {
  id: 'a1', recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', province: 'TP. Hồ Chí Minh', provinceCode: '84_VN79',
  ward: 'Phường Bến Nghé', wardCode: '84_VN79_001', district: '', districtCode: '', isDefault: true,
};
const CART = {
  items: [
    { id: 'ci1', variationId: 'v1', productName: 'Xà bông thảo mộc', variationName: null, slug: 'xb', thumbnail: null, unitPrice: 50_000, quantity: 1, stock: 5, total: 50_000 },
  ],
  couponCode: null, subtotal: 50_000, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 1, unavailableItems: [],
};
const QUOTE = {
  subtotal: 50_000, discount: 0, comboDiscount: 0, tierDiscount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 20_000,
  total: 70_000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0, lockedPoints: 0, items: [],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CheckoutPage />
    </QueryClientProvider>,
  );
}

async function placeOrderClick() {
  const btn = await screen.findByText(/Đặt hàng · /);
  await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
  fireEvent.click(btn);
  await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
  return mocks.placeOrder.mock.calls[0]![0] as Record<string, unknown>;
}

describe('CheckoutPage — mã giới thiệu CTV (C-020)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    localStorage.clear();
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
  });

  it('có ô nhập mã giới thiệu; nhập mã hợp lệ rồi đặt hàng → placeOrder gửi kèm referralCode (đã chuẩn hoá HOA)', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    renderPage();
    fireEvent.click(await screen.findByText('Nhập mã'));
    fireEvent.change(screen.getByPlaceholderText('Nhập mã giới thiệu'), { target: { value: 'ab12cd34' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    await waitFor(() => expect(screen.getByText('AB12CD34')).toBeInTheDocument());

    const body = await placeOrderClick();
    expect(body.referralCode).toBe('AB12CD34');
  });

  it('không nhập gì và không có link giới thiệu → KHÔNG gửi referralCode (hành vi cũ giữ nguyên)', async () => {
    renderPage();
    const body = await placeOrderClick();
    expect(body.referralCode).toBeUndefined();
    expect(mocks.recordReferralTouch).not.toHaveBeenCalled();
  });

  it('mua qua link giới thiệu → hiện mã cố định, không có ô nhập, và vẫn gửi referralCode của link', async () => {
    mocks.sfCtx.referralCode = 'linkcode';
    renderPage();
    expect(await screen.findByText('LINKCODE')).toBeInTheDocument();
    expect(screen.queryByText('Nhập mã')).not.toBeInTheDocument();
    const body = await placeOrderClick();
    expect(body.referralCode).toBe('linkcode');
  });

  it('mã sai (server trả ok:false) → báo lỗi, đặt hàng vẫn không gửi mã sai', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: false });
    renderPage();
    fireEvent.click(await screen.findByText('Nhập mã'));
    fireEvent.change(screen.getByPlaceholderText('Nhập mã giới thiệu'), { target: { value: 'sai' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    expect(await screen.findByText(/Không tìm thấy mã này/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Huỷ'));
    const body = await placeOrderClick();
    expect(body.referralCode).toBeUndefined();
  });
});

describe('CheckoutPage — đơn đầu: xin tên + SĐT Zalo để điền sẵn địa chỉ (C-065)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Khách';
    mocks.user.phone = null;
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
  });

  it('chưa có địa chỉ → mở form thêm địa chỉ thì xin quyền Zalo 1 lần và điền sẵn tên + SĐT', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    mocks.requestZaloProfile.mockResolvedValue({ name: 'Lã Hoàng Long', phone: '0901234567' });
    renderPage();
    fireEvent.click(await screen.findByText('Thêm địa chỉ mới'));
    await waitFor(() => expect(screen.getByDisplayValue('Lã Hoàng Long')).toBeInTheDocument());
    expect(screen.getByDisplayValue('0901234567')).toBeInTheDocument();
    expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(1);
  });

  it('đã có địa chỉ (thêm địa chỉ thứ 2) → không tự xin quyền Zalo', async () => {
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    renderPage();
    fireEvent.click(await screen.findByText('Thêm địa chỉ mới'));
    await screen.findByText('Lưu');
    expect(mocks.requestZaloProfile).not.toHaveBeenCalled();
  });
});
