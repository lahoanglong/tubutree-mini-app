import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  locState: null as unknown,
  voucherProps: [] as Record<string, unknown>[],
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
  getWasteMe: vi.fn(),
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } },
  user: { id: 'u1', fullName: 'Long', phone: '0900000000' as string | null, walletBalance: 0, pointsBalance: 0, pointsConvertedBalance: 0 },
  sfCtx: { slug: null as string | null, referralCode: null as string | null, kind: 'ctv' as 'ctv' | 'brand' },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/checkout', search: '', state: mocks.locState }),
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
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/waste-api', async (orig) => ({ ...(await orig<object>()), getWasteMe: mocks.getWasteMe }));
vi.mock('../components/checkout/voucher-sheet', () => ({
  VoucherSheet: (p: Record<string, unknown>) => {
    mocks.voucherProps.push(p);
    return null;
  },
}));
vi.mock('../components/checkout/order-success', () => ({ OrderSuccess: () => <div data-testid="order-success" /> }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/geo-api', () => ({
  getProvinces: vi.fn().mockResolvedValue([{ code: '84_VN79', name: 'TP. Hồ Chí Minh' }]),
  getCommunes: vi.fn().mockResolvedValue([]),
}));

import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';
import CheckoutPage, { attachablePickup } from './checkout';
import { makeRequestSummary, makeWasteMe } from '../services/waste-test-fixtures';
import { createQueryClient } from '../services/query-client';
import { vi as viCopy } from '../i18n/vi';

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
    mocks.publicConfig.waste.pickup = false;
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
    mocks.publicConfig.waste.pickup = false;
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
    mocks.publicConfig.waste.pickup = false;
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
    mocks.publicConfig.waste.pickup = false;
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

describe('CheckoutPage — mã giữ trong giỏ nhưng chưa áp (MONEY-3)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.slug = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getWallet.mockResolvedValue({ balance: 0 });
    mocks.getLoyalty.mockResolvedValue(null);
  });

  it('báo giá có couponNotice → hiện câu giải thích dưới chip mã, không hiện dòng giảm', async () => {
    const notice = 'Mã chưa được áp dụng cho đơn này (hàng giờ vàng không được tính vào điều kiện của mã): Đơn tối thiểu 150.000đ để dùng mã này.';
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'UAT50K', couponNotice: notice });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 0, couponNotice: notice });
    renderPage();
    const el = await screen.findByTestId('coupon-notice');
    expect(el.textContent).toBe(notice);
    expect(screen.getByText('UAT50K')).toBeTruthy();
  });

  it('mua một phần giỏ: giỏ (cả giỏ) giữ mã kèm lời báo nhưng báo giá của phần chọn áp được mã → không hiện lời báo của giỏ', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'SALE', discount: 0, couponNotice: 'Mã chưa được áp dụng cho đơn này (phần giảm combo không được tính vào điều kiện của mã): Đơn tối thiểu 95.000đ để dùng mã này.' });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 10_000, couponNotice: null });
    renderPage();
    await screen.findByText('SALE');
    await screen.findByText('Giảm giá');
    expect(screen.queryByTestId('coupon-notice')).toBeNull();
    expect(screen.queryByText(/chưa được áp dụng/)).toBeNull();
  });

  it('mã áp bình thường → không có câu giải thích', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'SALE', discount: 5000 });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 5000, couponNotice: null });
    renderPage();
    await screen.findByText('SALE');
    expect(screen.queryByTestId('coupon-notice')).toBeNull();
  });
});

