import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  user: { id: 'u1', fullName: 'Long', phone: '0900000000' as string | null, walletBalance: 0, pointsBalance: 0, pointsConvertedBalance: 0 },
  sfCtx: { slug: null as string | null, referralCode: null as string | null, kind: 'ctv' as 'ctv' | 'brand' },
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

import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';
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

/** Khối "Phương thức thanh toán" (địa chỉ giao hàng cũng dùng role radio nên không quét cả trang). */
function paymentBox(): HTMLElement {
  return screen.getByText('Phương thức thanh toán').parentElement as HTMLElement;
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
    mocks.sfCtx.kind = 'ctv';
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    localStorage.clear();
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
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

  it('sản phẩm chưa có ảnh: dòng hàng hiện khung placeholder như giỏ hàng, không dựng img với src rỗng (BUYERMINI-13)', async () => {
    const { container } = renderPage();
    const name = await screen.findByText('Xà bông thảo mộc');
    const row = name.closest('div')!.parentElement as HTMLElement;
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img[alt="Xà bông thảo mộc"]')).toBeNull();
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

  it('đang xem trang nhãn (slug nhãn, không có mã CTV) → KHÔNG hiện chip giả, vẫn nhập được mã và gửi mã đó', async () => {
    mocks.sfCtx.slug = 'tubu-co';
    mocks.sfCtx.kind = 'brand';
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    renderPage();
    expect(await screen.findByText('Nhập mã')).toBeInTheDocument();
    expect(screen.queryByText('TUBU-CO')).not.toBeInTheDocument();
    expect(screen.queryByText(/mua qua link giới thiệu/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Nhập mã'));
    fireEvent.change(screen.getByPlaceholderText('Nhập mã giới thiệu'), { target: { value: 'ab12cd34' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    await waitFor(() => expect(screen.getByText('AB12CD34')).toBeInTheDocument());
    const body = await placeOrderClick();
    expect(body.referralCode).toBe('AB12CD34');
  });

  it('slug gian hàng không phải CTV (referralCode rỗng, kind ctv) cũng không bị coi là mã giới thiệu', async () => {
    mocks.sfCtx.slug = 'cua-hang-x';
    mocks.sfCtx.referralCode = null;
    renderPage();
    expect(await screen.findByText('Nhập mã')).toBeInTheDocument();
    expect(screen.queryByText('CUA-HANG-X')).not.toBeInTheDocument();
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
    mocks.sfCtx.kind = 'ctv';
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Khách';
    mocks.user.phone = null;
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
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

describe('CheckoutPage — Ví bị mờ phải nói lý do, số điểm có dấu nghìn (C-080)', () => {
  const BIG_QUOTE = { ...QUOTE, subtotal: 778_000, total: 798_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.kind = 'ctv';
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(BIG_QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 130_000 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  afterEach(() => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('số dư Ví Tubu không đủ tổng đơn → dòng Ví bị khoá, có lý do + số tiền còn thiếu', async () => {
    renderPage();
    expect(await screen.findByText('Số dư chưa đủ — cần thêm 668.000đ')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ví Tubu/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('chỉ còn ba cách thanh toán: COD, chuyển khoản, Ví Tubu — không có TubuXu (Q-26, PD-3)', async () => {
    renderPage();
    await screen.findByText('Ví Tubu (130.000đ)');
    expect(within(paymentBox()).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Thanh toán khi nhận hàng (COD)',
      'Chuyển khoản ngân hàng',
      expect.stringMatching(/^Ví Tubu \(130\.000đ\)/),
    ]);
    expect(screen.queryByRole('radio', { name: /TubuXu/ })).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/TubuXu|(?<![\p{L}_])xu(?![\p{L}_])/iu);
  });

  it('số tiền trong nhãn có dấu nghìn: "Ví Tubu (130.000đ)"', async () => {
    renderPage();
    expect(await screen.findByText('Ví Tubu (130.000đ)')).toBeInTheDocument();
  });

  it('lý do KHÔNG bị làm mờ theo dòng (chữ phải đọc được): không có tổ tiên nào của lý do có opacity < 1', async () => {
    renderPage();
    const hint = await screen.findByText('Số dư chưa đủ — cần thêm 668.000đ');
    for (let el: HTMLElement | null = hint; el && el !== document.body; el = el.parentElement) {
      const o = el.style.opacity;
      expect(o === '' || Number(o) === 1).toBe(true);
    }
  });

  it('Ví đủ tiền → không có lý do, Ví chọn được', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 900_000 });
    renderPage();
    expect(await screen.findByText('Ví Tubu (900.000đ)')).toBeInTheDocument();
    expect(screen.queryByText(/cần thêm/)).not.toBeInTheDocument();
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
    expect(await screen.findByText('Nhận +1.250 Điểm Xanh khi giao thành công')).toBeInTheDocument();
  });
});

describe('CheckoutPage — Điểm Xanh hai lô và đơn 0đ (PD-3)', () => {
  const BIG_QUOTE = { ...QUOTE, subtotal: 500_000, total: 520_000, pointsEarned: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.kind = 'ctv';
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(BIG_QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('chỉ có điểm quy đổi: nói rõ phần không hết hạn, bật dùng điểm → gửi cả số dư quy đổi làm pointsToUse', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 1_000, lockedPoints: 0, redeemablePoints: 0 });
    mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => ({
      ...BIG_QUOTE, pointsUsed: pts, pointsUsedConverted: pts, pointsDiscount: pts * 1_000, total: 520_000 - pts * 1_000,
    }));
    renderPage();
    expect(await screen.findByText('Bạn đang có 1.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('trong đó 1.000 điểm không hết hạn, trả tới 100% giá trị hàng')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Bạn đang có 1.000 điểm'));
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledWith('a1', 1_000, undefined, undefined));
    expect(await screen.findByText('Dùng 1.000 điểm — giảm 1.000.000đ')).toBeInTheDocument();
  });

  it('lô thường bị khoá một phần + có lô quy đổi: pointsToUse = phần thường dùng được + toàn bộ lô quy đổi', async () => {
    mocks.getLoyalty.mockResolvedValue({
      pointsBalance: 500, pointsConvertedBalance: 100, lockedPoints: 300, redeemablePoints: 200,
    });
    renderPage();
    expect(await screen.findByText('Dùng được 300/600 điểm')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dùng được 300/600 điểm'));
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledWith('a1', 300, undefined, undefined));
  });

  it('không có điểm quy đổi: không hiện dòng "không hết hạn"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 120, lockedPoints: 0, redeemablePoints: 120 });
    renderPage();
    await screen.findByText('Bạn đang có 120 điểm');
    expect(screen.queryByText(/không hết hạn/)).toBeNull();
  });

  it('chưa tải overview điểm: lấy lô thường + lô quy đổi từ hồ sơ đăng nhập', async () => {
    mocks.getLoyalty.mockReturnValue(new Promise(() => {}));
    Object.assign(mocks.user, { pointsBalance: 40, pointsConvertedBalance: 60 });
    renderPage();
    expect(await screen.findByText('Bạn đang có 100 điểm')).toBeInTheDocument();
    Object.assign(mocks.user, { pointsBalance: 0, pointsConvertedBalance: 0 });
  });

  it('điểm sẽ tích hiện cho mọi cách thanh toán: không còn ngoại lệ "TubuXu không tích điểm"', async () => {
    mocks.checkoutQuote.mockResolvedValue({ ...BIG_QUOTE, pointsEarned: 520 });
    renderPage();
    expect(await screen.findByText('Nhận +520 Điểm Xanh khi giao thành công')).toBeInTheDocument();
  });

  describe('đơn 0đ (điểm phủ hết hàng + freeship)', () => {
    const ZERO = { ...QUOTE, subtotal: 50_000, pointsUsed: 50, pointsUsedConverted: 50, pointsDiscount: 50_000, shippingFee: 0, total: 0 };

    it('ẩn lựa chọn phương thức thanh toán, ghi "Đơn đã được trả đủ bằng Điểm Xanh"', async () => {
      mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 50, redeemablePoints: 0 });
      mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => (pts > 0 ? ZERO : QUOTE));
      renderPage();
      fireEvent.click(await screen.findByText('Bạn đang có 50 điểm'));
      expect(await screen.findByText('Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm.')).toBeInTheDocument();
      expect(within(paymentBox()).queryAllByRole('radio')).toHaveLength(0);
    });

    it('đã chọn chuyển khoản rồi mới dùng điểm phủ hết đơn → gửi COD, KHÔNG sang màn QR chuyển khoản 0đ', async () => {
      mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 50, redeemablePoints: 0 });
      mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => (pts > 0 ? ZERO : QUOTE));
      renderPage();
      fireEvent.click(await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
      fireEvent.click(await screen.findByText('Bạn đang có 50 điểm'));
      await screen.findByText(/Đơn đã được trả đủ bằng Điểm Xanh/);
      const body = await placeOrderClick();
      expect(body.paymentMethod).toBe('COD');
      expect(mocks.navigate).not.toHaveBeenCalledWith(expect.stringContaining('/bank-payment'), expect.anything());
    });

    it('review C2: đơn 0đ gửi cờ quotedZeroTotal để BE từ chối nếu lúc đặt tổng không còn 0đ (không tạo COD khách không chọn)', async () => {
      mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 50, redeemablePoints: 0 });
      mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => (pts > 0 ? ZERO : QUOTE));
      renderPage();
      fireEvent.click(await screen.findByText('Bạn đang có 50 điểm'));
      await screen.findByText(/Đơn đã được trả đủ bằng Điểm Xanh/);
      const body = await placeOrderClick();
      expect(body.paymentMethod).toBe('COD');
      expect(body.quotedZeroTotal).toBe(true);
    });

    it('review C2: đơn có tiền phải trả KHÔNG gửi cờ quotedZeroTotal', async () => {
      renderPage();
      const body = await placeOrderClick();
      expect(body).not.toHaveProperty('quotedZeroTotal');
    });

    it('0đ nhờ mã giảm giá (không dùng điểm) → không nói sai là trả bằng Điểm Xanh', async () => {
      mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, subtotal: 20_000, shippingFee: 0, total: 0, pointsDiscount: 0 });
      renderPage();
      expect(await screen.findByText('Đơn không còn số tiền cần thanh toán.')).toBeInTheDocument();
      expect(screen.queryByText(/trả đủ bằng Điểm Xanh/)).toBeNull();
    });
  });
});

