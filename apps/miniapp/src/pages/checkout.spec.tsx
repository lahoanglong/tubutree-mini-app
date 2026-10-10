import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  getWallet: vi.fn(),
  getLoyalty: vi.fn(),
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
  getWallet: mocks.getWallet,
  getLoyalty: mocks.getLoyalty,
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
    mocks.getWallet.mockResolvedValue({ walletBalance: 0, coinsBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
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
    mocks.getWallet.mockResolvedValue({ walletBalance: 0, coinsBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
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

describe('CheckoutPage — Ví/TubuXu bị mờ phải nói lý do, số điểm có dấu nghìn (C-080)', () => {
  const BIG_QUOTE = { ...QUOTE, subtotal: 778_000, total: 798_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(BIG_QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 130_000, coinsBalance: 149_000 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  afterEach(() => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 0, coinsBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('số dư Ví Tubu và xu không đủ tổng đơn → hai dòng bị khoá, mỗi dòng có lý do + số tiền còn thiếu', async () => {
    renderPage();
    expect(await screen.findByText('Số dư chưa đủ — cần thêm 668.000đ')).toBeInTheDocument();
    expect(screen.getByText('Số dư chưa đủ — cần thêm 649.000 xu')).toBeInTheDocument();
    const wallet = screen.getByRole('radio', { name: /Ví Tubu/ });
    const xu = screen.getByRole('radio', { name: /TubuXu/ });
    expect(wallet).toHaveAttribute('aria-disabled', 'true');
    expect(xu).toHaveAttribute('aria-disabled', 'true');
  });

  it('số tiền trong nhãn có dấu nghìn: "TubuXu (149.000 xu)", "Ví Tubu (130.000đ)"', async () => {
    renderPage();
    expect(await screen.findByText('TubuXu (149.000 xu)')).toBeInTheDocument();
    expect(screen.getByText('Ví Tubu (130.000đ)')).toBeInTheDocument();
  });

  it('lý do KHÔNG bị làm mờ theo dòng (chữ phải đọc được): không có tổ tiên nào của lý do có opacity < 1', async () => {
    renderPage();
    const hint = await screen.findByText('Số dư chưa đủ — cần thêm 668.000đ');
    for (let el: HTMLElement | null = hint; el && el !== document.body; el = el.parentElement) {
      const o = el.style.opacity;
      expect(o === '' || Number(o) === 1).toBe(true);
    }
  });

  it('Ví đủ tiền, xu không đủ → chỉ dòng xu có lý do; Ví chọn được', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 900_000, coinsBalance: 149_000 });
    renderPage();
    expect(await screen.findByText('Số dư chưa đủ — cần thêm 649.000 xu')).toBeInTheDocument();
    expect(screen.queryByText(/cần thêm \d[\d.]*đ/)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ví Tubu/ })).toHaveAttribute('aria-disabled', 'false');
  });

  it('chưa có báo giá (chưa có địa chỉ) → chưa khoá, chưa có lý do', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Thêm địa chỉ mới');
    expect(screen.queryByText(/Số dư chưa đủ/)).not.toBeInTheDocument();
  });

  it('Điểm Xanh: "Dùng được 48/65.000 điểm" thay vì "48/65000"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 65_000, lockedPoints: 64_952, redeemablePoints: 48 });
    renderPage();
    expect(await screen.findByText('Dùng được 48/65.000 điểm')).toBeInTheDocument();
    expect(screen.getByText(/^64\.952 điểm từ đơn còn trong hạn/)).toBeInTheDocument();
  });

  it('bật dùng điểm: "Dùng 1.250 điểm — giảm 12.500đ"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 1250, lockedPoints: 0, redeemablePoints: 1250 });
    mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => ({
      ...BIG_QUOTE, pointsUsed: pts, pointsDiscount: pts * 10, total: 798_000 - pts * 10,
    }));
    renderPage();
    fireEvent.click(await screen.findByText('Bạn đang có 1.250 điểm'));
    expect(await screen.findByText('Dùng 1.250 điểm — giảm 12.500đ')).toBeInTheDocument();
  });

  it('điểm sẽ tích ≥ 1.000 có dấu nghìn ở thanh tóm tắt', async () => {
    mocks.checkoutQuote.mockResolvedValue({ ...BIG_QUOTE, pointsEarned: 1250 });
    renderPage();
    expect(await screen.findByText('+1.250 điểm Xanh khi giao thành công')).toBeInTheDocument();
  });
});