describe('CheckoutPage — tóm tắt tạm khi chưa có địa chỉ: trừ combo như báo giá', () => {
  const TWO = {
    ...CART,
    items: [
      ...CART.items,
      { id: 'ci2', variationId: 'v2', productName: 'Dầu gội', variationName: null, slug: 'dg', thumbnail: null, unitPrice: 50_000, quantity: 1, stock: 5, total: 50_000 },
    ],
    subtotal: 100_000,
    couponCode: 'SALE',
    comboDiscount: 10_000,
    discount: 5_000,
  };
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.kind = 'ctv';
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.locState = null;
    mocks.voucherProps = [];
    mocks.getAddresses.mockResolvedValue([]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });
  afterEach(() => {
    mocks.locState = null;
  });

  it('mua cả giỏ: dòng "Giảm giá combo" và tổng = tiền hàng − combo − mã', async () => {
    mocks.getCart.mockResolvedValue(TWO);
    renderPage();
    expect(await screen.findByText('Giảm giá combo')).toBeInTheDocument();
    expect(screen.getByText('-10.000đ')).toBeInTheDocument();
    expect(screen.getByText('85.000đ')).toBeInTheDocument();
  });

  it('lựa chọn nhớ lại bằng đúng mọi dòng của giỏ: vẫn là cả giỏ, trừ combo', async () => {
    mocks.locState = { itemIds: ['ci1', 'ci2'] };
    mocks.getCart.mockResolvedValue(TWO);
    renderPage();
    expect(await screen.findByText('Giảm giá combo')).toBeInTheDocument();
    expect(screen.getByText('85.000đ')).toBeInTheDocument();
  });

  it('xem trước mã gửi cho máy chủ cả khi chưa có địa chỉ (không kèm addressId) để đủ điều kiện tính trên phần hàng sau combo', async () => {
    mocks.getCart.mockResolvedValue(TWO);
    renderPage();
    await screen.findByText('Giảm giá combo');
    const last = mocks.voucherProps[mocks.voucherProps.length - 1]!;
    expect(last.previewParams).toEqual({ storefrontSlug: undefined, itemIds: undefined });
    expect(last.previewParams).not.toHaveProperty('addressId');
  });

  it('mua một phần giỏ: không trừ combo cấp giỏ (máy chủ tính lại phần chọn)', async () => {
    mocks.locState = { itemIds: ['ci1'] };
    mocks.getCart.mockResolvedValue(TWO);
    renderPage();
    await screen.findAllByText('Xà bông thảo mộc');
    expect(screen.getByText('Cần chọn địa chỉ giao hàng')).toBeInTheDocument();
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
  });

  it('mua cả giỏ có giảm hạng: trừ cả hạng như giỏ và báo giá (100.000 − combo 10.000 − mã 5.000 − hạng 4.000)', async () => {
    mocks.getCart.mockResolvedValue({ ...TWO, tierDiscount: 4_000 });
    renderPage();
    expect(await screen.findByText('Ưu đãi hạng thành viên')).toBeInTheDocument();
    expect(screen.getByText('-4.000đ')).toBeInTheDocument();
    expect(screen.getByText('81.000đ')).toBeInTheDocument();
    expect(screen.queryByText('85.000đ')).toBeNull();
  });

  it('mua một phần giỏ: không trừ mã của cả giỏ khỏi tiền hàng phần chọn, nhắc tính lại ở bước thanh toán', async () => {
    mocks.locState = { itemIds: ['ci1'] };
    mocks.getCart.mockResolvedValue({ ...TWO, discount: 9_000, tierDiscount: 4_000 });
    renderPage();
    await screen.findByText('Cần chọn địa chỉ giao hàng');
    expect(screen.queryByText('-9.000đ')).toBeNull();
    expect(screen.queryByText('Giảm giá')).toBeNull();
    expect(screen.queryByText('Ưu đãi hạng thành viên')).toBeNull();
    expect(screen.queryByText('41.000đ')).toBeNull();
    expect(screen.getAllByText('50.000đ').length).toBeGreaterThan(0);
    expect(screen.getByText(/tính lại ở bước thanh toán/)).toBeInTheDocument();
  });

  it('không có combo (0 hoặc API cũ): tổng như cũ', async () => {
    mocks.getCart.mockResolvedValue({ ...TWO, comboDiscount: undefined });
    renderPage();
    await screen.findByText('Cần chọn địa chỉ giao hàng');
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
    expect(screen.getByText('95.000đ')).toBeInTheDocument();
  });
});