describe('CheckoutPage — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.kind = 'ctv';
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('hàng "Mã giảm giá" cao tối thiểu 44px (trước đây 38px)', async () => {
    renderPage();
    const row = (await screen.findByText('Mã giảm giá')).closest('.tubu-press') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.minHeight).toBe('44px');
  });

  it('báo giá lỗi → "Thử lại" có vùng chạm 44px và bấm là tải lại báo giá', async () => {
    mocks.checkoutQuote.mockRejectedValueOnce(new Error('Mạng lỗi'));
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(retry.className).toContain('tubu-hit-44');
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledTimes(2));
  });
});

describe('CheckoutPage — hàng chọn không chứa phần tử focus được lồng bên trong (axe nested-interactive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.kind = 'ctv';
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('phương thức thanh toán, Điểm Xanh, hoá đơn VAT: mỗi hàng role radio/checkbox là điều khiển duy nhất, chấm chọn bên trong không focus được', async () => {
    const { container } = renderPage();
    await screen.findByText('Phương thức thanh toán');
    const rows = container.querySelectorAll('[role="radio"], [role="checkbox"]');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });

  it('bấm chấm chọn bên trong hàng vẫn chọn đúng một lần (click nổi lên hàng cha, không bắn đôi)', async () => {
    renderPage();
    const box = await waitFor(() => paymentBox());
    const rows = within(box).getAllByRole('radio');
    const second = rows.find((r) => r.getAttribute('aria-checked') === 'false')!;
    fireEvent.click(second.querySelector('input')!);
    await waitFor(() => expect(second).toHaveAttribute('aria-checked', 'true'));
    expect(within(box).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });
});