describe('CheckoutPage — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
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
    mocks.publicConfig.waste.pickup = false;
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

describe('CheckoutPage — tổng tiền đổi lúc đặt (PANCAKE-13) và địa chỉ địa giới cũ (PANCAKE-16)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('gửi kèm tổng khách đang thấy (expectedTotal = tổng báo giá)', async () => {
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    renderPage();
    const body = await placeOrderClick();
    expect(body.expectedTotal).toBe(70_000);
  });

  it('BE trả TOTAL_CHANGED → hiện sheet báo tổng mới (không snackbar), tải lại báo giá', async () => {
    const message = 'Tổng tiền đơn vừa thay đổi từ 70.000đ thành 75.000đ do giá hoặc phí giao vừa cập nhật. Vui lòng xem lại trước khi đặt.';
    const response = { status: 400, data: { statusCode: 400, code: 'TOTAL_CHANGED', message } } as AxiosResponse;
    mocks.placeOrder.mockRejectedValue(new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, response));
    renderPage();
    await placeOrderClick();
    expect(await screen.findByText('Tổng tiền đơn vừa thay đổi')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.checkoutQuote.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('địa chỉ đang chọn theo địa giới cũ → cảnh báo + nút Cập nhật địa chỉ mở form sửa đúng địa chỉ đó', async () => {
    mocks.getAddresses.mockResolvedValue([{ ...ADDRESS, provinceCode: '79', wardCode: '26734' }]);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('theo địa giới cũ');
    fireEvent.click(within(alert).getByText('Cập nhật địa chỉ'));
    await waitFor(() => expect(screen.queryByText(/theo địa giới cũ/)).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Ánh')).toBeInTheDocument();
  });

  it('địa chỉ hệ mới → không cảnh báo', async () => {
    renderPage();
    await screen.findByText('Phương thức thanh toán');
    expect(screen.queryByText(/theo địa giới cũ/)).not.toBeInTheDocument();
  });
});

const badRequest = (message: string) =>
  Object.assign(new Error(message), { isAxiosError: true, response: { status: 400, data: { message } } });

describe('CheckoutPage — hết hàng / vượt suất lúc đặt (BUYERMINI-18)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('đặt đơn bị từ chối vì không đủ tồn → banner cố định (không chỉ toast) có nút "Về giỏ hàng"', async () => {
    mocks.placeOrder.mockRejectedValue(badRequest('Sản phẩm "Xà bông thảo mộc" không đủ tồn kho.'));
    renderPage();
    await placeOrderClick();
    const banner = await screen.findByTestId('checkout-cart-issue');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(within(banner).getByText('Sản phẩm "Xà bông thảo mộc" không đủ tồn kho.')).toBeInTheDocument();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    fireEvent.click(within(banner).getByRole('button', { name: 'Về giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('giỏ đang có dòng vượt tồn → báo ngay và khoá nút Đặt hàng', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [{ ...CART.items[0]!, quantity: 3, stock: 1, total: 150_000 }] });
    renderPage();
    const banner = await screen.findByTestId('checkout-cart-issue');
    expect(within(banner).getByText('Sản phẩm "Xà bông thảo mộc" chỉ còn 1 sản phẩm. Vui lòng sửa số lượng trong giỏ.')).toBeInTheDocument();
    const btn = await screen.findByText(/Đặt hàng · /);
    expect(btn.closest('button')).toBeDisabled();
  });

  it('lỗi khác (không phải tồn kho) vẫn báo bằng thông báo nhanh như cũ', async () => {
    mocks.placeOrder.mockRejectedValue(badRequest('Mã giảm giá đã hết hạn.'));
    renderPage();
    await placeOrderClick();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mã giảm giá đã hết hạn.', type: 'error' }));
    expect(screen.queryByTestId('checkout-cart-issue')).toBeNull();
  });
});

describe('CheckoutPage — tách đơn theo nơi giao (D4)', () => {
  const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
  const SHOP = { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' };
  const BLOCK_REASON = 'Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.';
  const SPLIT_CART = {
    ...CART,
    items: [
      { ...CART.items[0]!, fulfiller: TUBU },
      { id: 'ci2', variationId: 'v2', productName: 'Mật ong rừng', variationName: null, slug: 'mat-ong', thumbnail: null, unitPrice: 200_000, quantity: 1, stock: 5, total: 200_000, fulfiller: SHOP },
    ],
    subtotal: 250_000,
  };
  const SPLIT_QUOTE = {
    ...QUOTE,
    subtotal: 250_000, shippingFee: 45_000, total: 295_000,
    shipments: [
      { key: 'TUBU', fulfiller: TUBU, itemIds: ['ci1'], subtotal: 50_000, discount: 0, shippingFee: 20_000, total: 70_000 },
      { key: 'MERCHANT:sf1', fulfiller: SHOP, itemIds: ['ci2'], subtotal: 200_000, discount: 0, shippingFee: 25_000, total: 225_000 },
    ],
    blockedPaymentMethods: { BANK_TRANSFER: BLOCK_REASON },
  };

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(SPLIT_CART);
    mocks.checkoutQuote.mockResolvedValue(SPLIT_QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('món chia theo nơi giao kèm phí giao từng kiện; báo sẽ thành 2 đơn riêng', async () => {
    renderPage();
    const tubu = await screen.findByRole('region', { name: 'Tubu Tree giao' });
    const shop = screen.getByRole('region', { name: 'Mật ong Linh giao' });
    expect(tubu.textContent).toContain('Xà bông thảo mộc');
    expect(tubu.textContent).toMatch(/Phí giao\s*20\.000đ/);
    expect(shop.textContent).toContain('Mật ong rừng');
    expect(shop.textContent).toMatch(/Phí giao\s*25\.000đ/);
    expect(screen.getByText(/sẽ thành 2 đơn riêng/)).toBeInTheDocument();
  });

  it('chuyển khoản bị máy chủ khoá: dòng bị vô hiệu kèm đúng lý do; đặt hàng gửi COD', async () => {
    renderPage();
    const bank = await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ });
    await waitFor(() => expect(bank).toHaveAttribute('aria-disabled', 'true'));
    expect(document.getElementById(bank.getAttribute('aria-describedby')!)!.textContent).toBe(BLOCK_REASON);
    fireEvent.click(bank);
    expect(bank).toHaveAttribute('aria-checked', 'false');
    const body = await placeOrderClick();
    expect(body.paymentMethod).toBe('COD');
  });

  it('R5-CHECKOUT-4: giỏ chỉ hàng gian hàng tự giao (một kiện) → nói gian hàng nào giao, không nói "1 nơi giao… 1 đơn riêng"', async () => {
    mocks.getCart.mockResolvedValue({ ...SPLIT_CART, items: [SPLIT_CART.items[1]!], subtotal: 200_000 });
    mocks.checkoutQuote.mockResolvedValue({ ...SPLIT_QUOTE, subtotal: 200_000, shippingFee: 25_000, total: 225_000, shipments: [SPLIT_QUOTE.shipments[1]!] });
    renderPage();
    const shop = await screen.findByRole('region', { name: 'Mật ong Linh giao' });
    expect(shop.textContent).toContain('Mật ong rừng');
    expect(screen.getByText('Đơn này do Mật ong Linh giao, phí giao theo gian hàng.')).toBeInTheDocument();
    expect(screen.queryByText(/nơi giao nên sẽ thành/)).toBeNull();
  });

  it('R5-CHECKOUT-6: giỏ đổi ở nơi khác sang hàng gian hàng tự giao, máy chủ từ chối cách thanh toán (PAYMENT_METHOD_NOT_ALLOWED) → tải lại cả giỏ, kiện mới có đủ món', async () => {
    const TUBU_QUOTE = {
      ...QUOTE,
      shipments: [{ key: 'TUBU', fulfiller: TUBU, itemIds: ['ci1'], subtotal: 50_000, discount: 0, shippingFee: 20_000, total: 70_000 }],
    };
    const SHOP_QUOTE = { ...SPLIT_QUOTE, subtotal: 200_000, shippingFee: 25_000, total: 225_000, shipments: [SPLIT_QUOTE.shipments[1]!] };
    let changed = false;
    mocks.getCart.mockImplementation(async () => (changed ? { ...SPLIT_CART, items: [SPLIT_CART.items[1]!], subtotal: 200_000 } : CART));
    mocks.checkoutQuote.mockImplementation(async () => (changed ? SHOP_QUOTE : TUBU_QUOTE));
    const response = { status: 400, data: { statusCode: 400, code: 'PAYMENT_METHOD_NOT_ALLOWED', message: BLOCK_REASON } } as AxiosResponse;
    mocks.placeOrder.mockRejectedValueOnce(new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, response));
    renderPage();
    const bank = await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ });
    await waitFor(() => expect(bank).not.toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(bank);
    await waitFor(() => expect(bank).toHaveAttribute('aria-checked', 'true'));

    changed = true;
    const body = await placeOrderClick();
    expect(body.paymentMethod).toBe('BANK_TRANSFER');
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: BLOCK_REASON, type: 'error' }));
    const shop = await screen.findByRole('region', { name: 'Mật ong Linh giao' });
    await waitFor(() => expect(shop.textContent).toContain('Mật ong rừng'));
    expect(screen.queryByText('Xà bông thảo mộc')).toBeNull();
  });

  it('giỏ toàn hàng Tubu: không chia nhóm, không báo tách đơn', async () => {
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue({
      ...QUOTE,
      shipments: [{ key: 'TUBU', fulfiller: TUBU, itemIds: ['ci1'], subtotal: 50_000, discount: 0, shippingFee: 20_000, total: 70_000 }],
    });
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByRole('region', { name: 'Tubu Tree giao' })).toBeNull();
    expect(screen.queryByText(/đơn riêng/)).toBeNull();
  });
});

describe('CheckoutPage — COD theo từng đơn, báo giá quyết định phương thức dùng được (R4-CHECKOUT-2)', () => {
  const COD_OVER =
    'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.000đ. Vui lòng chuyển khoản hoặc trả bằng Ví Tubu.';
  const COD_SPLIT_OVER =
    'Thanh toán khi nhận hàng (COD) chỉ nhận mỗi đơn tối đa 5.000.000đ, mà đơn do Tubu Tree giao là 5.400.000đ. Bạn có thể trả bằng Ví Tubu nếu số dư đủ, hoặc đặt riêng phần hàng Tubu Tree giao để chuyển khoản.';
  const SPLIT = 'Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.';
  const NONE = 'Đơn này chưa có cách thanh toán dùng được. Xem hướng dẫn dưới từng cách thanh toán ở trên.';
  const PICK = 'Chọn một cách thanh toán cho đơn này để đặt hàng.';
  const BOTH_BLOCKED = { ...QUOTE, total: 5_600_000, blockedPaymentMethods: { COD: COD_SPLIT_OVER, BANK_TRANSFER: SPLIT } };

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  const placeButton = async () => (await screen.findByText(/Đặt hàng · /)).closest('button')!;
  const describedBy = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby')!)!.textContent;

  it('COD bị khoá: dòng COD vô hiệu kèm đúng lý do máy chủ, tự chọn chuyển khoản, đặt hàng gửi BANK_TRANSFER', async () => {
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, total: 5_400_000, blockedPaymentMethods: { COD: COD_OVER } });
    renderPage();
    const cod = await screen.findByRole('radio', { name: /^Thanh toán khi nhận hàng/ });
    await waitFor(() => expect(cod).toHaveAttribute('aria-disabled', 'true'));
    expect(describedBy(cod)).toBe(COD_OVER);
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Chuyển khoản ngân hàng/ })).toHaveAttribute('aria-checked', 'true'));
    expect(cod).toHaveAttribute('aria-checked', 'false');
    const body = await placeOrderClick();
    expect(body.paymentMethod).toBe('BANK_TRANSFER');
  });

  it('máy chủ từ chối cách đang chọn lúc đặt (PAYMENT_METHOD_NOT_ALLOWED) → báo lỗi, tải lại báo giá, khoá COD và tự chọn chuyển khoản; đặt lại gửi BANK_TRANSFER (R7 review #4)', async () => {
    let blocked = false;
    mocks.checkoutQuote.mockImplementation(async () => (blocked ? { ...QUOTE, blockedPaymentMethods: { COD: COD_OVER } } : QUOTE));
    const response = { status: 400, data: { statusCode: 400, code: 'PAYMENT_METHOD_NOT_ALLOWED', message: COD_OVER } } as AxiosResponse;
    mocks.placeOrder
      .mockRejectedValueOnce(new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, response))
      .mockResolvedValue({ id: 'o1', code: 'TT001' });
    renderPage();
    const cod = await screen.findByRole('radio', { name: /^Thanh toán khi nhận hàng/ });
    await waitFor(() => expect(cod).toHaveAttribute('aria-checked', 'true'));

    blocked = true;
    const quotesBefore = mocks.checkoutQuote.mock.calls.length;
    const first = await placeOrderClick();
    expect(first.paymentMethod).toBe('COD');
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: COD_OVER, type: 'error' }));
    await waitFor(() => expect(mocks.checkoutQuote.mock.calls.length).toBeGreaterThan(quotesBefore));
    await waitFor(() => expect(cod).toHaveAttribute('aria-disabled', 'true'));
    expect(describedBy(cod)).toBe(COD_OVER);
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Chuyển khoản ngân hàng/ })).toHaveAttribute('aria-checked', 'true'));

    fireEvent.click(await placeButton());
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeOrder.mock.calls[1]![0]).toMatchObject({ paymentMethod: 'BANK_TRANSFER' });
  });

  it('COD và chuyển khoản đều khoá, Ví thiếu: không phương thức nào được chọn, nút đặt hàng khoá, nói rõ chưa có cách thanh toán', async () => {
    mocks.checkoutQuote.mockResolvedValue(BOTH_BLOCKED);
    renderPage();
    expect(await screen.findByText(NONE)).toBeInTheDocument();
    for (const name of [/^Thanh toán khi nhận hàng/, /^Chuyển khoản ngân hàng/, /^Ví Tubu/]) {
      const row = screen.getByRole('radio', { name });
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row).toHaveAttribute('aria-checked', 'false');
    }
    expect(await placeButton()).toBeDisabled();
    fireEvent.click(await placeButton());
    expect(mocks.placeOrder).not.toHaveBeenCalled();
  });

  it('COD và chuyển khoản đều khoá, Ví đủ: không tự trừ Ví, nhắc chọn; khách chọn Ví thì đặt được và gửi WALLET', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 9_000_000 });
    mocks.checkoutQuote.mockResolvedValue(BOTH_BLOCKED);
    renderPage();
    expect(await screen.findByText(PICK)).toBeInTheDocument();
    const wallet = screen.getByRole('radio', { name: /^Ví Tubu/ });
    expect(wallet).toHaveAttribute('aria-checked', 'false');
    expect(await placeButton()).toBeDisabled();
    fireEvent.click(wallet);
    await waitFor(() => expect(wallet).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByText(PICK)).toBeNull();
    const body = await placeOrderClick();
    expect(body.paymentMethod).toBe('WALLET');
  });
});

describe('CheckoutPage — bấm lại sau lỗi mạng không đặt đơn thứ hai (R2-MONEY-2)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  async function clickPlace(times: number) {
    const btn = await screen.findByText(/Đặt hàng · /);
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(times));
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
  }

  it('quá thời gian chờ rồi bấm lại cùng nội dung → gửi lại đúng Idempotency-Key cũ', async () => {
    mocks.placeOrder
      .mockRejectedValueOnce(new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED'))
      .mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    renderPage();
    await clickPlace(1);
    await clickPlace(2);
    const [k1, k2] = mocks.placeOrder.mock.calls.map((c) => c[1] as string);
    expect(k1).toBeTruthy();
    expect(k2).toBe(k1);
  });

  it('lỗi 5xx rồi bấm lại → cùng key; đổi cách thanh toán rồi bấm → key mới', async () => {
    const response = { status: 502, data: { message: 'Bad Gateway' } } as AxiosResponse;
    mocks.placeOrder.mockRejectedValue(new AxiosError('Bad Gateway', 'ERR_BAD_RESPONSE', undefined, undefined, response));
    renderPage();
    await clickPlace(1);
    await clickPlace(2);
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    // Khách tự đổi lựa chọn sau lần chưa rõ kết quả: lần bấm đầu chỉ nhắc kiểm tra Đơn hàng, lần sau mới đặt đơn mới.
    fireEvent.click(await screen.findByText(/Đặt hàng · /));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.', type: 'error' }));
    expect(mocks.placeOrder).toHaveBeenCalledTimes(2);
    await clickPlace(3);
    const keys = mocks.placeOrder.mock.calls.map((c) => c[1] as string);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('BE báo CART_CHANGED → báo khách và tải lại giỏ', async () => {
    const message = 'Giỏ hàng vừa thay đổi trong lúc đặt đơn. Vui lòng xem lại giỏ hàng và mục Đơn hàng trước khi đặt lại.';
    const response = { status: 400, data: { statusCode: 400, code: 'CART_CHANGED', message } } as AxiosResponse;
    mocks.placeOrder.mockRejectedValue(new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, response));
    renderPage();
    await clickPlace(1);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe('CheckoutPage — Điểm Xanh chỉ dùng cho hàng Tubu (Q8 S7)', () => {
  const NOTE = 'Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác';
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 300, redeemablePoints: 300 });
  });

  const pointsRow = async () => (await screen.findByText('Điểm Xanh', { selector: 'span, div, p' })).closest('[role="checkbox"]') as HTMLElement;

  it('giỏ có hàng của gian hàng đối tác: nêu trần điểm của đơn và câu giải thích, vẫn bật được', async () => {
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, pointsBalance: 300, redeemablePoints: 300, pointsMax: 12, pointsPartnerNote: NOTE });
    renderPage();
    expect(await screen.findByText('Đơn này dùng tối đa 12 Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    const row = await pointsRow();
    expect(row.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(row);
    await waitFor(() => expect(mocks.checkoutQuote.mock.calls.some((c) => c[1] === 300)).toBe(true));
  });

  it('R4-BUYER-2: giỏ chỉ hàng Tubu, trần của đơn thấp hơn số dư: nêu trần ngay khi chưa tick, tick xong ra đúng số thật', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 8013, redeemablePoints: 7972 });
    mocks.checkoutQuote.mockImplementation(async (_addr: string, pointsToUse: number) => ({
      ...QUOTE,
      pointsBalance: 8013,
      redeemablePoints: 7972,
      pointsMax: 42,
      pointsPartnerNote: null,
      pointsUsed: pointsToUse > 0 ? 42 : 0,
      pointsDiscount: pointsToUse > 0 ? 42_000 : 0,
    }));
    renderPage();
    expect(await screen.findByText('Đơn này dùng tối đa 42 Điểm Xanh, tính theo giá trị hàng của đơn')).toBeInTheDocument();
    expect(screen.getByText(/Dùng được 7\.972\/8\.013 điểm/)).toBeInTheDocument();
    fireEvent.click(await pointsRow());
    expect(await screen.findByText('Dùng 42 điểm — giảm 42.000đ')).toBeInTheDocument();
  });

  it('R4-BUYER-2: có điểm quy đổi mà đơn bị trần: vẫn nói phần không hết hạn nhưng không hứa "trả tới 100% giá trị hàng"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 1_000, lockedPoints: 0, redeemablePoints: 0 });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, pointsBalance: 1_000, redeemablePoints: 0, pointsMax: 42, pointsPartnerNote: null });
    renderPage();
    expect(await screen.findByText('Đơn này dùng tối đa 42 Điểm Xanh, tính theo giá trị hàng của đơn')).toBeInTheDocument();
    expect(screen.getByText('trong đó 1.000 điểm không hết hạn')).toBeInTheDocument();
    expect(screen.queryByText(/trả tới 100%/)).toBeNull();
  });

  it('R4-BUYER-2: trần của đơn không thấp hơn số điểm dùng được thì không thêm dòng trần', async () => {
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, pointsBalance: 300, redeemablePoints: 300, pointsMax: 300, pointsPartnerNote: null });
    renderPage();
    expect(await screen.findByText('Bạn đang có 300 điểm')).toBeInTheDocument();
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalled());
    expect(screen.queryByText(/Đơn này dùng tối đa/)).toBeNull();
  });

  it('giỏ chỉ hàng của gian hàng đối tác: ô Điểm Xanh bị tắt, kèm câu giải thích, không gửi điểm', async () => {
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, pointsBalance: 300, redeemablePoints: 300, pointsMax: 0, pointsPartnerNote: NOTE });
    renderPage();
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    const row = await pointsRow();
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.checkoutQuote.mock.calls.every((c) => c[1] === 0)).toBe(true);
  });
});

describe('CheckoutPage — mất mạng khi bấm Đặt hàng (R4-BUYER-1)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.unstubAllGlobals();
  });

  it('offline: yêu cầu đặt đơn vẫn được gửi, lỗi mạng hiện câu "mất mạng", nút bấm lại được và bật mạng lại không tự đặt thêm', async () => {
    const qc = createQueryClient();
    qc.setDefaultOptions({ ...qc.getDefaultOptions(), queries: { retry: false } });
    mocks.placeOrder.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
    render(
      <QueryClientProvider client={qc}>
        <CheckoutPage />
      </QueryClientProvider>,
    );
    const btn = await screen.findByText(/Đặt hàng · /);
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());

    onlineManager.setOnline(false);
    vi.stubGlobal('navigator', { ...window.navigator, onLine: false });
    fireEvent.click(btn);

    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: viCopy.errors.offline, type: 'error' }));
    expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());

    onlineManager.setOnline(true);
    await qc.resumePausedMutations();
    expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
  });
});

// R5-BUYER-5: giỏ rỗng (hoặc giỏ chưa tải xong) mà vẫn POST /checkout/quote thì máy chủ trả 400 và log đầy lỗi.
describe('CheckoutPage — không báo giá khi chưa có hàng (R5-BUYER-5)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('giỏ rỗng: hiện "Giỏ còn trống" và không gọi báo giá', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [], itemCount: 0, subtotal: 0 });
    renderPage();
    expect(await screen.findByText(viCopy.cart.emptyHeading)).toBeInTheDocument();
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalled());
    expect(mocks.checkoutQuote).not.toHaveBeenCalled();
  });

  it('địa chỉ về trước giỏ: chưa báo giá cho tới khi giỏ tải xong và có hàng', async () => {
    let resolveCart!: (v: typeof CART) => void;
    mocks.getCart.mockReturnValue(new Promise((r) => (resolveCart = r)));
    renderPage();
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.checkoutQuote).not.toHaveBeenCalled();

    resolveCart(CART);
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledTimes(1));
  });
});

describe('CheckoutPage — Thu kèm rác (§12.2 bước 2)', () => {
  const PICKUP_REQ = makeRequestSummary({ id: 'req-p', code: 'TR-PICK1', method: 'PICKUP', status: 'OPEN', orderCode: null, estimatedPoints: 12_000, pointName: 'Kho Tubu TP.HCM', lines: [{ itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 12 }] });
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
    mocks.publicConfig.waste.pickup = true;
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, openRequests: [PICKUP_REQ] }));
  });
  it('cờ pickup tắt → không có mục, không gọi /waste/me, body không có wasteRequestId', async () => {
    mocks.publicConfig.waste.pickup = false;
    renderPage();
    const body = await placeOrderClick();
    expect(document.querySelector('#checkout-waste-pickup')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Thu kèm rác' })).toBeNull();
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('wasteRequestId');
    expect(body).not.toHaveProperty('hasRecyclingPickup');
    expect(body).not.toHaveProperty('recyclingNote');
  });
  it('có yêu cầu PICKUP mở chưa gắn đơn → công tắc (mặc định tắt) + thẻ tóm tắt; không bật thì không gửi', async () => {
    renderPage();
    const toggle = await screen.findByRole('checkbox', { name: 'Thu kèm rác' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('TR-PICK1')).toBeInTheDocument();
    expect(screen.getByText('Thùng carton: 12 thùng')).toBeInTheDocument();
    expect(screen.getByText('Ước tính 12.000 điểm')).toBeInTheDocument();
    const PICKUP_NOTE = 'Ghi mã lên túi, bưu tá lấy khi giao đơn.';
    const PAYMENT_NOTE = 'Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.';
    fireEvent.click(await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    expect(screen.queryByText(PICKUP_NOTE)).toBeNull();
    expect(screen.queryByText(PAYMENT_NOTE)).toBeNull();
    const body = await placeOrderClick();
    expect(body).not.toHaveProperty('wasteRequestId');
    fireEvent.click(toggle);
    expect(screen.getByText(PICKUP_NOTE)).toBeInTheDocument();
    expect(screen.getByText(PAYMENT_NOTE)).toBeInTheDocument();
  });
  it('bật công tắc → body mang wasteRequestId, không mang hai trường cũ', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Thu kèm rác' }));
    const body = await placeOrderClick();
    expect(body.wasteRequestId).toBe('req-p');
    expect(body).not.toHaveProperty('hasRecyclingPickup');
  });
  it('chưa có yêu cầu → dòng dẫn tới màn Chọn món', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, openRequests: [] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Thu kèm rác/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new');
  });
  it('yêu cầu PICKUP đã gắn đơn khác không tính là gắn được', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ openRequests: [{ ...PICKUP_REQ, orderCode: 'TUBU999' }] }));
    renderPage();
    expect(await screen.findByRole('button', { name: /Thu kèm rác/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Thu kèm rác' })).toBeNull();
  });
  it.each([
    ['bị khoá', { blocked: true }],
    ['khoá đường kho', { shipLockedAt: '2026-10-01T00:00:00.000Z' }],
  ])('%s → không có mục Thu kèm rác', async (_n, over) => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ openRequests: [PICKUP_REQ], ...over }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    await waitFor(() => expect(mocks.getWasteMe).toHaveReturned());
    await act(async () => {});
    expect(document.querySelector('#checkout-waste-pickup')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Thu kèm rác' })).toBeNull();
  });
  it('attachablePickup: ẩn khi bị khoá, khoá đường kho hoặc cờ tắt; null khi chưa có yêu cầu', () => {
    expect(attachablePickup(makeWasteMe({ openRequests: [PICKUP_REQ], blocked: true }), true)).toBeUndefined();
    expect(attachablePickup(makeWasteMe({ openRequests: [PICKUP_REQ], shipLockedAt: '2026-10-01T00:00:00.000Z' }), true)).toBeUndefined();
    expect(attachablePickup(makeWasteMe({ openRequests: [] }), true)).toBeNull();
    expect(attachablePickup(makeWasteMe({ openRequests: [PICKUP_REQ] }), false)).toBeUndefined();
    expect(attachablePickup(undefined, true)).toBeUndefined();
    expect(attachablePickup(makeWasteMe({ openRequests: [PICKUP_REQ] }), true)?.id).toBe('req-p');
  });
  it.each([
    'Yêu cầu thu rác đã hết hạn hoặc đã huỷ',
    'Thu kèm rác đang tạm dừng với tài khoản của bạn, hãy tắt công tắc để đặt đơn',
  ])('409 "%s" hiện nguyên văn và tải lại /waste/me', async (msg) => {
    mocks.placeOrder.mockRejectedValue(Object.assign(new Error(msg), { isAxiosError: true, response: { status: 409, data: { message: msg } } }));
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Thu kèm rác' }));
    await placeOrderClick();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: msg })));
    await waitFor(() => expect(mocks.getWasteMe).toHaveBeenCalledTimes(2));
  });
  it('quá thời gian chờ khi đã bật công tắc → không tải lại /waste/me, để bấm lại gửi cùng body và cùng khoá', async () => {
    mocks.placeOrder.mockRejectedValueOnce(new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED'));
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Thu kèm rác' }));
    await placeOrderClick();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.getWasteMe).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/Đặt hàng · /).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(/Đặt hàng · /));
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeOrder.mock.calls[1]).toEqual(mocks.placeOrder.mock.calls[0]);
    expect((mocks.placeOrder.mock.calls[1]![0] as { wasteRequestId?: string }).wasteRequestId).toBe('req-p');
  });
  it('không còn chữ của khối Gomdon cũ', async () => {
    const { container } = renderPage();
    await screen.findByRole('checkbox', { name: 'Thu kèm rác' });
    expect(container.textContent).not.toMatch(/tái chế|quần áo cũ, pin|Thu gom tối đa/);
  });
});

describe('CheckoutPage — đóng băng yêu cầu sau lần đặt chưa rõ kết quả (không tạo đơn thứ hai)', () => {
  const COD_OVER = 'Đơn này vượt hạn mức COD, vui lòng chọn cách thanh toán khác.';
  const PREVIOUS = 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.';
  let qc: QueryClient;
  let cartData: typeof CART;

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    cartData = CART;
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockImplementation(async () => cartData);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });

  const mount = () =>
    render(
      <QueryClientProvider client={qc}>
        <CheckoutPage />
      </QueryClientProvider>,
    );
  const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK');
  const apiError = (status: number, code: string, message: string) =>
    new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, { status, data: { statusCode: status, code, message } } as AxiosResponse);
  async function click(times: number) {
    const btn = await screen.findByText(/Đặt hàng · /);
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(times));
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
  }

  it('lỗi mạng, ví/báo giá nạp lại làm phương thức tự đổi: bấm lại gửi đúng body và Idempotency-Key cũ', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    mount();
    await click(1);
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, total: 75_000, blockedPaymentMethods: { COD: COD_OVER } });
    await qc.invalidateQueries({ queryKey: ['quote'] });
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Chuyển khoản ngân hàng/ })).toHaveAttribute('aria-checked', 'true'));
    await click(2);
    expect(mocks.placeOrder.mock.calls[1]![0]).toEqual(mocks.placeOrder.mock.calls[0]![0]);
    expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
    expect(await screen.findByTestId('order-success')).toBeInTheDocument();
  });

  it('lỗi mạng rồi khách tự đổi phương thức: chặn một lần kèm lời nhắc kiểm tra Đơn hàng, bấm sau gửi đơn mới với key mới', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError()).mockResolvedValue({ id: 'o2', code: 'TT002' });
    mount();
    await click(1);
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    fireEvent.click(await screen.findByText(/Đặt hàng · /));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: PREVIOUS, type: 'error' }));
    expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
    await click(2);
    const [first, second] = mocks.placeOrder.mock.calls;
    expect(second![1]).not.toBe(first![1]);
    expect(second![0]).toMatchObject({ paymentMethod: 'BANK_TRANSFER' });
  });

  it('lỗi mạng rồi khách chạm lại đúng phương thức đang chọn: không mở băng, bấm lại gửi đúng body và key cũ, không báo PREVIOUS', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    mount();
    await click(1);
    const selected = within(paymentBox()).getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')!;
    fireEvent.click(selected);
    await click(2);
    expect(mocks.placeOrder.mock.calls[1]![0]).toEqual(mocks.placeOrder.mock.calls[0]![0]);
    expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith({ text: PREVIOUS, type: 'error' });
  });

  it('lỗi mạng: khối báo cố định nói đơn có thể đã được ghi nhận và có lối sang Đơn của tôi', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError());
    mount();
    await click(1);
    const notice = await screen.findByTestId('place-notice');
    expect(notice).toHaveTextContent('Đơn có thể đã được ghi nhận. Bấm Đặt hàng lần nữa để thử lại');
    fireEvent.click(within(notice).getByRole('button', { name: 'Đơn của tôi' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/orders');
  });

  it('chặn PREVIOUS: khối báo cố định nói bấm lần nữa sẽ đặt đơn mới, có lối sang Đơn của tôi', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError());
    mount();
    await click(1);
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    fireEvent.click(await screen.findByText(/Đặt hàng · /));
    const notice = await screen.findByTestId('place-notice');
    await waitFor(() => expect(notice).toHaveTextContent('bấm Đặt hàng lần nữa để đặt đơn mới với lựa chọn hiện tại'));
    expect(within(notice).getByRole('button', { name: 'Đơn của tôi' })).toBeInTheDocument();
  });

  it('đặt thành công sau lần chưa rõ kết quả: hết đóng băng, màn thành công hiện', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    mount();
    await click(1);
    await click(2);
    expect(await screen.findByTestId('order-success')).toBeInTheDocument();
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith({ text: PREVIOUS, type: 'error' });
  });

  it('lỗi nghiệp vụ rõ (4xx có mã) khi gửi lại: hết đóng băng, đổi lựa chọn rồi đặt không bị chặn', async () => {
    mocks.placeOrder
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(apiError(400, 'TOTAL_CHANGED', 'Tổng đơn đã thay đổi.'))
      .mockResolvedValue({ id: 'o3', code: 'TT003' });
    mount();
    await click(1);
    await click(2);
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    await click(3);
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith({ text: PREVIOUS, type: 'error' });
    expect(mocks.placeOrder.mock.calls[2]![0]).toMatchObject({ paymentMethod: 'BANK_TRANSFER' });
  });

  it('401 khi gửi lại không nói gì về đơn trước: giữ đóng băng, lần sau vẫn gửi đúng body và key cũ', async () => {
    mocks.placeOrder
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(apiError(401, 'UNAUTHORIZED', 'Hết phiên'))
      .mockResolvedValue({ id: 'o1', code: 'TT001' });
    mount();
    await click(1);
    await click(2);
    await click(3);
    const keys = mocks.placeOrder.mock.calls.map((c) => c[1] as string);
    expect(keys[2]).toBe(keys[0]);
    expect(mocks.placeOrder.mock.calls[2]![0]).toEqual(mocks.placeOrder.mock.calls[0]![0]);
  });

  it('giỏ nạp lại thành rỗng sau lỗi mạng: hiện "Đơn của bạn có thể đã được tạo", Kiểm tra lại gửi đúng body và key cũ', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    mount();
    await click(1);
    cartData = { ...CART, items: [], itemCount: 0, subtotal: 0 };
    await qc.invalidateQueries({ queryKey: ['cart'] });
    expect(await screen.findByText('Đơn của bạn có thể đã được tạo')).toBeInTheDocument();
    expect(screen.queryByText(viCopy.cart.emptyHeading)).toBeNull();
    fireEvent.click(screen.getByText('Kiểm tra lại'));
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeOrder.mock.calls[1]![0]).toEqual(mocks.placeOrder.mock.calls[0]![0]);
    expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
    expect(await screen.findByTestId('order-success')).toBeInTheDocument();
  });
});
