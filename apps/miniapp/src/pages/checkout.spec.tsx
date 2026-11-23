import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { HttpError } from '../services/http';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  locState: null as unknown,
  voucherProps: [] as Record<string, unknown>[],
  openSnackbar: vi.fn(),
  getAddresses: vi.fn(),
  createAddress: vi.fn(),
  getCommunes: vi.fn(),
  getCart: vi.fn(),
  checkoutQuote: vi.fn(),
  placeOrder: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
  recordReferralTouch: vi.fn(),
  ensurePhone: vi.fn(),
  ensurePhoneOrThrow: vi.fn(),
  shipEstimate: vi.fn((_base: number | null): { estimate: unknown; stale: boolean } => ({ estimate: undefined, stale: false })),
  requestZaloProfile: vi.fn(),
  getWallet: vi.fn(),
  getLoyalty: vi.fn(),
  getCouponPreviews: vi.fn(),
  applyCoupon: vi.fn(),
  removeCoupon: vi.fn(),
  getCoupons: vi.fn().mockResolvedValue([]),
  getCheckoutPickupOptions: vi.fn(),
  coreGet: vi.fn(),
  getBankQr: vi.fn(),
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false }, orderZaloEnabled: false as boolean },
  user: { id: 'u1', fullName: 'Long', phone: '0900000000' as string | null, walletBalance: 0, pointsBalance: 0, pointsConvertedBalance: 0 },
  sfCtx: { slug: null as string | null, referralCode: null as string | null, kind: 'ctv' as 'ctv' | 'brand', referralEligible: null as boolean | null },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => <div data-testid="page" data-page-style={JSON.stringify(style ?? {})}>{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/checkout', search: '', state: mocks.locState }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  getAddresses: mocks.getAddresses,
  getCart: mocks.getCart,
  checkoutQuote: mocks.checkoutQuote,
  placeOrder: mocks.placeOrder,
  updateCartItem: mocks.updateCartItem,
  removeCartItem: mocks.removeCartItem,
  getCouponPreviews: mocks.getCouponPreviews,
  applyCoupon: mocks.applyCoupon,
  removeCoupon: mocks.removeCoupon,
  createAddress: mocks.createAddress,
  getCheckoutPickupOptions: mocks.getCheckoutPickupOptions,
}));
vi.mock('../services/account-api', () => ({
  getWallet: mocks.getWallet,
  getLoyalty: mocks.getLoyalty,
  getCoupons: mocks.getCoupons,
  updateAddress: vi.fn(),
}));
vi.mock('../components/policy-sheet', () => ({
  PolicySheet: ({ slug }: { slug: string | null }) => (slug ? <div data-testid="policy-sheet">{slug}</div> : null),
}));
vi.mock('../services/affiliate-api', () => ({ recordReferralTouch: mocks.recordReferralTouch }));
vi.mock('../services/analytics', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/zalo-profile', () => ({
  requestZaloProfile: mocks.requestZaloProfile,
  usableProfileName: (n?: string | null) => ((n ?? '').trim().toLowerCase() === 'khách' ? '' : (n ?? '').trim()),
}));
vi.mock('../components/checkout/use-shipping-estimate', () => ({ useShippingEstimate: mocks.shipEstimate }));
vi.mock('../store/auth', () => {
  const state = {
    get user() {
      return mocks.user;
    },
    status: 'authenticated',
    ensurePhone: mocks.ensurePhone,
    ensurePhoneOrThrow: mocks.ensurePhoneOrThrow,
    restore: vi.fn().mockResolvedValue(undefined),
  };
  const useAuthStore = Object.assign((sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state), {
    getState: () => state,
  });
  return { useAuthStore };
});
vi.mock('../store/storefront-context', () => ({
  useStorefrontContext: Object.assign(
    (sel?: (s: typeof mocks.sfCtx) => unknown) => (sel ? sel(mocks.sfCtx) : mocks.sfCtx),
    { getState: () => mocks.sfCtx },
  ),
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: (...a: unknown[]) => mocks.coreGet(...a), patch: vi.fn() } }));
vi.mock('../components/checkout/voucher-sheet', () => ({
  VoucherSheet: (p: Record<string, unknown>) => {
    mocks.voucherProps.push(p);
    return null;
  },
}));
vi.mock('../services/payment-api', () => ({ getBankQr: (...a: unknown[]) => mocks.getBankQr(...a) }));
vi.mock('../components/checkout/order-success', () => ({ OrderSuccess: () => <div data-testid="order-success" /> }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/geo-api', () => ({
  getProvinces: vi.fn().mockResolvedValue([{ code: '84_VN79', name: 'TP. Hồ Chí Minh' }]),
  getCommunes: (...args: unknown[]) => mocks.getCommunes(...args) ?? Promise.resolve([]),
}));

import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';
import CheckoutPage from './checkout';
import { recallCheckoutSelection, rememberCheckoutSelection } from '../utils/checkout-selection';
import { createQueryClient } from '../services/query-client';
import { COUPON_CHANGE_KEY } from '../components/checkout/use-coupon-hint';
import { ORDER_ZALO_KEY } from '../components/checkout/order-zalo';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import { vi as viCopy } from '../i18n/vi';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { setCheckoutEntry, takeCheckoutEntry, trackEvent } from '../services/analytics';

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
  total: 70_000, pointsEarned: 0, pointsBalance: 0, pointsMax: 1_000_000, redeemablePoints: 0, lockedPoints: 0, items: [],
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
  const btn = await screen.findByText(/(Đặt hàng|Thử lại) · /);
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
    mocks.sfCtx.referralEligible = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
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
    fireEvent.change(screen.getByPlaceholderText('Nhập mã người giới thiệu'), { target: { value: 'ab12cd34' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    await waitFor(() => expect(screen.getByText('AB12CD34')).toBeInTheDocument());

    const body = await placeOrderClick();
    expect(body.referralCode).toBe('AB12CD34');
  });

  it('đơn đang gửi → nút Nhập mã của ô mã giới thiệu bị khoá, không đổi mã giữa chừng (W59B)', async () => {
    mocks.placeOrder.mockReturnValue(new Promise(() => {}));
    renderPage();
    const trigger = (await screen.findByText('Nhập mã')).closest('button')!;
    expect(trigger).toBeEnabled();

    const place = await screen.findByText(/(Đặt hàng|Thử lại) · /);
    await waitFor(() => expect(place.closest('button')).not.toBeDisabled());
    fireEvent.click(place);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trigger).toBeDisabled());
  });

  it('chạm Đặt hàng không mở tấm xin số điện thoại: gửi đơn ngay (địa chỉ đã có số người nhận)', async () => {
    mocks.ensurePhone.mockReturnValue(new Promise(() => {}));
    mocks.user.phone = null;
    renderPage();
    const place = await screen.findByText(/(Đặt hàng|Thử lại) · /);
    await waitFor(() => expect(place.closest('button')).not.toBeDisabled());
    fireEvent.click(place);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
    expect(mocks.ensurePhone).not.toHaveBeenCalled();
    expect(mocks.ensurePhoneOrThrow).not.toHaveBeenCalled();
  });

  it('đặt đơn xong: nhớ có Việc cần làm cho lần mở Trang chủ sau (khung chờ giữ chỗ từ khung hình đầu)', async () => {
    renderPage();
    await placeOrderClick();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tubu_home_todo_rows') ?? 'null')).toEqual({ userId: 'u1', rows: 1 }));
  });

  it('dòng đồng ý điều khoản nằm trong nội dung trang ngay trên thanh Đặt hàng (không làm thanh cao thêm), năm link mở popup chính sách trong app, không có ô tick', async () => {
    renderPage();
    const line = await screen.findByTestId('order-consent');
    expect(line.textContent).toBe('Bằng việc đặt hàng, bạn đồng ý với: Điều khoản, Bảo mật, Đổi trả, Vận chuyển, Thanh toán.');
    expect(screen.getByTestId('sticky-bar')).not.toContainElement(line);
    expect(line.compareDocumentPosition(screen.getByTestId('sticky-bar')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(line).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(line).getByRole('button', { name: 'Điều khoản' }));
    expect(screen.getByTestId('policy-sheet')).toHaveTextContent('dieu-khoan');
    fireEvent.click(within(line).getByRole('button', { name: 'Chính sách đổi trả' }));
    expect(screen.getByTestId('policy-sheet')).toHaveTextContent('doi-tra');
    for (const [name, slug] of [
      ['Chính sách bảo mật', 'bao-mat'],
      ['Chính sách vận chuyển', 'van-chuyen'],
      ['Chính sách thanh toán', 'thanh-toan'],
    ]) {
      fireEvent.click(within(line).getByRole('button', { name }));
      expect(screen.getByTestId('policy-sheet')).toHaveTextContent(slug!);
    }
  });

  it('đáy trang chừa chỗ cho thanh Đặt hàng cộng vùng an toàn (không để dòng đồng ý nằm dưới thanh)', async () => {
    renderPage();
    await screen.findByTestId('sticky-bar');
    expect(JSON.parse(screen.getByTestId('page').dataset.pageStyle ?? '{}').paddingBottom).toBe('calc(96px + var(--safe-bottom))');
  });

  it('sản phẩm chưa có ảnh: dòng hàng hiện khung placeholder như giỏ hàng, không dựng img với src rỗng (BUYERMINI-13)', async () => {
    const { container } = renderPage();
    const name = await screen.findByText('Xà bông thảo mộc');
    const row = name.parentElement!.parentElement as HTMLElement;
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

  it.each([
    ['MST chi nhánh dán có dấu chấm', '0312.345.678-001', '0312345678-001'],
    ['CCCD dán có khoảng trắng', '001 234 567 890', '001234567890'],
  ])('hoá đơn VAT: %s vẫn gửi đúng (ô không cắt chuỗi thô trước khi chuẩn hoá)', async (_n, pasted, sent) => {
    renderPage();
    await screen.findByText(/(Đặt hàng|Thử lại) · /);
    fireEvent.click(screen.getByText('Yêu cầu xuất hoá đơn VAT'));
    const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    const tax = input('Mã số thuế');
    // Trình duyệt cắt chuỗi dán theo maxLength của ô.
    fireEvent.change(tax, { target: { value: tax.maxLength > 0 ? pasted.slice(0, tax.maxLength) : pasted } });
    fireEvent.change(input('Tên công ty'), { target: { value: 'Cty A' } });
    fireEvent.change(input('Địa chỉ xuất hoá đơn'), { target: { value: '1 Lê Lợi' } });
    fireEvent.change(input('Email nhận hoá đơn'), { target: { value: 'a@b.vn' } });
    const body = await placeOrderClick();
    expect((body.invoiceRequest as { taxCode: string }).taxCode).toBe(sent);
  });

  it('mua qua link giới thiệu của CTV thật (đã xác nhận) → hiện mã cố định, không có ô nhập, và vẫn gửi referralCode của link', async () => {
    mocks.sfCtx.referralCode = 'linkcode';
    mocks.sfCtx.referralEligible = true;
    renderPage();
    expect(await screen.findByText('LINKCODE')).toBeInTheDocument();
    expect(screen.getByText('Bạn đang mua qua link giới thiệu')).toBeInTheDocument();
    expect(screen.queryByText('Nhập mã')).not.toBeInTheDocument();
    const body = await placeOrderClick();
    expect(body.referralCode).toBe('linkcode');
  });

  it('mã từ link là của khách thường (máy chủ bỏ qua, referralEligible=false) → không khoá ô nhập, không nói "mua qua link giới thiệu", đơn không gửi mã đó', async () => {
    mocks.sfCtx.referralCode = 'KHACH01';
    mocks.sfCtx.referralEligible = false;
    renderPage();
    expect(await screen.findByText('Nhập mã')).toBeInTheDocument();
    expect(screen.queryByText('KHACH01')).not.toBeInTheDocument();
    expect(screen.queryByText('Bạn đang mua qua link giới thiệu')).not.toBeInTheDocument();
    const body = await placeOrderClick();
    expect(body.referralCode).toBeUndefined();
  });

  it('mã từ link chưa biết có phải của CTV không (null): ô nhập mở sẵn cho khách, đơn vẫn gửi mã để máy chủ quyết', async () => {
    mocks.sfCtx.referralCode = 'linkcode';
    mocks.sfCtx.referralEligible = null;
    renderPage();
    expect(await screen.findByText('Nhập mã')).toBeInTheDocument();
    expect(screen.queryByText('Bạn đang mua qua link giới thiệu')).not.toBeInTheDocument();
    const body = await placeOrderClick();
    expect(body.referralCode).toBe('linkcode');
  });

  it('mã link của khách thường nhưng khách tự nhập mã CTV thật → gửi mã khách nhập', async () => {
    mocks.sfCtx.referralCode = 'KHACH01';
    mocks.sfCtx.referralEligible = false;
    mocks.recordReferralTouch.mockResolvedValue({ ok: true });
    renderPage();
    fireEvent.click(await screen.findByText('Nhập mã'));
    fireEvent.change(screen.getByPlaceholderText('Nhập mã người giới thiệu'), { target: { value: 'ctv0001' } });
    fireEvent.click(screen.getByText('Áp dụng'));
    await waitFor(() => expect(screen.getByText('CTV0001')).toBeInTheDocument());
    const body = await placeOrderClick();
    expect(body.referralCode).toBe('CTV0001');
  });

  it('mã sai (server trả ok:false) → báo lỗi, đặt hàng vẫn không gửi mã sai', async () => {
    mocks.recordReferralTouch.mockResolvedValue({ ok: false });
    renderPage();
    fireEvent.click(await screen.findByText('Nhập mã'));
    fireEvent.change(screen.getByPlaceholderText('Nhập mã người giới thiệu'), { target: { value: 'sai' } });
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
    fireEvent.change(screen.getByPlaceholderText('Nhập mã người giới thiệu'), { target: { value: 'ab12cd34' } });
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

  it('chưa có địa chỉ → form mở sẵn nhưng không tự bật tấm xin quyền Zalo; khách bấm lấy từ Zalo thì xin 1 lần và điền sẵn SĐT', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    mocks.requestZaloProfile.mockResolvedValue({ name: 'Lã Hoàng Long', phone: '0901234567' });
    renderPage();
    await screen.findByText('Lưu');
    expect(mocks.requestZaloProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Điền nhanh từ Zalo|Dùng số Zalo của tôi/ }));
    await waitFor(() => expect(screen.getByDisplayValue('0901234567')).toBeInTheDocument());
    expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(1);
  });

  it('đã có địa chỉ (thêm địa chỉ thứ 2) → không tự xin quyền Zalo', async () => {
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
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

  it('Ví đang âm (hoa hồng đơn trả bị thu hồi) → dòng Ví vẫn hiện, bị khoá, lý do nói rõ số âm và cách xử lý', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: -50_000 });
    renderPage();
    expect(await screen.findByText('Ví Tubu (-50.000đ)')).toBeInTheDocument();
    expect(await screen.findByText(/Số dư Ví Tubu đang âm 50\.000đ do thu hồi hoa hồng đơn trả hàng/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ví Tubu/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('chỉ còn ba cách thanh toán: COD, chuyển khoản, Ví Tubu — không có TubuXu (Q-26, PD-3)', async () => {
    renderPage();
    await screen.findByText('Ví Tubu (130.000đ)');
    // Chữ nhìn thấy gồm cả dòng phụ dưới tên; tên đọc của radio vẫn chỉ là tên cách thanh toán.
    expect(within(paymentBox()).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      `Thanh toán khi nhận hàng (COD)${fillCopy('checkout.payCueCod')}`,
      `Chuyển khoản ngân hàng${fillCopy('checkout.payCueBank')}`,
      expect.stringMatching(/^Ví Tubu \(130\.000đ\)/),
    ]);
    expect(within(paymentBox()).getByRole('radio', { name: 'Thanh toán khi nhận hàng (COD)' })).toBeInTheDocument();
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

  it('Điểm Xanh: "Dùng 48 điểm, giảm 48đ" thay vì "48/65000"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 65_000, lockedPoints: 64_952, redeemablePoints: 48 });
    renderPage();
    expect(await screen.findByText('Dùng 48 điểm, giảm 48đ')).toBeInTheDocument();
    expect(screen.getByText(/^64\.952 điểm từ đơn còn trong hạn/)).toBeInTheDocument();
  });

  it('bật dùng điểm: "Dùng 1.250 điểm, giảm 12.500đ"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 1250, lockedPoints: 0, redeemablePoints: 1250 });
    mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => ({
      ...BIG_QUOTE, pointsUsed: pts, pointsDiscount: pts * 10, total: 798_000 - pts * 10,
    }));
    renderPage();
    fireEvent.click(await screen.findByText('Dùng 1.250 điểm, giảm 1.250đ'));
    expect(await screen.findByText('Dùng 1.250 điểm, giảm 12.500đ')).toBeInTheDocument();
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
    expect(await screen.findByText('Dùng 1.000 điểm, giảm 1.000đ')).toBeInTheDocument();
    expect(screen.getByText('trong đó 1.000 điểm không hết hạn, trả tới 100% giá trị hàng')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dùng 1.000 điểm, giảm 1.000đ'));
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledWith('a1', 1_000, undefined, undefined, {}));
    expect(await screen.findByText('Dùng 1.000 điểm, giảm 1.000.000đ')).toBeInTheDocument();
  });

  it('lô thường bị khoá một phần + có lô quy đổi: pointsToUse = phần thường dùng được + toàn bộ lô quy đổi', async () => {
    mocks.getLoyalty.mockResolvedValue({
      pointsBalance: 500, pointsConvertedBalance: 100, lockedPoints: 300, redeemablePoints: 200,
    });
    renderPage();
    expect(await screen.findByText('Dùng 300 điểm, giảm 300đ')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dùng 300 điểm, giảm 300đ'));
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledWith('a1', 300, undefined, undefined, {}));
  });

  it('không có điểm quy đổi: không hiện dòng "không hết hạn"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 120, lockedPoints: 0, redeemablePoints: 120 });
    renderPage();
    await screen.findByText('Dùng 120 điểm, giảm 120đ');
    expect(screen.queryByText(/không hết hạn/)).toBeNull();
  });

  it('chưa tải overview điểm: lấy lô thường + lô quy đổi từ hồ sơ đăng nhập', async () => {
    mocks.getLoyalty.mockReturnValue(new Promise(() => {}));
    Object.assign(mocks.user, { pointsBalance: 40, pointsConvertedBalance: 60 });
    renderPage();
    expect(await screen.findByText('Dùng 100 điểm, giảm 100đ')).toBeInTheDocument();
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
      fireEvent.click(await screen.findByText('Dùng 50 điểm, giảm 50đ'));
      expect(await screen.findByText('Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm.')).toBeInTheDocument();
      expect(within(paymentBox()).queryAllByRole('radio')).toHaveLength(0);
    });

    it('đã chọn chuyển khoản rồi mới dùng điểm phủ hết đơn → gửi COD, KHÔNG sang màn QR chuyển khoản 0đ', async () => {
      mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 50, redeemablePoints: 0 });
      mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => (pts > 0 ? ZERO : QUOTE));
      renderPage();
      fireEvent.click(await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
      fireEvent.click(await screen.findByText('Dùng 50 điểm, giảm 50đ'));
      await screen.findByText(/Đơn đã được trả đủ bằng Điểm Xanh/);
      const body = await placeOrderClick();
      expect(body.paymentMethod).toBe('COD');
      expect(mocks.navigate).not.toHaveBeenCalledWith(expect.stringContaining('/bank-payment'), expect.anything());
    });

    it('review C2: đơn 0đ gửi cờ quotedZeroTotal để BE từ chối nếu lúc đặt tổng không còn 0đ (không tạo COD khách không chọn)', async () => {
      mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 50, redeemablePoints: 0 });
      mocks.checkoutQuote.mockImplementation(async (_a: string, pts: number) => (pts > 0 ? ZERO : QUOTE));
      renderPage();
      fireEvent.click(await screen.findByText('Dùng 50 điểm, giảm 50đ'));
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

  it('W28: báo giá có couponShortfall (thiếu đơn tối thiểu) → câu giải thích nói luôn cần mua thêm bao nhiêu', async () => {
    const notice = 'Mã chưa được áp dụng cho đơn này: Đơn tối thiểu 400.000đ để dùng mã này.';
    // Máy chủ trả số thiếu ở cả giỏ lẫn báo giá (cùng một phép tính), nên lúc giỏ về trước báo giá lời báo đã có số.
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'UAT50K', couponNotice: notice, couponShortfall: 100_000 });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 0, couponNotice: notice, couponShortfall: 100_000 });
    renderPage();
    const el = await screen.findByTestId('coupon-notice');
    expect(el.textContent).toBe(`${notice} Mua thêm 100.000đ để áp mã UAT50K.`);
  });

  it('W28: mã chưa áp vì lý do khác (không có số thiếu) → giữ nguyên câu của máy chủ, không nói mua thêm', async () => {
    const notice = 'Mã chưa được áp dụng cho đơn này: Bạn đã dùng hết lượt cho mã này.';
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'UAT50K', couponNotice: notice });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 0, couponNotice: notice });
    renderPage();
    expect((await screen.findByTestId('coupon-notice')).textContent).toBe(notice);
  });

  it('W28: máy chủ vừa gỡ mã vì giỏ rơi dưới đơn tối thiểu → thanh toán nói mã nào bị gỡ và cần mua thêm bao nhiêu, bấm Đóng thì mất', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: null, couponRemoved: { code: 'MIN400', reason: 'Đơn tối thiểu 400.000đ để dùng mã này.', shortfall: 100_000 } });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 0, couponNotice: null });
    renderPage();
    const note = await screen.findByTestId('coupon-removed-notice');
    expect(note).toHaveTextContent('Đã gỡ mã MIN400 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 100.000đ để dùng lại.');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng lời báo mã MIN400 đã gỡ' }));
    await waitFor(() => expect(screen.queryByTestId('coupon-removed-notice')).toBeNull());
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

  it('mã dài (trên 15 ký tự): pill xuống dòng trong pill, đủ ký tự, không "…"; khoảng cách dùng token', async () => {
    const long = 'KHUYENMAI-THANG-MUOI-MOT-VIP-2026';
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: long, discount: 5000 });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 5000, couponNotice: null });
    renderPage();
    const code = await screen.findByTestId('coupon-code');
    expect(code.textContent).toBe(long);
    expect(code.style.overflowWrap).toBe('anywhere');
    expect(code.style.maxWidth).toBe('100%');
    expect(code.style.textOverflow).toBe('');
    expect(code.style.whiteSpace).not.toBe('nowrap');
    const cta = screen.getByTestId('coupon-cta').parentElement!;
    expect(cta.style.gap).toBe('var(--space-inline-xs)');
  });
});

// Hàng "Tổng cộng" của khối tóm tắt (KeyValueRow: nhãn và giá trị cùng một dòng).
const totalRow = () => screen.getByText('Tổng cộng').parentElement!;

describe('CheckoutPage — tóm tắt tạm khi chưa có địa chỉ: các dòng giảm như báo giá, chưa có tổng', () => {
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
    expect(totalRow().textContent).toContain('Chưa tính');
    expect(screen.queryByText('85.000đ')).toBeNull();
  });

  it('lựa chọn nhớ lại bằng đúng mọi dòng của giỏ: vẫn là cả giỏ, trừ combo', async () => {
    mocks.locState = { itemIds: ['ci1', 'ci2'] };
    mocks.getCart.mockResolvedValue(TWO);
    renderPage();
    expect(await screen.findByText('Giảm giá combo')).toBeInTheDocument();
    expect(totalRow().textContent).toContain('Chưa tính');
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
    expect(screen.getByText('Nhập địa chỉ để tính phí')).toBeInTheDocument();
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
  });

  it('mua cả giỏ có giảm hạng: trừ cả hạng như giỏ và báo giá (100.000 − combo 10.000 − mã 5.000 − hạng 4.000)', async () => {
    mocks.getCart.mockResolvedValue({ ...TWO, tierDiscount: 4_000 });
    renderPage();
    expect(await screen.findByText('Ưu đãi hạng thành viên')).toBeInTheDocument();
    expect(screen.getByText('-4.000đ')).toBeInTheDocument();
    expect(totalRow().textContent).toContain('Chưa tính');
    expect(screen.queryByText('81.000đ')).toBeNull();
    expect(screen.queryByText('85.000đ')).toBeNull();
  });

  it('mua một phần giỏ: không trừ mã của cả giỏ khỏi tiền hàng phần chọn, nhắc tính lại ở bước thanh toán', async () => {
    mocks.locState = { itemIds: ['ci1'] };
    mocks.getCart.mockResolvedValue({ ...TWO, discount: 9_000, tierDiscount: 4_000 });
    renderPage();
    await screen.findByText('Nhập địa chỉ để tính phí');
    expect(screen.queryByText('-9.000đ')).toBeNull();
    expect(screen.queryByText('Giảm giá')).toBeNull();
    expect(screen.queryByText('Ưu đãi hạng thành viên')).toBeNull();
    expect(screen.queryByText('41.000đ')).toBeNull();
    expect(screen.getAllByText('50.000đ').length).toBeGreaterThan(0);
    expect(screen.getByText(/tính lại ở bước thanh toán/)).toBeInTheDocument();
  });

  it('chưa có địa chỉ mà đã ước tính được phí kiện Tubu: dòng phí ghi "19.000đ (ước tính)", tổng vẫn chưa tính', async () => {
    mocks.shipEstimate.mockImplementation((base) => ({
      estimate: base ? { fee: 19_000, feeMin: 19_000, feeMax: 19_000, freeshipThreshold: 200_000, missingForFreeship: 100_000, isEstimate: true, provinceCode: null, provinceName: null } : undefined,
      stale: false,
    }));
    mocks.getCart.mockResolvedValue({ ...TWO, comboDiscount: undefined });
    renderPage();
    expect((await screen.findAllByText('19.000đ (ước tính)')).length).toBeGreaterThan(0);
    expect(mocks.shipEstimate).toHaveBeenLastCalledWith(100_000);
    expect(screen.queryByText('Nhập địa chỉ để tính phí')).toBeNull();
    expect(totalRow().textContent).toContain('Chưa tính');
    mocks.shipEstimate.mockImplementation(() => ({ estimate: undefined, stale: false }));
  });

  it('không có combo (0 hoặc API cũ): tổng như cũ', async () => {
    mocks.getCart.mockResolvedValue({ ...TWO, comboDiscount: undefined });
    renderPage();
    await screen.findByText('Nhập địa chỉ để tính phí');
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
    expect(totalRow().textContent).toContain('Chưa tính');
    expect(screen.queryByText('95.000đ')).toBeNull();
  });
});

describe('CheckoutPage — thiếu địa chỉ: nút Đặt hàng khoá có lý do ngay cạnh (K2)', () => {
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
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('chưa có địa chỉ: thanh dính ghi lý do, nút bấm được để chỉ ra chỗ thiếu, không kèm số tiền', async () => {
    renderPage();
    const bar = await screen.findByTestId('sticky-bar');
    expect(within(bar).getByRole('status')).toHaveTextContent('Chọn địa chỉ giao hàng để đặt hàng.');
    const button = within(bar).getByRole('button');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent(/^Đặt hàng$/);
  });

  it('khối tóm tắt: phí giao nhắc nhập địa chỉ, "Tổng cộng" ghi "Chưa tính" (không số nào đóng vai tổng cuối)', async () => {
    renderPage();
    expect(await screen.findByText('Nhập địa chỉ để tính phí')).toBeInTheDocument();
    expect(totalRow().textContent).toBe('Tổng cộngChưa tính');
    expect(screen.getAllByText('50.000đ').length).toBeGreaterThan(0); // Tạm tính vẫn là tiền hàng
  });

  it('sheet "Chi tiết tính tiền": "Tổng thanh toán" cũng ghi "Chưa tính"', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Chi tiết'));
    const label = await screen.findByText('Tổng thanh toán');
    expect(label.parentElement!.textContent).toBe('Tổng thanh toánChưa tính');
  });

  it('báo giá lỗi (đã có địa chỉ): lý do khác, nút khoá, không hiện số cũ', async () => {
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.checkoutQuote.mockRejectedValue(new Error('Mạng lỗi'));
    renderPage();
    const bar = await screen.findByTestId('sticky-bar');
    await waitFor(() => expect(within(bar).getByRole('status')).toHaveTextContent('Chưa tính được tổng tiền. Bấm Thử lại ở phần tóm tắt rồi đặt hàng.'));
    expect(within(bar).getByRole('button')).toBeDisabled();
  });

  it('đủ địa chỉ và báo giá: không có dòng lý do, nút ghi "Đặt hàng · tổng"', async () => {
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    renderPage();
    const bar = await screen.findByTestId('sticky-bar');
    await waitFor(() => expect(within(bar).getByRole('button')).toHaveTextContent('Đặt hàng · 70.000đ'));
    expect(within(bar).getByRole('status')).toBeEmptyDOMElement();
  });

  it('vùng báo là một phần tử có mặt từ đầu và chỉ đổi chữ khi báo giá lỗi (đọc màn hình mới đọc được)', async () => {
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    let reject!: (e: Error) => void;
    const pending = new Promise<never>((_, r) => (reject = r));
    pending.catch(() => undefined);
    mocks.checkoutQuote.mockReturnValue(pending);
    renderPage();
    const bar = await screen.findByTestId('sticky-bar');
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalled());
    const region = within(bar).getByRole('status');
    expect(region).toBeEmptyDOMElement();
    expect(region.style.position).toBe('absolute');
    reject(new Error('Mạng lỗi'));
    await waitFor(() => expect(region).toHaveTextContent('Chưa tính được tổng tiền.'));
    expect(within(bar).getByRole('status')).toBe(region);
    expect(region.style.position).toBe('');
  });
});

describe('CheckoutPage — dòng hàng và chip mã (K2)', () => {
  const LONG = 'Nước rửa chén sinh học hương chanh sả gừng can lớn tiết kiệm cho gia đình đông người dùng';
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
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('tên sản phẩm tối đa hai dòng, phân loại ở dòng riêng ngay sau tên', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [{ ...CART.items[0]!, productName: LONG, variationName: 'Can 5 lít hương chanh' }] });
    renderPage();
    const name = await screen.findByText(LONG);
    expect(name.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(name.style.whiteSpace).not.toBe('nowrap');
    const variation = screen.getByText('Can 5 lít hương chanh');
    expect(variation).not.toBe(name);
    expect(variation.contains(name) || name.contains(variation)).toBe(false);
    expect(name.compareDocumentPosition(variation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('chip mã và ô icon dùng token ngữ nghĩa (--color-promo-*), không primitive --clay và không cỡ chữ 11', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'SALE', discount: 5_000 });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, discount: 5_000 });
    renderPage();
    const chip = await screen.findByText('SALE');
    const style = chip.getAttribute('style') ?? '';
    expect(style).toContain('--color-promo-bg');
    expect(style).toContain('--color-promo-fg');
    expect(style).not.toMatch(/--clay|font-size:\s*11px/);
    const row = chip.closest('.tubu-press') as HTMLElement;
    expect(row.innerHTML).not.toContain('--clay');
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
    const response = { status: 400, data: { statusCode: 400, code: 'TOTAL_CHANGED', message } };
    mocks.placeOrder.mockRejectedValue(new HttpError('Bad Request', 'ERR_BAD_REQUEST', response));
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

  it('địa chỉ hệ mới nhưng máy chủ báo ADDRESS_OUTDATED (phường không thuộc tỉnh) → cảnh báo trong thẻ đang chọn + nút Sửa địa chỉ mở form sửa', async () => {
    const message = 'Phường/xã không thuộc tỉnh/thành đã chọn. Bạn chọn lại địa chỉ nhé.';
    const response = { status: 400, data: { statusCode: 400, code: 'ADDRESS_OUTDATED', message } };
    mocks.checkoutQuote.mockRejectedValue(new HttpError('Bad Request', 'ERR_BAD_REQUEST', response));
    renderPage();
    const card = (await screen.findByText(/1 Lê Lợi/)).closest('[data-testid="checkout-address-row"]') as HTMLElement;
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('chưa đúng nên Tubu chưa giao được');
    expect(alert).not.toHaveTextContent('theo địa giới cũ');
    expect(screen.getByText('Sửa địa chỉ giao hàng rồi đặt hàng.')).toBeInTheDocument();
    expect(screen.queryByText(/Bấm Thử lại ở phần tóm tắt/)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Sửa địa chỉ' }));
    await waitFor(() => expect(screen.queryByText(/chưa đúng nên Tubu chưa giao được/)).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Ánh')).toBeInTheDocument();
  });

  it('báo giá lỗi vì lý do khác (mạng) → không mời sửa địa chỉ', async () => {
    mocks.checkoutQuote.mockRejectedValue(new Error('Mạng lỗi'));
    renderPage();
    await screen.findByText('Thử lại');
    expect(screen.queryByRole('button', { name: 'Sửa địa chỉ' })).not.toBeInTheDocument();
  });
});

describe('CheckoutPage — thêm địa chỉ mới giữa lúc thanh toán (W31)', () => {
  const A2 = {
    ...ADDRESS, id: 'a2', recipient: 'Long', phone: '0900000000', street: '9 Hai Bà Trưng', ward: 'Phường Sài Gòn', wardCode: '84_VN79_26734', isDefault: false,
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
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.getCommunes.mockResolvedValue([{ code: A2.wardCode, name: A2.ward }]);
    mocks.createAddress.mockResolvedValue(A2);
  });

  afterEach(() => {
    mocks.getCommunes.mockReset();
    mocks.createAddress.mockReset();
  });

  it('địa chỉ vừa thêm vẫn được chọn và báo giá theo nó khi danh sách địa chỉ tải lại về sau, không nhảy về địa chỉ mặc định cũ', async () => {
    let release: (list: unknown) => void = () => undefined;
    mocks.getAddresses
      .mockResolvedValueOnce([ADDRESS])
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValue([ADDRESS, A2]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    fireEvent.click(await screen.findByText('Thêm địa chỉ mới'));
    fireEvent.change(await screen.findByLabelText('Số nhà, tên đường'), { target: { value: A2.street } });
    fireEvent.click(screen.getByRole('button', { name: /^Tỉnh\/Thành phố/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'TP. Hồ Chí Minh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Phường\/Xã/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^Phường\/Xã/ }));
    fireEvent.click(await screen.findByRole('option', { name: A2.ward }));
    fireEvent.click(screen.getByText('Lưu'));
    await waitFor(() => expect(mocks.createAddress).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));

    release([ADDRESS, A2]);
    await waitFor(() => expect(screen.getByTestId('checkout-address-row')).toHaveTextContent(A2.street));
    expect(screen.getByTestId('checkout-address-row')).not.toHaveTextContent(ADDRESS.street);
    await waitFor(() => expect(mocks.checkoutQuote.mock.calls.at(-1)?.[0]).toBe('a2'));
  });
});

const badRequest = (message: string) =>
  Object.assign(new Error(message), { isHttpError: true, response: { status: 400, data: { message } } });

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

  it('FLASH_LIMIT: banner nói giới hạn của suất bằng câu của kế hoạch, tải lại giỏ, có nút "Về giỏ hàng", không chỉ toast', async () => {
    mocks.placeOrder.mockRejectedValue(
      Object.assign(new Error('x'), { isHttpError: true, response: { status: 400, data: { code: 'FLASH_LIMIT', limit: 2, message: 'Vượt giới hạn.' } } }),
    );
    renderPage();
    await placeOrderClick();
    const banner = await screen.findByTestId('checkout-cart-issue');
    expect(within(banner).getByText('Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.')).toBeInTheDocument();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(within(banner).getByRole('button', { name: 'Về giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('câu cũ "Vượt giới hạn mua ưu đãi." vẫn là lỗi sửa ở giỏ', async () => {
    mocks.placeOrder.mockRejectedValue(badRequest('Vượt giới hạn mua ưu đãi.'));
    renderPage();
    await placeOrderClick();
    const banner = await screen.findByTestId('checkout-cart-issue');
    expect(within(banner).getByText('Vượt giới hạn mua ưu đãi.')).toBeInTheDocument();
  });

  it('giỏ đang có dòng vượt tồn → báo ngay dưới dòng đó và khoá nút Đặt hàng', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [{ ...CART.items[0]!, quantity: 3, stock: 1, total: 150_000 }] });
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    expect(within(problem).getByText('Còn 1 sản phẩm')).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-cart-issue')).not.toBeInTheDocument();
    const btn = await screen.findByText(/(Đặt hàng|Thử lại) · /);
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
    const response = { status: 400, data: { statusCode: 400, code: 'PAYMENT_METHOD_NOT_ALLOWED', message: BLOCK_REASON } };
    mocks.placeOrder.mockRejectedValueOnce(new HttpError('Bad Request', 'ERR_BAD_REQUEST', response));
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

  const placeButton = async () => (await screen.findByText(/(Đặt hàng|Thử lại) · /)).closest('button')!;
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
    const response = { status: 400, data: { statusCode: 400, code: 'PAYMENT_METHOD_NOT_ALLOWED', message: COD_OVER } };
    mocks.placeOrder
      .mockRejectedValueOnce(new HttpError('Bad Request', 'ERR_BAD_REQUEST', response))
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

  it('R-28: số dư Ví 0đ thì ẩn dòng Ví Tubu, không hiện câu "cần thêm"', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    renderPage();
    await screen.findByRole('radio', { name: /^Thanh toán khi nhận hàng/ });
    expect(screen.queryByRole('radio', { name: /^Ví Tubu/ })).toBeNull();
    expect(screen.queryByText(/Số dư chưa đủ/)).toBeNull();
  });

  it('COD và chuyển khoản đều khoá, Ví thiếu: không phương thức nào được chọn, nút đặt hàng khoá, nói rõ chưa có cách thanh toán', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 1_000 });
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
    const btn = await screen.findByText(/(Đặt hàng|Thử lại) · /);
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(times));
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
  }

  it('quá thời gian chờ rồi bấm lại cùng nội dung → gửi lại đúng Idempotency-Key cũ', async () => {
    mocks.placeOrder
      .mockRejectedValueOnce(new HttpError('timeout of 15000ms exceeded', 'ECONNABORTED'))
      .mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    renderPage();
    await clickPlace(1);
    await clickPlace(2);
    const [k1, k2] = mocks.placeOrder.mock.calls.map((c) => c[1] as string);
    expect(k1).toBeTruthy();
    expect(k2).toBe(k1);
  });

  it('lỗi 5xx rồi bấm lại → cùng key; đổi cách thanh toán rồi bấm → key mới', async () => {
    const response = { status: 502, data: { message: 'Bad Gateway' } };
    mocks.placeOrder.mockRejectedValue(new HttpError('Bad Gateway', 'ERR_BAD_RESPONSE', response));
    renderPage();
    await clickPlace(1);
    await clickPlace(2);
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    // Khách tự đổi lựa chọn sau lần chưa rõ kết quả: lần bấm đầu chỉ nhắc kiểm tra Đơn hàng, lần sau mới đặt đơn mới.
    fireEvent.click(await screen.findByText(/(Đặt hàng|Thử lại) · /));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.', type: 'error' }));
    expect(mocks.placeOrder).toHaveBeenCalledTimes(2);
    await clickPlace(3);
    const keys = mocks.placeOrder.mock.calls.map((c) => c[1] as string);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('BE báo CART_CHANGED → báo khách và tải lại giỏ', async () => {
    const message = 'Giỏ hàng vừa thay đổi trong lúc đặt đơn. Vui lòng xem lại giỏ hàng và mục Đơn hàng trước khi đặt lại.';
    const response = { status: 400, data: { statusCode: 400, code: 'CART_CHANGED', message } };
    mocks.placeOrder.mockRejectedValue(new HttpError('Bad Request', 'ERR_BAD_REQUEST', response));
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
    expect(screen.getByText(/Dùng 42 điểm, giảm 42đ/)).toBeInTheDocument();
    fireEvent.click(await pointsRow());
    expect(await screen.findByText('Dùng 42 điểm, giảm 42.000đ')).toBeInTheDocument();
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
    expect(await screen.findByText('Dùng 300 điểm, giảm 300đ')).toBeInTheDocument();
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalled());
    expect(screen.queryByText(/Đơn này dùng tối đa/)).toBeNull();
  });

  it('đơn đối tác khoá điểm: ô ghi tổng điểm đang có, không ghi "Dùng được"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 500, redeemablePoints: 300 });
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, pointsBalance: 500, redeemablePoints: 300, pointsMax: 0, pointsPartnerNote: NOTE });
    renderPage();
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(await screen.findByText(/Bạn đang có 500 điểm/)).toBeInTheDocument();
    expect(screen.queryByText(/Dùng được/)).toBeNull();
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
    mocks.placeOrder.mockRejectedValue(new HttpError('Network Error', 'ERR_NETWORK'));
    render(
      <QueryClientProvider client={qc}>
        <CheckoutPage />
      </QueryClientProvider>,
    );
    const btn = await screen.findByText(/(Đặt hàng|Thử lại) · /);
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

describe('CheckoutPage — Đổi rác kèm đơn và quà 0đ (W168)', () => {
  const GATE_QUOTE = { gateOpen: true, eligible: false, reason: null, mode: null, estimatedPoints: 0, minPoints: 3000, freeShip: false, shippingFeeWaived: 0, orderWeightGrams: 3000, maxReturnWeightGrams: 3000, returnWeightGrams: null };
  const BOTTLE = { id: 'it-b', code: 'BOTTLE', name: 'Vỏ chai', unitLabel: 'chai', unitsPerPoint: 1, pointsPerGroup: 1000, hazardous: false, blockedReason: null, prepInstructions: null };
  const BATTERY = { id: 'it-p', code: 'BATTERY', name: 'Pin cũ', unitLabel: 'viên', unitsPerPoint: 1, pointsPerGroup: 500, hazardous: true, blockedReason: 'BATTERY_OUT_OF_HCM', prepInstructions: null };
  const OPTIONS = { gateOpen: true, minPoints: 3000, orderWeightGrams: 3000, maxReturnWeightGrams: 3000, items: [BATTERY, BOTTLE], existingRequest: null };
  const gift = (id: string, over: Record<string, unknown> = {}) => ({ id, code: `QG-${id}`, giftName: `Hạt giống ${id}`, kind: 'SEED_PACK', pointsCost: 500, included: true, ...over });
  const CHANGE_NAME = '♻️ Đổi rác kèm đơn — Miễn 100% phí vận chuyển';
  const lastQuoteArgs = () => mocks.checkoutQuote.mock.calls.at(-1)! as unknown[];
  const pickupArg = () => lastQuoteArgs()[4] as Record<string, unknown> | undefined;

  /** Báo giá giả theo lựa chọn gửi lên: có chọn đủ thì miễn phí giao 20.000đ. */
  function quoteFor(pickupFields: Record<string, unknown> | undefined, gifts: unknown[] = []) {
    const chosen = !!(pickupFields?.inlinePickup || pickupFields?.wasteRequestId);
    return {
      ...QUOTE,
      shippingFee: chosen ? 0 : 20_000,
      total: chosen ? 50_000 : 70_000,
      shippingFeeWaived: chosen ? 20_000 : 0,
      shippingFeeWaivedReason: chosen ? 'RECYCLE_PICKUP' : null,
      pickup: chosen
        ? { ...GATE_QUOTE, mode: pickupFields?.wasteRequestId ? 'REQUEST' : 'INLINE', eligible: true, freeShip: true, shippingFeeWaived: 20_000, estimatedPoints: 3000, returnWeightGrams: pickupFields?.returnWeightGrams ?? 500 }
        : GATE_QUOTE,
      pendingGiftRedemptions: gifts,
    };
  }

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
    mocks.checkoutQuote.mockImplementation(async (...a: unknown[]) => quoteFor(a[4] as Record<string, unknown> | undefined));
    mocks.getCheckoutPickupOptions.mockResolvedValue(OPTIONS);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  async function openSheet() {
    fireEvent.click(await screen.findByRole('button', { name: CHANGE_NAME }));
    return screen.findByTestId('checkout-pickup-sheet');
  }
  async function chooseThreeBottles() {
    const plus = await screen.findByRole('button', { name: 'Tăng số lượng Vỏ chai' });
    for (let i = 0; i < 3; i++) fireEvent.click(plus);
  }

  it('báo giá không có phần thu rác (null hoặc cổng đóng) → không có thẻ, thân đặt đơn không có trường thu rác', async () => {
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, pickup: { ...GATE_QUOTE, gateOpen: false } });
    renderPage();
    const body = await placeOrderClick();
    expect(screen.queryByTestId('checkout-pickup')).toBeNull();
    for (const k of ['wasteRequestId', 'inlinePickup', 'returnWeightGrams', 'excludeGiftRedemptionIds']) expect(body).not.toHaveProperty(k);
  });

  it('thẻ đóng chỉ một hàng: tiêu đề, lợi ích, huy hiệu theo phí giao, công tắc; không còn mục Thu kèm rác cũ', async () => {
    renderPage();
    const card = await screen.findByTestId('checkout-pickup');
    expect(card.querySelectorAll('button, [role="checkbox"]').length).toBeLessThanOrEqual(3);
    expect(within(card).getByText('♻️ Đổi rác kèm đơn')).toBeInTheDocument();
    expect(within(card).getByText('Miễn 100% phí vận chuyển')).toBeInTheDocument();
    expect(within(card).getByText('-20.000đ phí giao')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: CHANGE_NAME })).toBeInTheDocument();
    expect(within(card).getByRole('switch', { name: '♻️ Đổi rác kèm đơn' })).not.toBeChecked();
    expect(document.querySelector('#checkout-waste-pickup')).toBeNull();
    expect(screen.queryByText('Thu kèm rác')).toBeNull();
    // Chỉ một thẻ, không nhân đôi, và danh sách món chưa tải khi tấm còn đóng.
    expect(screen.getAllByText('♻️ Đổi rác kèm đơn')).toHaveLength(1);
    expect(mocks.getCheckoutPickupOptions).not.toHaveBeenCalled();
  });

  it('tấm chọn món: Pin cũ mờ kèm đúng một câu, Xong khoá với một lý do, tiến độ theo ngưỡng máy chủ', async () => {
    renderPage();
    const sheet = await openSheet();
    expect(await within(sheet).findByText('Vỏ chai')).toBeInTheDocument();
    expect(within(sheet).getByText('1 chai = 1.000 điểm')).toBeInTheDocument();
    const note = 'Pin cũ cần xử lý an toàn riêng nên hiện chỉ nhận tại điểm thu gom hoặc lấy tận nơi khu vực TP.HCM';
    expect(within(sheet).getAllByText(note)).toHaveLength(1);
    expect(sheet.querySelector('[data-blocked="true"]')).not.toBeNull();
    expect(within(sheet).getByRole('progressbar', { name: 'Dự kiến 0 / 3.000 điểm' })).toBeInTheDocument();
    expect(screen.getByText('Chọn ít nhất một món rác')).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Xong' });
    expect(done).toBeDisabled();
    // Chip kg chỉ tới trần theo kiện mua (3 kg), lời nhắc nêu đúng trần.
    expect(within(sheet).getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(expect.arrayContaining(['1 kg', '2 kg', '3 kg']));
    expect(within(sheet).queryByRole('button', { name: '5 kg' })).toBeNull();
    expect(within(sheet).getByText(/tối đa 3 kg theo kiện mua/)).toBeInTheDocument();
    await chooseThreeBottles();
    expect(screen.queryByText('Chọn ít nhất một món rác')).toBeNull();
    expect(within(sheet).getByRole('progressbar', { name: 'Dự kiến 3.000 / 3.000 điểm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xong' })).not.toBeDisabled();
  });

  it('chọn món + kg rồi Xong → báo giá gọi lại với inlinePickup + returnWeightGrams, phí giao gạch kèm câu miễn phí, đặt đơn gửi đúng thân', async () => {
    renderPage();
    await openSheet();
    await chooseThreeBottles();
    fireEvent.click(screen.getByRole('button', { name: '2 kg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(pickupArg()).toEqual({ inlinePickup: { lines: [{ itemId: 'it-b', qty: 3 }] }, returnWeightGrams: 2000 }));
    expect(await screen.findByText('Gửi lại ~2 kg · +3.000 điểm sau khi kho nhận')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '♻️ Đổi rác kèm đơn' })).toBeChecked();
    const ship = (await screen.findAllByTestId('ship-waived'))[0]!;
    expect(within(ship).getByText('Miễn phí vận chuyển (đổi rác kèm đơn)')).toBeInTheDocument();
    expect(ship.querySelector('[style*="line-through"]')?.textContent).toBe('20.000đ');
    await waitFor(() => expect(screen.queryByTestId('checkout-pickup-sheet')).toBeNull());
    const body = await placeOrderClick();
    expect(body.inlinePickup).toEqual({ lines: [{ itemId: 'it-b', qty: 3 }] });
    expect(body.returnWeightGrams).toBe(2000);
    expect(body).not.toHaveProperty('wasteRequestId');
    expect(body.expectedTotal).toBe(50_000);
  });

  it('đóng tấm bằng X bỏ bản nháp: không áp, báo giá không đổi', async () => {
    renderPage();
    await openSheet();
    await chooseThreeBottles();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('checkout-pickup-sheet')).toBeNull());
    expect(pickupArg()).toEqual({});
    expect(screen.getByRole('switch', { name: '♻️ Đổi rác kèm đơn' })).not.toBeChecked();
  });

  it('phiếu thu kèm đang mở được chọn sẵn: một dòng tóm tắt + Đổi món; Xong gửi wasteRequestId, không gửi món', async () => {
    mocks.getCheckoutPickupOptions.mockResolvedValue({
      ...OPTIONS,
      existingRequest: { id: 'req-p', code: 'TR-PICK1', estimatedPoints: 3400, lines: [{ itemId: 'it-b', itemName: 'Vỏ chai', unitLabel: 'chai', declaredQty: 3 }] },
    });
    renderPage();
    const sheet = await openSheet();
    expect(await within(sheet).findByText('Phiếu TR-PICK1 · Vỏ chai ×3 · 3.400 điểm')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Đổi món' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Tăng số lượng Vỏ chai' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 kg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(pickupArg()).toEqual({ wasteRequestId: 'req-p', returnWeightGrams: 1000 }));
    const body = await placeOrderClick();
    expect(body.wasteRequestId).toBe('req-p');
    expect(body).not.toHaveProperty('inlinePickup');
  });

  it('"Đổi món" mở danh sách điền sẵn số lượng cũ; Xong chuyển sang chọn món, bỏ wasteRequestId', async () => {
    mocks.getCheckoutPickupOptions.mockResolvedValue({
      ...OPTIONS,
      existingRequest: { id: 'req-p', code: 'TR-PICK1', estimatedPoints: 3000, lines: [{ itemId: 'it-b', itemName: 'Vỏ chai', unitLabel: 'chai', declaredQty: 3 }] },
    });
    renderPage();
    await openSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi món' }));
    expect((await screen.findByRole('button', { name: 'Tăng số lượng Vỏ chai' })).closest('.tubu-pickup-item')?.textContent).toContain('3');
    fireEvent.click(screen.getByRole('button', { name: '2 kg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(pickupArg()).toEqual({ inlinePickup: { lines: [{ itemId: 'it-b', qty: 3 }] }, returnWeightGrams: 2000 }));
  });

  it('tắt công tắc sau khi áp → thân đặt đơn không còn trường thu rác', async () => {
    renderPage();
    await openSheet();
    await chooseThreeBottles();
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await screen.findByText(/Gửi lại ~0,5 kg/);
    fireEvent.click(screen.getByRole('switch', { name: '♻️ Đổi rác kèm đơn' }));
    await waitFor(() => expect(pickupArg()).toEqual({}));
    const body = await placeOrderClick();
    expect(body).not.toHaveProperty('inlinePickup');
    expect(body).not.toHaveProperty('returnWeightGrams');
  });

  it('báo giá lại bị 400: hiện nguyên câu của máy chủ, thẻ vẫn còn để tắt', async () => {
    renderPage();
    await openSheet();
    await chooseThreeBottles();
    mocks.checkoutQuote.mockRejectedValue(Object.assign(new Error('x'), { isHttpError: true, response: { status: 400, data: { message: 'Cân nặng gói rác gửi lại không hợp lệ' } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    expect(await screen.findByText('Cân nặng gói rác gửi lại không hợp lệ')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-pickup')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '♻️ Đổi rác kèm đơn' })).toBeChecked();
  });

  it('409 phiếu thu rác đổi giữa chừng → báo bằng câu của Tubu, tải lại báo giá và danh sách món', async () => {
    mocks.placeOrder.mockRejectedValue(
      Object.assign(new Error('x'), { isHttpError: true, response: { status: 409, data: { message: 'Phiếu thu rác vừa thay đổi nên chưa đủ điều kiện miễn phí vận chuyển. Bạn tải lại trang thanh toán nhé.' } } }),
    );
    renderPage();
    await openSheet();
    await chooseThreeBottles();
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await screen.findByText(/Gửi lại ~0,5 kg/);
    const quoteCalls = mocks.checkoutQuote.mock.calls.length;
    const optionCalls = mocks.getCheckoutPickupOptions.mock.calls.length;
    await placeOrderClick();
    await waitFor(() => expect(mocks.checkoutQuote.mock.calls.length).toBeGreaterThan(quoteCalls));
    expect(mocks.getCheckoutPickupOptions.mock.calls.length).toBeGreaterThan(optionCalls);
  });

  describe('quà đổi điểm 0đ', () => {
    const withGifts = (gifts: unknown[]) =>
      mocks.checkoutQuote.mockImplementation(async (...a: unknown[]) => quoteFor(a[4] as Record<string, unknown> | undefined, gifts));

    it('mỗi quà một dòng "Quà đổi điểm tặng kèm: tên · 0đ", mặc định đi cùng đơn; tick "Để đơn sau" → báo giá gửi excludeGiftRedemptionIds', async () => {
      withGifts([gift('g1'), gift('g2')]);
      renderPage();
      const rows = await screen.findAllByTestId('checkout-gift-row');
      expect(rows).toHaveLength(2);
      expect(rows[0]!.textContent).toContain('🎁 Quà đổi điểm tặng kèm: Hạt giống g1 · 0đ');
      expect(within(rows[0]!).getByRole('checkbox', { name: 'Để đơn sau' })).not.toBeChecked();
      expect(pickupArg()).toEqual({});
      fireEvent.click(within(rows[0]!).getByRole('checkbox', { name: 'Để đơn sau' }));
      await waitFor(() => expect(pickupArg()).toEqual({ excludeGiftRedemptionIds: ['g1'] }));
      expect(within((await screen.findAllByTestId('checkout-gift-row'))[0]!).getByRole('checkbox', { name: 'Để đơn sau' })).toBeChecked();
      const body = await placeOrderClick();
      expect(body.excludeGiftRedemptionIds).toEqual(['g1']);
    });

    it('từ 3 quà gộp một dòng "3 quà đổi điểm tặng kèm · 0đ" mở tấm nhỏ liệt kê từng quà', async () => {
      withGifts([gift('g1'), gift('g2'), gift('g3')]);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /3 quà đổi điểm tặng kèm · 0đ/ }));
      const rows = await screen.findAllByTestId('checkout-gift-row');
      expect(rows).toHaveLength(3);
      fireEvent.click(within(rows[2]!).getByRole('checkbox', { name: 'Để đơn sau' }));
      await waitFor(() => expect(pickupArg()).toEqual({ excludeGiftRedemptionIds: ['g3'] }));
    });

    it('tài khoản đã có số (chưa xác minh) → không hiện "Xác minh ngay": nút đó chỉ trả lại số cũ, quà vẫn bị chặn', async () => {
      withGifts([gift('g1', { included: false, blockedReason: 'PHONE_NOT_VERIFIED' }), gift('g2')]);
      renderPage();
      await screen.findAllByTestId('checkout-gift-row');
      expect(screen.queryByTestId('checkout-gift-verify-phone')).toBeNull();
    });

    it('quà chờ số đã xác minh: "Xác minh ngay" ngay ở dòng quà xin số Zalo rồi báo giá lại; dòng khác không có nút này', async () => {
      mocks.user.phone = null;
      withGifts([gift('g1', { included: false, blockedReason: 'PHONE_NOT_VERIFIED' }), gift('g2')]);
      mocks.ensurePhoneOrThrow.mockResolvedValue('0900000000');
      renderPage();
      const verify = await screen.findByTestId('checkout-gift-verify-phone');
      expect(verify).toHaveTextContent('Xác minh ngay');
      expect(screen.getAllByTestId('checkout-gift-verify-phone')).toHaveLength(1);
      const before = mocks.checkoutQuote.mock.calls.length;
      fireEvent.click(verify);
      await waitFor(() => expect(mocks.ensurePhoneOrThrow).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mocks.checkoutQuote.mock.calls.length).toBeGreaterThan(before));
    });

    it('không có kiện Tubu (mọi quà included=false, chưa bỏ quà nào) → không hiện dòng quà', async () => {
      withGifts([gift('g1', { included: false })]);
      renderPage();
      await placeOrderClick();
      expect(screen.queryByTestId('checkout-gift-row')).toBeNull();
    });
  });
  describe('gợi ý gửi lại bao bì từ đơn đã giao (cờ checkout.return_packaging_nudge_enabled)', () => {
    const SUGGESTION = {
      orderCodes: ['TT100'],
      lines: [{ itemId: 'it-b', code: 'BOTTLE', name: 'Vỏ chai', unitLabel: 'chai', qty: 3, unitsPerPoint: 1, pointsPerGroup: 1000 }],
      estimatedPoints: 3000,
      minPoints: 3000,
      oneTapReady: true,
    };
    const ONE_TAP = 'Bật để gửi kèm: miễn phí giao kiện Tubu Tree, +3.000 Điểm Xanh';
    const cfg = mocks.publicConfig as typeof mocks.publicConfig & { returnPackagingNudgeEnabled?: boolean };
    const funnel = () =>
      vi.mocked(trackEvent).mock.calls.filter((c) => c[0] === 'recycle_funnel_step').map((c) => (c[2] as { step: string; lane?: string }));
    beforeEach(() => {
      cfg.returnPackagingNudgeEnabled = true;
      mocks.getCheckoutPickupOptions.mockResolvedValue({ ...OPTIONS, suggestion: SUGGESTION });
    });
    afterEach(() => {
      delete cfg.returnPackagingNudgeEnabled;
    });

    it('đủ ngưỡng: hàng nêu đúng bao bì, bật công tắc một chạm là báo giá có món điền sẵn và miễn phí giao; đo shown + applied một lần', async () => {
      renderPage();
      const nudge = await screen.findByTestId('checkout-pickup-nudge');
      expect(within(nudge).getByText('Đơn trước bạn có 3 vỏ chai')).toBeInTheDocument();
      expect(within(nudge).getByText(ONE_TAP)).toBeInTheDocument();
      const card = screen.getByTestId('checkout-pickup');
      expect(card.querySelectorAll('button, [role="checkbox"]').length).toBeLessThanOrEqual(3);
      fireEvent.click(within(card).getByRole('switch', { name: ONE_TAP }));
      await waitFor(() => expect(pickupArg()).toMatchObject({ inlinePickup: { lines: [{ itemId: 'it-b', qty: 3 }] } }));
      expect(typeof pickupArg()?.returnWeightGrams).toBe('number');
      expect(screen.queryByTestId('checkout-pickup-sheet')).toBeNull();
      await waitFor(() => expect(screen.queryByTestId('checkout-pickup-nudge')).toBeNull());
      expect(screen.getByRole('switch', { name: '♻️ Đổi rác kèm đơn' })).toBeChecked();
      expect(funnel()).toEqual([
        expect.objectContaining({ step: 'return_nudge_shown', lane: 'PICKUP' }),
        expect.objectContaining({ step: 'return_nudge_applied', lane: 'PICKUP' }),
      ]);
      const body = await placeOrderClick();
      expect(body.inlinePickup).toEqual({ lines: [{ itemId: 'it-b', qty: 3 }] });
    });

    it('chưa đủ ngưỡng: công tắc mở tấm đã điền sẵn để khách thêm món, chưa áp gì', async () => {
      mocks.getCheckoutPickupOptions.mockResolvedValue({ ...OPTIONS, suggestion: { ...SUGGESTION, lines: [{ ...SUGGESTION.lines[0]!, qty: 1 }], estimatedPoints: 1000 } });
      renderPage();
      const nudge = await screen.findByTestId('checkout-pickup-nudge');
      expect(within(nudge).getByText('Còn thiếu 2.000 điểm để gửi kèm, chạm để thêm món')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('switch', { name: '♻️ Đổi rác kèm đơn' }));
      const sheet = await screen.findByTestId('checkout-pickup-sheet');
      expect(await within(sheet).findByRole('progressbar', { name: 'Dự kiến 1.000 / 3.000 điểm' })).toBeInTheDocument();
      expect(pickupArg()).toEqual({});
      expect(funnel().map((p) => p.step)).toEqual(['return_nudge_shown']);
    });

    it('đủ điểm nhưng máy chủ chưa xác nhận gói (oneTapReady false): không hứa miễn phí giao, công tắc mở tấm đã điền sẵn', async () => {
      mocks.getCheckoutPickupOptions.mockResolvedValue({ ...OPTIONS, suggestion: { ...SUGGESTION, oneTapReady: false } });
      renderPage();
      const nudge = await screen.findByTestId('checkout-pickup-nudge');
      expect(within(nudge).getByText('Chạm để xem lại món gửi kèm, +3.000 Điểm Xanh')).toBeInTheDocument();
      expect(nudge.textContent).not.toContain('miễn phí giao');
      fireEvent.click(screen.getByRole('switch', { name: '♻️ Đổi rác kèm đơn' }));
      await screen.findByTestId('checkout-pickup-sheet');
      expect(pickupArg()).toEqual({});
      expect(funnel().map((p) => p.step)).toEqual(['return_nudge_shown']);
    });

    it('phiếu thu kèm đã đăng ký: hàng nêu phiếu, phễu không đếm như gợi ý bao bì từ đơn', async () => {
      mocks.getCheckoutPickupOptions.mockResolvedValue({
        ...OPTIONS,
        existingRequest: { id: 'r1', code: 'TR-ABCDE', estimatedPoints: 3000, lines: [{ itemId: 'it-b', itemName: 'Vỏ chai', unitLabel: 'chai', declaredQty: 3 }] },
        suggestion: null,
      });
      renderPage();
      const nudge = await screen.findByTestId('checkout-pickup-nudge');
      expect(within(nudge).getByText('Phiếu TR-ABCDE chờ gửi: Vỏ chai ×3')).toBeInTheDocument();
      expect(funnel()).toEqual([]);
    });

    it('cờ tắt: thẻ như cũ, không tải danh sách món khi tấm còn đóng', async () => {
      delete cfg.returnPackagingNudgeEnabled;
      renderPage();
      await screen.findByTestId('checkout-pickup');
      expect(screen.queryByTestId('checkout-pickup-nudge')).toBeNull();
      expect(mocks.getCheckoutPickupOptions).not.toHaveBeenCalled();
    });
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
  const networkError = () => new HttpError('Network Error', 'ERR_NETWORK');
  const apiError = (status: number, code: string, message: string) =>
    new HttpError('Bad Request', 'ERR_BAD_REQUEST', { status, data: { statusCode: status, code, message } });
  async function click(times: number) {
    const btn = await screen.findByText(/(Đặt hàng|Thử lại) · /);
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
    fireEvent.click(await screen.findByText(/(Đặt hàng|Thử lại) · /));
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
    expect(notice).toHaveTextContent('Đơn có thể đã được ghi nhận. Bấm Thử lại để gửi lại đúng đơn này');
    fireEvent.click(within(notice).getByRole('button', { name: 'Đơn của tôi' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/orders');
  });

  it('chặn PREVIOUS: khối báo cố định nói bấm lần nữa sẽ đặt đơn mới, có lối sang Đơn của tôi', async () => {
    mocks.placeOrder.mockRejectedValueOnce(networkError());
    mount();
    await click(1);
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    fireEvent.click(await screen.findByText(/(Đặt hàng|Thử lại) · /));
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

describe('CheckoutPage — dòng giao dự kiến ở bước thanh toán (D6-20)', () => {
  const cfg = mocks.publicConfig as Record<string, unknown>;
  beforeEach(() => {
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
    delete cfg.shippingEta;
  });

  const withShipments = (...kinds: string[]) =>
    mocks.checkoutQuote.mockResolvedValue({
      ...QUOTE,
      shipments: kinds.map((kind, i) => ({
        key: `k${i}`, fulfiller: { kind, storefrontId: kind === 'MERCHANT' ? 'sf1' : null, name: kind }, itemIds: ['ci1'], subtotal: 50_000, discount: 0, shippingFee: 0, total: 50_000,
      })),
    });

  it('cấu hình có shippingEta → dưới phí vận chuyển có dòng "Giao dự kiến" kèm khoảng ngày', async () => {
    cfg.shippingEta = { minDays: 2, maxDays: 4 };
    withShipments('TUBU');
    renderPage();
    const label = await screen.findByText(viCopy.success.etaLabel);
    const row = label.parentElement as HTMLElement;
    expect(row.textContent).toMatch(/\d{2}\/\d{2} – \d{2}\/\d{2}/);
    const shipRow = screen.getByText(viCopy.checkout.shippingFee).parentElement as HTMLElement;
    expect(shipRow.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('giỏ chỉ có hàng gian hàng tự giao → không hứa ngày giao dự kiến', async () => {
    cfg.shippingEta = { minDays: 2, maxDays: 4 };
    withShipments('MERCHANT');
    renderPage();
    // Dòng ngày chỉ nằm trong khối có báo giá: đợi báo giá xong (nút Đặt hàng mở) rồi mới khẳng định không có.
    const btn = await screen.findByText(/(Đặt hàng|Thử lại) · /);
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
    expect(screen.queryByText(viCopy.success.etaLabel)).toBeNull();
  });

  it('giỏ trộn hàng Tubu và hàng gian hàng tự giao → ngày kèm "(hàng Tubu Tree)"', async () => {
    cfg.shippingEta = { minDays: 2, maxDays: 4 };
    withShipments('TUBU', 'MERCHANT');
    renderPage();
    const row = (await screen.findByText(viCopy.success.etaLabel)).parentElement as HTMLElement;
    expect(row.textContent).toMatch(/\d{2}\/\d{2} – \d{2}\/\d{2} \(hàng Tubu Tree\)/);
  });

  it('shippingEta null hoặc thiếu → không có dòng giao dự kiến', async () => {
    cfg.shippingEta = null;
    renderPage();
    await screen.findByText(viCopy.checkout.shippingFee);
    expect(screen.queryByText(viCopy.success.etaLabel)).toBeNull();
    delete cfg.shippingEta;
  });
});

describe('CheckoutPage: tự áp mã giảm nhiều nhất, gợi ý khi chưa áp', () => {
  const preview = (code: string, over: object = {}) => ({ code, eligible: true, discount: 0, ...over });
  const PREVIEWS = [
    preview('WELCOME30', { discount: 30_000 }),
    preview('SHIP', { freeshipSaving: 20_000 }),
    preview('BIG', { eligible: false, reason: 'Cần đơn tối thiểu', discount: 99_000 }),
  ];
  const APPLIED = { ...CART, couponCode: 'WELCOME30', discount: 30_000 };
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.voucherProps = [];
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.getCoupons.mockResolvedValue([{ id: 'c1', code: 'WELCOME30' }]);
    mocks.getCouponPreviews.mockResolvedValue(PREVIEWS);
    mocks.applyCoupon.mockResolvedValue(APPLIED);
    mocks.removeCoupon.mockResolvedValue(CART);
  });

  it('ví không có mã nào → không hỏi xem trước (không tính thừa trên máy chủ), giữ câu cũ', async () => {
    mocks.getCoupons.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chọn hoặc nhập mã')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getCoupons).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.getCouponPreviews).not.toHaveBeenCalled();
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
  });

  it('giỏ chưa có mã, có mã dùng được → áp mã giảm nhiều nhất (hỏi kèm địa chỉ), hiện "Đã tự áp" và nút Gỡ', async () => {
    renderPage();
    expect(await screen.findByTestId('coupon-auto-label')).toHaveTextContent('Tubu đã tự áp mã tốt nhất');
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
    expect(mocks.applyCoupon).toHaveBeenCalledWith('WELCOME30');
    expect(mocks.getCouponPreviews).toHaveBeenCalledWith({ addressId: 'a1', storefrontSlug: undefined, itemIds: undefined });
    expect(screen.getByText('WELCOME30')).toBeInTheDocument();
    expect(screen.getByTestId('coupon-auto-remove')).toHaveTextContent('Gỡ');
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
  });

  it('bấm Gỡ → bỏ mã bằng đường gỡ sẵn có, không tự áp lại, câu gợi ý hiện lại', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('coupon-auto-remove'));
    expect(await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ')).toBeInTheDocument();
    expect(mocks.removeCoupon).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('coupon-auto-label')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
  });

  it('khách tự chọn mã khác → nhãn "Đã tự áp" biến mất', async () => {
    renderPage();
    await screen.findByTestId('coupon-auto-label');
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'SHIP', discount: 0, freeship: true });
    await act(async () => {
      (mocks.voucherProps[mocks.voucherProps.length - 1]!.onCouponApplied as () => void)();
    });
    expect(await screen.findByText('SHIP')).toBeInTheDocument();
    expect(screen.queryByTestId('coupon-auto-label')).toBeNull();
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
  });

  it('giỏ đã có mã → không hỏi xem trước, không tự áp, không nhãn; gỡ tay rồi cũng không tự áp', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, couponCode: 'XANH10' });
    renderPage();
    expect(await screen.findByText('XANH10')).toBeInTheDocument();
    await screen.findByText(viCopy.checkout.shippingFee);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.getCouponPreviews).not.toHaveBeenCalled();
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    expect(screen.queryByTestId('coupon-auto-label')).toBeNull();
    mocks.getCart.mockResolvedValue(CART);
    await act(async () => {
      (mocks.voucherProps[mocks.voucherProps.length - 1]!.onCouponApplied as () => void)();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('áp không được (mạng, mã vừa hết) → im lặng: không báo lỗi, giữ câu gợi ý như chưa áp', async () => {
    mocks.applyCoupon.mockRejectedValue(new Error('mạng'));
    renderPage();
    expect(await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ')).toBeInTheDocument();
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('coupon-auto-label')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('không mã nào dùng được → giữ câu cũ; không tự áp mã nào', async () => {
    mocks.getCouponPreviews.mockResolvedValue([preview('BIG', { eligible: false, reason: 'x', discount: 9 })]);
    renderPage();
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Chọn hoặc nhập mã')).toBeInTheDocument();
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
  });

  it('tải lại trang sau khi gỡ → không tự áp lại; cờ nhớ theo phiên', async () => {
    const first = renderPage();
    fireEvent.click(await screen.findByTestId('coupon-auto-remove'));
    await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ');
    first.unmount();
    mocks.applyCoupon.mockClear();
    renderPage();
    await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('tải lại trang khi mã tự áp còn trên giỏ → vẫn hiện "Đã tự áp", không áp lại', async () => {
    const first = renderPage();
    await screen.findByTestId('coupon-auto-label');
    first.unmount();
    mocks.applyCoupon.mockClear();
    mocks.getCart.mockResolvedValue(APPLIED);
    renderPage();
    expect(await screen.findByTestId('coupon-auto-label')).toHaveTextContent('Tubu đã tự áp mã tốt nhất');
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('gỡ mã bằng tấm chọn mã rồi chọn lại đúng mã đó bằng tay → không còn nhãn "Đã tự áp"', async () => {
    renderPage();
    await screen.findByTestId('coupon-auto-label');
    mocks.getCart.mockResolvedValue(CART);
    await act(async () => {
      (mocks.voucherProps[mocks.voucherProps.length - 1]!.onCouponApplied as () => void)();
    });
    await waitFor(() => expect(screen.queryByTestId('coupon-auto-label')).toBeNull());
    mocks.getCart.mockResolvedValue(APPLIED);
    await act(async () => {
      (mocks.voucherProps[mocks.voucherProps.length - 1]!.onCouponApplied as () => void)();
    });
    expect(await screen.findByText('WELCOME30')).toBeInTheDocument();
    expect(screen.queryByTestId('coupon-auto-label')).toBeNull();
  });

  it('"Mua ngay" khi giỏ chỉ có đúng món đó (có itemIds) → không tự áp, vẫn gợi ý', async () => {
    mocks.locState = { itemIds: ['ci1'] };
    renderPage();
    expect(await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    mocks.locState = null;
  });

  it('đang tự áp mã → nút đặt hàng khoá cho tới khi áp xong', async () => {
    let release!: (v: unknown) => void;
    mocks.applyCoupon.mockReturnValue(new Promise((r) => (release = r)));
    renderPage();
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledTimes(1));
    const btn = (await screen.findByText(/(Đặt hàng|Thử lại) · /)).closest('button')!;
    expect(btn).toBeDisabled();
    await act(async () => {
      release(APPLIED);
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('đặt đơn xong → xoá trí nhớ mã tự áp', async () => {
    renderPage();
    await screen.findByTestId('coupon-auto-label');
    expect(sessionStorage.getItem('tubu.autocoupon.applied:u1')).toBe('WELCOME30');
    await placeOrderClick();
    await waitFor(() => expect(sessionStorage.getItem('tubu.autocoupon.applied:u1')).toBeNull());
    expect(sessionStorage.getItem('tubu.autocoupon.off:u1')).toBeNull();
  });

  it('gỡ lỗi → báo nhẹ bằng snackbar, mã vẫn nằm trên giỏ', async () => {
    mocks.removeCoupon.mockRejectedValue(new Error('mạng'));
    renderPage();
    fireEvent.click(await screen.findByTestId('coupon-auto-remove'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(screen.getByTestId('coupon-auto-label')).toBeInTheDocument();
  });

  it('mở nguội: khách (user.id) về sau lần dựng đầu → không áp lại mã đã gỡ của khách đó', async () => {
    sessionStorage.setItem('tubu.autocoupon.off:u1', '1');
    const id = mocks.user.id;
    (mocks.user as { id: string | undefined }).id = undefined;
    try {
      renderPage();
      await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(mocks.applyCoupon).not.toHaveBeenCalled();
      mocks.user.id = id;
      await act(async () => {
        (mocks.voucherProps[mocks.voucherProps.length - 1]!.onCouponApplied as () => void)();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(mocks.applyCoupon).not.toHaveBeenCalled();
    } finally {
      mocks.user.id = id;
    }
  });

  it('mở nguội: khách về sau lần dựng đầu, mã tự áp còn trên giỏ → hiện nhãn "Đã tự áp"', async () => {
    sessionStorage.setItem('tubu.autocoupon.applied:u1', 'WELCOME30');
    mocks.getCart.mockResolvedValue(APPLIED);
    const id = mocks.user.id;
    (mocks.user as { id: string | undefined }).id = undefined;
    try {
      renderPage();
      await screen.findByText('WELCOME30');
      expect(screen.queryByTestId('coupon-auto-label')).toBeNull();
      mocks.user.id = id;
      await act(async () => {
        (mocks.voucherProps[mocks.voucherProps.length - 1]!.onCouponApplied as () => void)();
      });
      expect(await screen.findByTestId('coupon-auto-label')).toHaveTextContent('Tubu đã tự áp mã tốt nhất');
      expect(mocks.applyCoupon).not.toHaveBeenCalled();
    } finally {
      mocks.user.id = id;
    }
  });

  it('chưa biết khách → chưa tự áp', async () => {
    const id = mocks.user.id;
    (mocks.user as { id: string | undefined }).id = undefined;
    try {
      renderPage();
      await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(mocks.applyCoupon).not.toHaveBeenCalled();
    } finally {
      mocks.user.id = id;
    }
  });

  it('đổi tài khoản trong cùng lần mở → đọc cờ của khách mới', async () => {
    sessionStorage.setItem('tubu.autocoupon.off:u1', '1');
    renderPage();
    await screen.findByText('Bạn có 2 mã dùng được · giảm đến 30.000đ');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    const id = mocks.user.id;
    mocks.user.id = 'u2';
    try {
      await act(async () => {
        (mocks.voucherProps[mocks.voucherProps.length - 1]!.onCouponApplied as () => void)();
      });
      await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('WELCOME30'));
    } finally {
      mocks.user.id = id;
    }
  });

  it('đang tự áp mã → tấm chọn mã nhận busy để khoá nút chọn mã', async () => {
    let release!: (v: unknown) => void;
    mocks.applyCoupon.mockReturnValue(new Promise((r) => (release = r)));
    renderPage();
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.voucherProps[mocks.voucherProps.length - 1]!.busy).toBe(true));
    await act(async () => {
      release(APPLIED);
    });
    await waitFor(() => expect(mocks.voucherProps[mocks.voucherProps.length - 1]!.busy).toBe(false));
  });
});

describe('CheckoutPage — giá đổi lúc đặt (hk)', () => {
  const priceChangedErr = () =>
    new HttpError('Bad Request', 'ERR_BAD_REQUEST', { status: 400, data: { statusCode: 400, message: 'PRICE_CHANGED' } });

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('PRICE_CHANGED (axios, thân phản hồi chỉ là mã không dấu) → sheet giá đổi với "Cập nhật giá mới", không phải toast chung', async () => {
    mocks.placeOrder.mockRejectedValue(priceChangedErr());
    renderPage();
    await placeOrderClick();
    expect(await screen.findByText('Giá ưu đãi đã thay đổi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cập nhật giá mới' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem lại giỏ hàng' })).toBeInTheDocument();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('"Cập nhật giá mới" ở lại màn thanh toán, tải lại giỏ và báo giá, báo tổng mới và đặt tiếp với tổng mới', async () => {
    mocks.placeOrder.mockRejectedValueOnce(priceChangedErr()).mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    renderPage();
    await placeOrderClick();
    const cartCalls = mocks.getCart.mock.calls.length;
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, total: 75_000 });
    fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật giá mới' }));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(cartCalls));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã cập nhật giá. Tổng mới 75.000đ.' })),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    const btn = await screen.findByText('Đặt hàng · 75.000đ');
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    expect((mocks.placeOrder.mock.calls[1]![0] as Record<string, unknown>).expectedTotal).toBe(75_000);
  });

  it('nhận giá mới rồi giỏ thành rỗng (báo giá tắt): mốc nhận giá bị xoá, báo giá về muộn không bật câu "Đã cập nhật giá" sai lúc', async () => {
    mocks.placeOrder.mockRejectedValueOnce(priceChangedErr());
    renderPage();
    await placeOrderClick();
    let release: () => void = () => undefined;
    mocks.checkoutQuote.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ ...QUOTE, total: 75_000 });
    }));
    mocks.getCart.mockResolvedValue({ ...CART, items: [], itemCount: 0 });
    fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật giá mới' }));
    expect(await screen.findByText(viCopy.cart.emptyHeading)).toBeInTheDocument();
    await act(async () => {
      release();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Đã cập nhật giá') }));
  });

  it('"Xem lại giỏ hàng" vẫn đưa sang giỏ', async () => {
    mocks.placeOrder.mockRejectedValue(priceChangedErr());
    renderPage();
    await placeOrderClick();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem lại giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });
});

describe('CheckoutPage — lỗi theo từng dòng hàng (hk)', () => {
  const SECOND = { id: 'ci2', variationId: 'v2', productName: 'Dầu gội', variationName: null, slug: 'dg', thumbnail: null, unitPrice: 50_000, quantity: 1, stock: 5, total: 50_000 };
  const OVER = { ...CART.items[0]!, quantity: 3, stock: 1, total: 150_000 };
  const SOLD_OUT = { ...CART.items[0]!, quantity: 1, stock: 0, total: 50_000 };

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.removeCartItem.mockResolvedValue(CART);
    mocks.updateCartItem.mockResolvedValue(CART);
  });

  it('dòng vượt tồn: nút "Giảm còn 1" sửa số lượng ngay tại màn rồi tải lại giỏ và báo giá', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [OVER] });
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    const carts = mocks.getCart.mock.calls.length;
    fireEvent.click(within(problem).getByRole('button', { name: 'Giảm còn 1' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledWith('ci1', 1));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(carts));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('dòng hết hàng: "Hết hàng" và nút "Bỏ khỏi đơn" xoá đúng dòng đó, dòng còn hàng không có nút sửa', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [SOLD_OUT, SECOND] });
    renderPage();
    const problems = await screen.findAllByTestId('checkout-line-problem');
    expect(problems).toHaveLength(1);
    expect(within(problems[0]!).getByText('Hết hàng')).toBeInTheDocument();
    fireEvent.click(within(problems[0]!).getByRole('button', { name: 'Bỏ khỏi đơn' }));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('ci1'));
    expect(mocks.updateCartItem).not.toHaveBeenCalled();
  });

  it('bấm "Bỏ khỏi đơn" hai lần liền: nút còn bận tới khi giỏ mới về, chỉ xoá một lần (không gọi lần hai rồi nhận 404)', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [SOLD_OUT, SECOND] });
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    let release: () => void = () => undefined;
    mocks.getCart.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ ...CART, items: [SECOND] });
    }));
    const btn = within(problem).getByRole('button', { name: 'Bỏ khỏi đơn' });
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mocks.removeCartItem).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByTestId('checkout-line-problem')).not.toBeInTheDocument());
    expect(mocks.removeCartItem).toHaveBeenCalledTimes(1);
  });

  it('sửa nhanh bị từ chối (tồn đã đổi): báo lỗi và tải lại giỏ để nút "Giảm còn n" theo tồn mới', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [OVER] });
    mocks.updateCartItem.mockRejectedValue(new HttpError('Bad Request', 'ERR_BAD_REQUEST', { status: 400, data: { statusCode: 400, message: 'Kho đã đổi, bạn thử lại nhé.' } }));
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    const carts = mocks.getCart.mock.calls.length;
    mocks.getCart.mockResolvedValue({ ...CART, items: [{ ...OVER, stock: 2 }] });
    fireEvent.click(within(problem).getByRole('button', { name: 'Giảm còn 1' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Kho đã đổi, bạn thử lại nhé.' })));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(carts));
    expect(await screen.findByRole('button', { name: 'Giảm còn 2' })).toBeInTheDocument();
  });

  it('còn dòng cần sửa: dải đáy nói lý do khoá nút, bỏ banner đầu trang', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [SOLD_OUT, SECOND] });
    renderPage();
    await screen.findByTestId('checkout-line-problem');
    expect(await screen.findByText('Sửa sản phẩm đang báo lỗi để đặt tiếp.')).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-cart-issue')).not.toBeInTheDocument();
  });
});

describe('CheckoutPage — gửi lỗi mạng (hk)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('lỗi mạng: dải đáy nói chưa gửi được đơn, nút đổi thành "Thử lại · tổng", bấm lại gửi đúng body và khoá cũ, không đặt hai đơn', async () => {
    mocks.placeOrder.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK')).mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    renderPage();
    await placeOrderClick();
    const retry = await screen.findByText('Thử lại · 70.000đ');
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Chưa rõ đơn đã được ghi nhận chưa'));
    expect(status).toHaveTextContent('Chưa rõ đơn đã được ghi nhận chưa. Bấm Thử lại để gửi lại đúng đơn này, hệ thống không tạo đơn trùng.');
    expect(screen.queryByText(/Đặt hàng · /)).not.toBeInTheDocument();
    await waitFor(() => expect(retry.closest('button')).not.toBeDisabled());
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeOrder.mock.calls[1]![0]).toEqual(mocks.placeOrder.mock.calls[0]![0]);
    expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
    expect(await screen.findByTestId('order-success')).toBeInTheDocument();
  });

  it('lỗi 4xx của máy chủ: nút vẫn là "Đặt hàng · tổng", không có câu "Chưa rõ đơn đã được ghi nhận chưa"', async () => {
    mocks.placeOrder.mockRejectedValue(new HttpError('Bad Request', 'ERR_BAD_REQUEST', { status: 400, data: { statusCode: 400, message: 'Mã giảm giá đã hết hạn.' } }));
    renderPage();
    await placeOrderClick();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(screen.getByText(/Đặt hàng · /)).toBeInTheDocument();
    expect(screen.queryByText(/Chưa rõ đơn đã được ghi nhận chưa/)).not.toBeInTheDocument();
  });

  it('khối báo cố định theo tên nút: nói Bấm Thử lại, không còn "Bấm Đặt hàng lần nữa để thử lại"', async () => {
    mocks.placeOrder.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK'));
    renderPage();
    await placeOrderClick();
    const notice = await screen.findByTestId('place-notice');
    expect(notice).toHaveTextContent('Đơn có thể đã được ghi nhận. Bấm Thử lại để gửi lại đúng đơn này');
    expect(notice).not.toHaveTextContent('Bấm Đặt hàng lần nữa');
  });

  it('đổi lựa chọn sau lỗi chưa rõ kết quả (đổi cách thanh toán): nút về "Đặt hàng · tổng", không còn câu "không tạo đơn trùng"; bấm kế bị chặn, bấm sau gửi với khoá khác', async () => {
    mocks.placeOrder.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK')).mockResolvedValue({ id: 'o2', code: 'TT002' });
    renderPage();
    await placeOrderClick();
    expect(await screen.findByText('Thử lại · 70.000đ')).toBeInTheDocument();
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    expect(await screen.findByText('Đặt hàng · 70.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/Thử lại · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/hệ thống không tạo đơn trùng/)).not.toBeInTheDocument();
    expect(screen.getByTestId('place-notice')).not.toHaveTextContent('Bấm Thử lại');
    fireEvent.click(screen.getByText('Đặt hàng · 70.000đ'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.', type: 'error' }));
    expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByText('Đặt hàng · 70.000đ'));
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeOrder.mock.calls[1]![1]).not.toBe(mocks.placeOrder.mock.calls[0]![1]);
  });

  it('sửa nhanh một dòng sau lỗi chưa rõ kết quả: nhãn nút và câu đáy đổi, bấm kế không gửi (chặn cũ), bấm sau gửi với tổng mới', async () => {
    const OVER = { ...CART.items[0]!, quantity: 3, stock: 1, total: 150_000 };
    mocks.placeOrder.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK')).mockResolvedValue({ id: 'o2', code: 'TT002' });
    renderPage();
    await placeOrderClick();
    await screen.findByText('Thử lại · 70.000đ');
    mocks.getCart.mockResolvedValue({ ...CART, items: [OVER] });
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    const problem = await screen.findByTestId('checkout-line-problem');
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, total: 45_000 });
    fireEvent.click(within(problem).getByRole('button', { name: 'Giảm còn 1' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledWith('ci1', 1));
    const btn = await screen.findByText('Đặt hàng · 45.000đ');
    expect(screen.queryByText(/Thử lại · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/hệ thống không tạo đơn trùng/)).not.toBeInTheDocument();
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.', type: 'error' }));
    expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByText('Đặt hàng · 45.000đ'));
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    // Khoá chống trùng chỉ tính theo các trường yêu cầu (số lượng nằm ở giỏ, không ở body) nên vẫn là khoá cũ: máy chủ quyết đơn cũ hay đơn mới.
    expect((mocks.placeOrder.mock.calls[1]![0] as Record<string, unknown>).expectedTotal).toBe(45_000);
  });
});

describe('CheckoutPage — lỗi ô nhập và nút đặt hàng bấm được (hk)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.user.fullName = 'Long';
    mocks.user.phone = '0900000000';
    mocks.locState = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  const pressPlace = async () => {
    const btn = await screen.findByText(/(Đặt hàng|Thử lại)( · |$)/);
    fireEvent.click(btn);
  };

  it('chưa có địa chỉ: bấm Đặt hàng không gửi đơn, báo thiếu ngay dưới khối địa chỉ và đưa con trỏ vào khối đó', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    renderPage();
    await pressPlace();
    const block = await screen.findByTestId('checkout-address-block');
    const alert = await within(block.parentElement!).findByRole('alert');
    expect(alert).toHaveTextContent('Chọn địa chỉ giao hàng để đặt hàng.');
    expect(block).toHaveAttribute('aria-describedby', alert.id);
    expect(block.contains(document.activeElement)).toBe(true);
    expect(mocks.placeOrder).not.toHaveBeenCalled();
  });

  it('danh sách địa chỉ đang tải: chưa báo "Chọn địa chỉ…", chưa có nút Đặt hàng bấm được', async () => {
    mocks.getAddresses.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByText('Chọn địa chỉ giao hàng để đặt hàng.')).not.toBeInTheDocument();
    const place = screen.queryAllByRole('button').find((b) => /^Đặt hàng/.test(b.textContent ?? ''));
    expect(place === undefined || place.hasAttribute('disabled') || place.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('hoá đơn thiếu ô: bấm Đặt hàng không gửi đơn, mỗi ô báo riêng dưới ô đó (aria-invalid + aria-describedby), ô đầu tiên nhận con trỏ', async () => {
    renderPage();
    await screen.findByText('Đặt hàng · 70.000đ');
    fireEvent.click(screen.getByText('Yêu cầu xuất hoá đơn VAT'));
    expect(screen.getByLabelText('Mã số thuế')).not.toHaveAttribute('aria-invalid');
    await pressPlace();
    const tax = screen.getByLabelText('Mã số thuế');
    await waitFor(() => expect(tax).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(tax.getAttribute('aria-describedby')!)).toHaveTextContent('Nhập mã số thuế.');
    expect(document.getElementById(screen.getByLabelText('Tên công ty').getAttribute('aria-describedby')!)).toHaveTextContent('Nhập tên công ty.');
    expect(document.getElementById(screen.getByLabelText('Email nhận hoá đơn').getAttribute('aria-describedby')!)).toHaveTextContent('Nhập email nhận hoá đơn.');
    expect(document.activeElement).toBe(tax);
    expect(mocks.placeOrder).not.toHaveBeenCalled();
  });

  it('bấm Đặt hàng khi thiếu địa chỉ rồi mới bật hoá đơn: các ô hoá đơn chưa đỏ; chỉ báo sau khi rời ô hoặc sau lần bấm kế tiếp', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    renderPage();
    await pressPlace();
    expect((await screen.findAllByText('Chọn địa chỉ giao hàng để đặt hàng.')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Yêu cầu xuất hoá đơn VAT'));
    const tax = await screen.findByLabelText('Mã số thuế');
    expect(tax).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Tên công ty')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Nhập mã số thuế.')).not.toBeInTheDocument();
    fireEvent.blur(tax);
    await waitFor(() => expect(tax).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText('Tên công ty')).not.toHaveAttribute('aria-invalid');
    await pressPlace();
    await waitFor(() => expect(screen.getByLabelText('Tên công ty')).toHaveAttribute('aria-invalid', 'true'));
  });

  it('hoá đơn: rời ô có giá trị sai thì báo ngay dưới ô đó, ô chưa chạm chưa báo; sửa đúng thì lời báo mất và đặt được', async () => {
    renderPage();
    await screen.findByText('Đặt hàng · 70.000đ');
    fireEvent.click(screen.getByText('Yêu cầu xuất hoá đơn VAT'));
    const email = screen.getByLabelText('Email nhận hoá đơn');
    fireEvent.change(email, { target: { value: 'khong-phai-email' } });
    expect(email).not.toHaveAttribute('aria-invalid');
    fireEvent.blur(email);
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(email.getAttribute('aria-describedby')!)).toHaveTextContent(/^(⚠ )?Email chưa đúng\. Ví dụ: ten@congty\.vn\.$/);
    expect(screen.getByLabelText('Tên công ty')).not.toHaveAttribute('aria-invalid');
    fireEvent.change(screen.getByLabelText('Mã số thuế'), { target: { value: '0312345678' } });
    fireEvent.change(screen.getByLabelText('Tên công ty'), { target: { value: 'Cty A' } });
    fireEvent.change(screen.getByLabelText('Địa chỉ xuất hoá đơn'), { target: { value: '1 Lê Lợi' } });
    fireEvent.change(email, { target: { value: 'a@b.vn' } });
    await waitFor(() => expect(email).not.toHaveAttribute('aria-invalid'));
    const body = await placeOrderClick();
    expect((body.invoiceRequest as { email: string }).email).toBe('a@b.vn');
  });
});

describe('CheckoutPage — thanh toán một phần giỏ: dòng chọn cuối cùng và lựa chọn đã chết (hk)', () => {
  const mk = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id, variationId: `v-${id}`, productName: name, variationName: null, slug: id, thumbnail: null, unitPrice: 50_000, quantity: 1, stock: 5, total: 50_000, ...over,
  });
  const quoteItemIds = () => mocks.checkoutQuote.mock.calls.map((c) => c[3]);

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.locState = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.removeCartItem.mockResolvedValue(CART);
    mocks.updateCartItem.mockResolvedValue(CART);
  });

  it('dòng hết hàng là dòng DUY NHẤT được chọn: nút là "Về giỏ hàng", không xoá tại màn (xoá thì lựa chọn rỗng và màn chuyển sang cả giỏ)', async () => {
    mocks.locState = { itemIds: ['A'] };
    mocks.getCart.mockResolvedValue({ ...CART, items: [mk('A', 'Dầu gội', { stock: 0 }), mk('B', 'Mật ong'), mk('C', 'Xà bông')] });
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    expect(within(problem).queryByRole('button', { name: 'Bỏ khỏi đơn' })).not.toBeInTheDocument();
    fireEvent.click(within(problem).getByRole('button', { name: 'Về giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    expect(mocks.removeCartItem).not.toHaveBeenCalled();
    expect(screen.queryByText('Mật ong')).not.toBeInTheDocument();
    expect(quoteItemIds().every((ids) => JSON.stringify(ids) === JSON.stringify(['A']))).toBe(true);
  });

  it('được chọn từ hai dòng: dòng hết hàng vẫn bỏ được tại màn (còn dòng khác trong lựa chọn)', async () => {
    mocks.locState = { itemIds: ['A', 'B'] };
    mocks.getCart.mockResolvedValue({ ...CART, items: [mk('A', 'Dầu gội', { stock: 0 }), mk('B', 'Mật ong'), mk('C', 'Xà bông')] });
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    fireEvent.click(within(problem).getByRole('button', { name: 'Bỏ khỏi đơn' }));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('A'));
  });

  it('lựa chọn đã chết (xoá ở nơi khác): báo món đã chọn không còn, KHÔNG báo giá hay dựng đơn cho cả giỏ, nút Về giỏ hàng và dọn bộ nhớ', async () => {
    mocks.locState = { itemIds: ['gone'] };
    mocks.getCart.mockResolvedValue({ ...CART, items: [mk('B', 'Mật ong'), mk('C', 'Xà bông')] });
    renderPage();
    expect(await screen.findByText('Món bạn chọn không còn trong giỏ')).toBeInTheDocument();
    expect(screen.queryByText(/Đặt hàng/)).not.toBeInTheDocument();
    expect(screen.queryByText('Mật ong')).not.toBeInTheDocument();
    expect(mocks.checkoutQuote).not.toHaveBeenCalled();
    expect(mocks.placeOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Về giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart', { replace: true });
    expect(recallCheckoutSelection()).toBeUndefined();
  });

  it('mở lại màn không có state điều hướng, lựa chọn nhớ theo phiên: chỉ báo giá phần đã chọn, không bao giờ cả giỏ', async () => {
    rememberCheckoutSelection(['A']);
    mocks.getCart.mockResolvedValue({ ...CART, items: [mk('A', 'Dầu gội'), mk('B', 'Mật ong')] });
    renderPage();
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalled());
    expect(await screen.findByText('Dầu gội')).toBeInTheDocument();
    expect(screen.queryByText('Mật ong')).not.toBeInTheDocument();
    expect(quoteItemIds().every((ids) => JSON.stringify(ids) === JSON.stringify(['A']))).toBe(true);
    expect(recallCheckoutSelection()).toEqual(['A']);
  });

  it('đặt một phần chưa rõ kết quả, rồi các món đã đặt biến khỏi giỏ: màn "Đơn có thể đã được tạo" gửi lại đúng đơn cũ, không rơi về cả giỏ', async () => {
    mocks.locState = { itemIds: ['A'] };
    mocks.getCart.mockResolvedValue({ ...CART, items: [mk('A', 'Dầu gội'), mk('B', 'Mật ong')] });
    mocks.placeOrder.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK')).mockResolvedValueOnce({ id: 'o1', code: 'TT001' });
    renderPage();
    const first = await placeOrderClick();
    expect(first.itemIds).toEqual(['A']);
    mocks.getCart.mockResolvedValue({ ...CART, items: [mk('B', 'Mật ong')] });
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Đơn của bạn có thể đã được tạo')).toBeInTheDocument();
    expect(screen.queryByText('Mật ong')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại' }));
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeOrder.mock.calls[1]![0]).toEqual(mocks.placeOrder.mock.calls[0]![0]);
    expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
  });

  it('lựa chọn nhớ theo phiên đã chết, mở không có state: vẫn là màn báo, vẽ lại nhiều lần cũng không đổi sang cả giỏ', async () => {
    rememberCheckoutSelection(['gone']);
    mocks.getCart.mockResolvedValue({ ...CART, items: [mk('B', 'Mật ong')] });
    renderPage();
    expect(await screen.findByText('Món bạn chọn không còn trong giỏ')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText('Món bạn chọn không còn trong giỏ')).toBeInTheDocument();
    expect(mocks.checkoutQuote).not.toHaveBeenCalled();
  });
});

describe('CheckoutPage — khoá chạm đúp dòng sửa nhanh, gỡ mã tự áp, đặt và kiểm tra lại đơn (W71A)', () => {
  const SOLD_OUT = { ...CART.items[0]!, quantity: 1, stock: 0, total: 50_000 };
  const SOLD_OUT_2 = { ...CART.items[0]!, id: 'ci2', variationId: 'v2', productName: 'Dầu gội', quantity: 1, stock: 0, total: 50_000 };
  const OVER = { ...CART.items[0]!, quantity: 3, stock: 1, total: 150_000 };
  const APPLIED = { ...CART, couponCode: 'WELCOME30', discount: 30_000 };
  const networkError = () => new HttpError('Network Error', 'ERR_NETWORK');
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.voucherProps = [];
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.removeCartItem.mockResolvedValue(CART);
    mocks.updateCartItem.mockResolvedValue(CART);
  });

  it('chạm đúp "Bỏ khỏi đơn" trong cùng một khung hình: chỉ xoá dòng một lần', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [SOLD_OUT, { ...SOLD_OUT_2, stock: 5 }] });
    const remove = pending<typeof CART>();
    mocks.removeCartItem.mockReturnValue(remove.promise);
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    const button = within(problem).getByRole('button', { name: 'Bỏ khỏi đơn' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.removeCartItem).toHaveBeenCalledTimes(1);
    expect(mocks.removeCartItem).toHaveBeenCalledWith('ci1');
    await act(async () => remove.resolve(CART));
  });

  it('chạm đúp "Giảm còn 1" trong cùng một khung hình: chỉ sửa số lượng một lần', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [OVER] });
    const update = pending<typeof CART>();
    mocks.updateCartItem.mockReturnValue(update.promise);
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    const button = within(problem).getByRole('button', { name: 'Giảm còn 1' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.updateCartItem).toHaveBeenCalledTimes(1);
    expect(mocks.updateCartItem).toHaveBeenCalledWith('ci1', 1);
    await act(async () => update.resolve(CART));
  });

  it('hai dòng lỗi khác nhau: mỗi dòng vẫn xoá được song song, khoá chỉ chặn cú chạm lặp vào cùng một dòng', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [SOLD_OUT, SOLD_OUT_2] });
    const remove = pending<typeof CART>();
    mocks.removeCartItem.mockReturnValue(remove.promise);
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: 'Bỏ khỏi đơn' });
    expect(buttons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(buttons[0]!);
      fireEvent.click(buttons[1]!);
      fireEvent.click(buttons[0]!);
    });
    expect(mocks.removeCartItem.mock.calls.map((c) => c[0]).sort()).toEqual(['ci1', 'ci2']);
    await act(async () => remove.resolve(CART));
  });

  it('xoá dòng lỗi mạng thì nhả khoá: bấm lại xoá được', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, items: [SOLD_OUT, { ...SOLD_OUT_2, stock: 5 }] });
    mocks.removeCartItem.mockRejectedValueOnce(new Error('mạng')).mockResolvedValue(CART);
    renderPage();
    const problem = await screen.findByTestId('checkout-line-problem');
    const button = within(problem).getByRole('button', { name: 'Bỏ khỏi đơn' });
    await act(async () => fireEvent.click(button));
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    await act(async () => fireEvent.click(button));
    expect(mocks.removeCartItem).toHaveBeenCalledTimes(2);
  });

  describe('mã tự áp', () => {
    beforeEach(() => {
      mocks.getCoupons.mockResolvedValue([{ id: 'c1', code: 'WELCOME30' }]);
      mocks.getCouponPreviews.mockResolvedValue([{ code: 'WELCOME30', eligible: true, discount: 30_000 }]);
      mocks.applyCoupon.mockResolvedValue(APPLIED);
    });

    it('chạm đúp "Gỡ" mã tự áp trong cùng một khung hình: chỉ gỡ một lần', async () => {
      const remove = pending<typeof CART>();
      mocks.removeCoupon.mockReturnValue(remove.promise);
      renderPage();
      const button = await screen.findByTestId('coupon-auto-remove');
      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(mocks.removeCoupon).toHaveBeenCalledTimes(1);
      await act(async () => remove.resolve(CART));
    });

  });

  it('chạm đúp "Đặt hàng" trong cùng một khung hình: chỉ gửi một đơn (Button đã khoá sẵn vì onPress async, giữ để không lùi)', async () => {
    const place = pending<{ id: string; code: string }>();
    mocks.placeOrder.mockReturnValue(place.promise);
    renderPage();
    const btn = await screen.findByText(/Đặt hàng · /);
    await waitFor(() => expect(btn.closest('button')).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
    expect(btn.closest('button')).toHaveAttribute('aria-busy', 'true');
    await act(async () => place.resolve({ id: 'o1', code: 'TT001' }));
  });

  it('giỏ rỗng sau lỗi mạng: chạm đúp "Kiểm tra lại" chỉ gửi lại một lần', async () => {
    let cartData: typeof CART = CART;
    mocks.getCart.mockImplementation(async () => cartData);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const replay = pending<{ id: string; code: string }>();
    mocks.placeOrder.mockRejectedValueOnce(networkError()).mockReturnValueOnce(replay.promise);
    render(
      <QueryClientProvider client={qc}>
        <CheckoutPage />
      </QueryClientProvider>,
    );
    const place = await screen.findByText(/(Đặt hàng|Thử lại) · /);
    await waitFor(() => expect(place.closest('button')).not.toBeDisabled());
    fireEvent.click(place);
    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
    cartData = { ...CART, items: [], itemCount: 0, subtotal: 0 };
    await qc.invalidateQueries({ queryKey: ['cart'] });
    const recheck = await screen.findByText('Kiểm tra lại');
    await act(async () => {
      fireEvent.click(recheck);
      fireEvent.click(recheck);
    });
    expect(mocks.placeOrder).toHaveBeenCalledTimes(2);
    await act(async () => replay.resolve({ id: 'o1', code: 'TT001' }));
  });
});

describe('CheckoutPage — khoá chéo Đặt hàng với đổi mã, "Thử lại" báo giá và tải trang, đổi cách trả tiền lúc đang gửi (W92A)', () => {
  const A2 = { ...ADDRESS, id: 'a2', street: '9 Hai Bà Trưng', ward: 'Phường Sài Gòn', wardCode: '84_VN79_26734', isDefault: false };
  const APPLIED = { ...CART, couponCode: 'WELCOME30', discount: 30_000 };
  const networkError = () => new HttpError('Network Error', 'ERR_NETWORK');
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const renderWith = (qc: QueryClient) =>
    render(
      <QueryClientProvider client={qc}>
        <CheckoutPage />
      </QueryClientProvider>,
    );
  const voucherBusy = () => mocks.voucherProps[mocks.voucherProps.length - 1]!.busy;
  const placeButton = async () => (await screen.findByText(/(Đặt hàng|Thử lại) · /)).closest('button')!;

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.voucherProps = [];
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getCouponPreviews.mockResolvedValue([]);
  });

  describe('đơn đang gửi thì không đổi mã giữa chừng', () => {
    it('tấm chọn mã nhận busy suốt từ lúc chạm Đặt hàng, nhả khi đơn xong', async () => {
      const place = pending<{ id: string; code: string }>();
      mocks.placeOrder.mockReturnValue(place.promise);
      renderPage();
      const button = await placeButton();
      await waitFor(() => expect(button).not.toBeDisabled());
      expect(voucherBusy()).toBe(false);
      fireEvent.click(button);
      await waitFor(() => expect(voucherBusy()).toBe(true));
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
      expect(voucherBusy()).toBe(true);
      await act(async () => place.reject(new Error('Hết hàng')));
      await waitFor(() => expect(voucherBusy()).toBe(false));
    });

    it('đơn gửi lại bằng "Kiểm tra lại" (không qua nút Đặt hàng) rồi giỏ có hàng trở lại: tấm chọn mã vẫn busy', async () => {
      let cartData: typeof CART = CART;
      mocks.getCart.mockImplementation(async () => cartData);
      const qc = makeClient();
      const replay = pending<{ id: string; code: string }>();
      mocks.placeOrder.mockRejectedValueOnce(networkError()).mockReturnValueOnce(replay.promise);
      renderWith(qc);
      const button = await placeButton();
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
      cartData = { ...CART, items: [], itemCount: 0, subtotal: 0 };
      await qc.invalidateQueries({ queryKey: ['cart'] });
      fireEvent.click(await screen.findByText('Kiểm tra lại'));
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
      cartData = CART;
      await qc.invalidateQueries({ queryKey: ['cart'] });
      await screen.findByText(viCopy.checkout.placing);
      await waitFor(() => expect(voucherBusy()).toBe(true));
      await act(async () => replay.resolve({ id: 'o1', code: 'TT001' }));
    });

    it('nút "Gỡ" mã tự áp bị khoá khi đơn đang gửi, bấm không gọi API gỡ mã', async () => {
      mocks.getCoupons.mockResolvedValue([{ id: 'c1', code: 'WELCOME30' }]);
      mocks.getCouponPreviews.mockResolvedValue([{ code: 'WELCOME30', eligible: true, discount: 30_000 }]);
      mocks.applyCoupon.mockResolvedValue(APPLIED);
      const place = pending<{ id: string; code: string }>();
      mocks.placeOrder.mockReturnValue(place.promise);
      renderPage();
      const remove = await screen.findByTestId('coupon-auto-remove');
      const button = await placeButton();
      await waitFor(() => expect(button).not.toBeDisabled());
      expect(remove).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
      expect(remove).toBeDisabled();
      fireEvent.click(remove);
      expect(mocks.removeCoupon).not.toHaveBeenCalled();
      await act(async () => place.resolve({ id: 'o1', code: 'TT001' }));
    });
  });

  describe('đổi mã trong tấm chọn mã còn đang chạy thì chưa cho Đặt hàng', () => {
    it('lệnh áp/gỡ mã của tấm chọn mã đang bay: nút Đặt hàng khoá, bấm không gửi đơn; xong thì mở lại', async () => {
      const qc = makeClient();
      renderWith(qc);
      const button = await placeButton();
      await waitFor(() => expect(button).not.toBeDisabled());
      const change = pending<void>();
      let run!: Promise<unknown>;
      act(() => {
        run = qc.getMutationCache().build(qc, { mutationKey: COUPON_CHANGE_KEY, mutationFn: () => change.promise }).execute(undefined);
      });
      await waitFor(() => expect(button).toBeDisabled());
      fireEvent.click(button);
      expect(mocks.placeOrder).not.toHaveBeenCalled();
      await act(async () => {
        change.resolve();
        await run;
      });
      await waitFor(() => expect(button).not.toBeDisabled());
    });

    it('mutation khác khoá (không phải đổi mã) không làm khoá nút Đặt hàng', async () => {
      const qc = makeClient();
      renderWith(qc);
      const button = await placeButton();
      await waitFor(() => expect(button).not.toBeDisabled());
      const other = pending<void>();
      let run!: Promise<unknown>;
      act(() => {
        run = qc.getMutationCache().build(qc, { mutationKey: ['khac'], mutationFn: () => other.promise }).execute(undefined);
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(button).not.toBeDisabled();
      await act(async () => {
        other.resolve();
        await run;
      });
    });
  });

  describe('"Thử lại" trả refetch để khoá tới khi xong', () => {
    it('lần tải lại báo giá hỏng khi đã có số cũ: chạm đúp "Thử lại" trong cùng một khung hình chỉ hỏi máy chủ thêm một lần, nút báo bận', async () => {
      const qc = makeClient();
      renderWith(qc);
      await placeButton();
      mocks.checkoutQuote.mockRejectedValue(networkError());
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['quote'] });
      });
      const retry = await screen.findByRole('button', { name: 'Thử lại' });
      const before = mocks.checkoutQuote.mock.calls.length;
      const next = pending<typeof QUOTE>();
      mocks.checkoutQuote.mockReturnValue(next.promise);
      await act(async () => {
        fireEvent.click(retry);
        fireEvent.click(retry);
      });
      expect(mocks.checkoutQuote).toHaveBeenCalledTimes(before + 1);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Thử lại' })).toHaveAttribute('aria-busy', 'true'));
      expect(screen.getByRole('button', { name: 'Thử lại' }).style.opacity).toBe('0.6');
      await act(async () => next.resolve(QUOTE));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull());
    });

    it('"Thử lại" báo giá mà vẫn lỗi thì nhả khoá: bấm lần nữa vẫn hỏi lại', async () => {
      const qc = makeClient();
      renderWith(qc);
      await placeButton();
      mocks.checkoutQuote.mockRejectedValue(networkError());
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['quote'] });
      });
      const retry = await screen.findByRole('button', { name: 'Thử lại' });
      const before = mocks.checkoutQuote.mock.calls.length;
      await act(async () => fireEvent.click(retry));
      await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledTimes(before + 1));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Thử lại' })).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('button', { name: 'Thử lại' }).style.opacity).toBe('1');
      await act(async () => fireEvent.click(retry));
      await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledTimes(before + 2));
    });

    it('"Thử lại" báo giá không mở bảng Chi tiết tính tiền của thẻ chứa nó', async () => {
      const qc = makeClient();
      renderWith(qc);
      await placeButton();
      mocks.checkoutQuote.mockRejectedValue(networkError());
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['quote'] });
      });
      fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
      expect(screen.queryByText('Chi tiết tính tiền đơn hàng')).toBeNull();
    });

    it('giỏ không tải được (hồi quy): chạm đúp "Thử lại" trong cùng một khung hình chỉ tải giỏ thêm một lần, không tải lại địa chỉ đã có; trong lúc tải lại hiện khung chờ', async () => {
      mocks.getCart.mockRejectedValueOnce(networkError());
      renderPage();
      const retry = await screen.findByRole('button', { name: 'Thử lại' });
      const addressCalls = mocks.getAddresses.mock.calls.length;
      const next = pending<typeof CART>();
      mocks.getCart.mockReturnValue(next.promise);
      await act(async () => {
        fireEvent.click(retry);
        fireEvent.click(retry);
      });
      expect(mocks.getCart).toHaveBeenCalledTimes(2);
      expect(mocks.getAddresses).toHaveBeenCalledTimes(addressCalls);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull());
      await act(async () => next.resolve(CART));
      expect(await screen.findByText('Xà bông thảo mộc')).toBeInTheDocument();
    });

    it('địa chỉ không tải được (hồi quy): "Thử lại" tải lại địa chỉ mà không tải lại giỏ đã có', async () => {
      mocks.getAddresses.mockRejectedValueOnce(networkError());
      renderPage();
      const retry = await screen.findByRole('button', { name: 'Thử lại' });
      const cartCalls = mocks.getCart.mock.calls.length;
      const next = pending<(typeof ADDRESS)[]>();
      mocks.getAddresses.mockReturnValue(next.promise);
      await act(async () => fireEvent.click(retry));
      expect(mocks.getAddresses).toHaveBeenCalledTimes(2);
      expect(mocks.getCart).toHaveBeenCalledTimes(cartCalls);
      await act(async () => next.resolve([ADDRESS]));
      expect(await screen.findByText('Xà bông thảo mộc')).toBeInTheDocument();
    });
  });

  describe('đổi cách trả tiền khi đơn đang gửi (hồi quy: đơn về theo cách ĐÃ GỬI, không theo ô đang chọn)', () => {
    it('gửi COD rồi đổi sang Chuyển khoản trước khi đơn về: ở lại màn thành công, không nhảy sang màn QR', async () => {
      const place = pending<{ id: string; code: string }>();
      mocks.placeOrder.mockReturnValue(place.promise);
      renderPage();
      const button = await placeButton();
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
      expect(mocks.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'COD' });
      const bank = within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ });
      fireEvent.click(bank);
      expect(bank).toHaveAttribute('aria-checked', 'true');
      await act(async () => place.resolve({ id: 'o1', code: 'TT001' }));
      expect(await screen.findByTestId('order-success')).toBeInTheDocument();
      expect(mocks.navigate).not.toHaveBeenCalledWith(expect.stringContaining('/bank-payment'), expect.anything());
    });

    it('gửi Chuyển khoản rồi đổi sang COD trước khi đơn về: vẫn sang màn QR của đúng đơn', async () => {
      const place = pending<{ id: string; code: string }>();
      mocks.placeOrder.mockReturnValue(place.promise);
      renderPage();
      const button = await placeButton();
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
      fireEvent.click(button);
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
      expect(mocks.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'BANK_TRANSFER' });
      fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Thanh toán khi nhận hàng/ }));
      await act(async () => place.resolve({ id: 'o1', code: 'TT001' }));
      await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TT001', { replace: true }));
      expect(screen.queryByTestId('order-success')).toBeNull();
    });
  });

  describe('báo giá về trễ không đè kết quả mới hơn (hồi quy: khoá truy vấn theo địa chỉ)', () => {
    it('đổi địa chỉ khi báo giá địa chỉ cũ chưa về: số của địa chỉ cũ về muộn không hiện, đơn gửi theo địa chỉ và tổng mới', async () => {
      const slow = pending<typeof QUOTE>();
      mocks.getAddresses.mockResolvedValue([ADDRESS, A2]);
      mocks.checkoutQuote.mockImplementation((addressId: string) => (addressId === 'a1' ? slow.promise : Promise.resolve({ ...QUOTE, total: 99_000 })));
      mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
      renderPage();
      await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalledWith('a1', 0, undefined, undefined, {}));
      fireEvent.click(await screen.findByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
      fireEvent.click((await screen.findByText(/9 Hai Bà Trưng/)).closest('[role="radio"]')!);
      expect(await screen.findByText(/Đặt hàng · 99\.000/)).toBeInTheDocument();
      await act(async () => slow.resolve({ ...QUOTE, total: 70_000 }));
      expect(screen.queryByText(/70\.000/)).toBeNull();
      expect(screen.getByText(/Đặt hàng · 99\.000/)).toBeInTheDocument();
      const body = await placeOrderClick();
      expect(body).toMatchObject({ addressId: 'a2', expectedTotal: 99_000 });
    });
  });
});

// W113A: lệnh đặt đơn và sửa nhanh dòng bị máy chủ từ chối vì màn đã cũ (400/404/409) thì nút giữ khoá tới khi giỏ/báo giá/đơn làm mới về (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx không nói gì về giỏ: nhả ngay, bấm lại vẫn gửi đúng Idempotency-Key cũ.
describe('CheckoutPage — máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  const OVER = { ...CART.items[0]!, quantity: 3, stock: 1, total: 150_000 };
  const apiError = (status: number, code: string | null, message: string) =>
    new HttpError('Bad Request', 'ERR_BAD_REQUEST', { status, data: { statusCode: status, ...(code ? { code } : {}), message } });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <CheckoutPage />
      </QueryClientProvider>,
    );
    return invalidate;
  };
  const filters = (invalidate: ReturnType<typeof renderLive>) => invalidate.mock.calls.map(([filter]) => filter);
  const keysOf = (keys: string[][]) => keys.map((queryKey) => ({ queryKey }));
  const orderButton = async () => {
    const label = await screen.findByText(/(Đặt hàng|Thử lại) · /);
    return label.closest('button')!;
  };
  const openOrder = async (refresh: () => Promise<unknown>) => {
    const invalidate = renderLive(refresh);
    const button = await orderButton();
    await waitFor(() => expect(button).not.toBeDisabled());
    // Lúc đang gửi nhãn nút đổi thành "Đang đặt…": tìm theo thanh dính, không theo chữ.
    return { invalidate, button: () => within(screen.getByTestId('sticky-bar')).getAllByRole('button').slice(-1)[0]! };
  };

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    mocks.updateCartItem.mockReset();
    mocks.removeCartItem.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.voucherProps = [];
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.removeCartItem.mockResolvedValue(CART);
    mocks.updateCartItem.mockResolvedValue(CART);
  });

  describe('Đặt hàng', () => {
    const OK = { id: 'o1', code: 'TT001' };
    const CASES: Array<{ name: string; make: (status: number) => HttpError; statuses: number[]; keys: string[][]; toast: boolean }> = [
      { name: 'lời từ chối chung', make: (st) => apiError(st, null, 'Mã giảm giá đã hết hạn.'), statuses: [400, 404, 409], keys: [['cart'], ['quote'], ['orders']], toast: true },
      { name: 'CART_CHANGED', make: (st) => apiError(st, 'CART_CHANGED', 'Giỏ vừa đổi.'), statuses: [400, 409], keys: [['cart'], ['orders'], ['quote']], toast: true },
      { name: 'TOTAL_CHANGED', make: (st) => apiError(st, 'TOTAL_CHANGED', 'Tổng đơn đã thay đổi.'), statuses: [400, 409], keys: [['quote'], ['cart']], toast: false },
      { name: 'vượt giới hạn mua ưu đãi', make: (st) => apiError(st, null, 'Vượt giới hạn mua ưu đãi.'), statuses: [400], keys: [['cart']], toast: false },
    ];

    describe.each(CASES)('$name', (c) => {
      it.each(c.statuses.map((st) => [st]))('bị từ chối %i: tải lại đúng khoá, nút Đặt hàng giữ khoá tới khi dữ liệu về rồi mới nhả, bấm lại giữ đúng Idempotency-Key', async (status) => {
        mocks.placeOrder.mockRejectedValueOnce(c.make(status)).mockResolvedValue(OK);
        const refresh = deferred();
        const { invalidate, button } = await openOrder(() => refresh.promise);
        fireEvent.click(button());
        await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(filters(invalidate)).toEqual(keysOf(c.keys)));
        if (c.toast) await waitFor(() => expect(errorSnackbars()).toBe(1));
        expect(button()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          fireEvent.click(button());
          fireEvent.click(button());
        });
        expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
        await act(async () => refresh.resolve());
        await settle();
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
        if (c.toast) expect(errorSnackbars()).toBe(1);
        fireEvent.click(button());
        await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
        expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
      });
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', new HttpError('Service Unavailable', undefined, { status: 503, data: { message: 'Service Unavailable' }, headers: {} })],
      ['hết phiên 401', new HttpError('Unauthorized', undefined, { status: 401, data: { message: 'Unauthorized' }, headers: {} })],
    ])('%s: không giữ khoá chờ tải lại và không tải lại giỏ/báo giá/đơn; bấm lại gửi đúng Idempotency-Key cũ', async (_label, error) => {
      mocks.placeOrder.mockRejectedValueOnce(error).mockResolvedValue(OK);
      const { invalidate, button } = await openOrder(() => new Promise(() => undefined));
      fireEvent.click(button());
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
      await settle();
      await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      expect(invalidate).not.toHaveBeenCalled();
      fireEvent.click(button());
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
      expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
    });

    describe('giá đổi lúc đặt (PRICE_CHANGED)', () => {
      const openPriceChanged = async (status: number, refresh: () => Promise<unknown>) => {
        mocks.placeOrder.mockRejectedValueOnce(apiError(status, 'PRICE_CHANGED', 'PRICE_CHANGED')).mockResolvedValue(OK);
        const view = await openOrder(refresh);
        fireEvent.click(view.button());
        await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('Giá ưu đãi đã thay đổi')).toBeInTheDocument();
        return view;
      };

      it.each([[400], [409]])('bị từ chối %i: hộp báo riêng, tải lại giỏ và báo giá, nút Đặt hàng giữ khoá tới khi dữ liệu về rồi mới nhả, bấm lại giữ đúng Idempotency-Key', async (status) => {
        const refresh = deferred();
        const { invalidate, button } = await openPriceChanged(status, () => refresh.promise);
        await waitFor(() => expect(filters(invalidate)).toEqual(keysOf([['cart'], ['quote']])));
        expect(errorSnackbars()).toBe(0);
        expect(button()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          fireEvent.click(button());
          fireEvent.click(button());
        });
        expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
        await act(async () => refresh.resolve());
        await settle();
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
        fireEvent.click(button());
        await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
        expect(mocks.placeOrder.mock.calls[1]![1]).toBe(mocks.placeOrder.mock.calls[0]![1]);
      });

      it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
        mocks.placeOrder.mockRejectedValueOnce(apiError(400, 'PRICE_CHANGED', 'PRICE_CHANGED')).mockResolvedValue(OK);
        const { button } = await openOrder(() => new Promise(() => undefined));
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          fireEvent.click(button());
          expect(await screen.findByText('Giá ưu đãi đã thay đổi')).toBeInTheDocument();
          await act(async () => {
            await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
          });
          expect(button()).toHaveAttribute('aria-busy', 'true');
          await act(async () => {
            fireEvent.click(button());
          });
          expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
          });
          await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
        } finally {
          vi.useRealTimers();
        }
      });

      it('đóng hộp bằng nút Đóng (hay nền) cũng tải lại giỏ và báo giá như hai nút trong hộp', async () => {
        const { invalidate } = await openPriceChanged(400, () => Promise.resolve());
        await settle();
        invalidate.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
        expect(filters(invalidate)).toEqual(keysOf([['cart'], ['quote']]));
        await waitFor(() => expect(screen.queryByText('Giá ưu đãi đã thay đổi')).toBeNull());
      });
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      mocks.placeOrder.mockRejectedValueOnce(apiError(409, null, 'Giỏ vừa có thay đổi, bạn thử lại nhé.')).mockResolvedValue(OK);
      const { button } = await openOrder(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        fireEvent.click(button());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(button()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          fireEvent.click(button());
        });
        expect(mocks.placeOrder).toHaveBeenCalledTimes(1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      } finally {
        vi.useRealTimers();
      }
      fireEvent.click(button());
      await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(2));
    });
  });

  describe('sửa nhanh dòng (Giảm còn / Bỏ khỏi đơn)', () => {
    const openFix = async (refresh: () => Promise<unknown>) => {
      mocks.getCart.mockResolvedValue({ ...CART, items: [OVER] });
      const invalidate = renderLive(refresh);
      const problem = await screen.findByTestId('checkout-line-problem');
      return { invalidate, button: () => within(screen.getByTestId('checkout-line-problem')).getByRole('button', { name: 'Giảm còn 1' }), problem };
    };

    it.each([
      [400, 'Kho đã đổi, bạn thử lại nhé.'],
      [404, 'Dòng này không còn trong giỏ.'],
      [409, 'Giỏ vừa có thay đổi, bạn thử lại nhé.'],
    ])('bị từ chối %i: tải lại giỏ và báo giá, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      mocks.updateCartItem.mockRejectedValueOnce(apiError(status, null, message)).mockResolvedValue(CART);
      const refresh = deferred();
      const { invalidate, button } = await openFix(() => refresh.promise);
      fireEvent.click(button());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      expect(errorSnackbars()).toBe(1);
      expect(filters(invalidate)).toEqual(keysOf([['cart'], ['quote']]));
      await act(async () => {
        fireEvent.click(button());
        fireEvent.click(button());
      });
      expect(mocks.updateCartItem).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      expect(errorSnackbars()).toBe(1);
      fireEvent.click(button());
      await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', new HttpError('Service Unavailable', undefined, { status: 503, data: { message: 'Service Unavailable' }, headers: {} })],
      ['hết phiên 401', new HttpError('Unauthorized', undefined, { status: 401, data: { message: 'Unauthorized' }, headers: {} })],
    ])('%s: không giữ khoá; chỉ tải lại giỏ ở nền như trước (kết quả có thể đã ghi), không tải báo giá', async (_label, error) => {
      mocks.updateCartItem.mockRejectedValueOnce(error).mockResolvedValue(CART);
      const { invalidate, button } = await openFix(() => new Promise(() => undefined));
      fireEvent.click(button());
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(filters(invalidate)).toEqual(keysOf([['cart']]));
      fireEvent.click(button());
      await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      mocks.updateCartItem.mockRejectedValueOnce(apiError(409, null, 'Giỏ vừa có thay đổi, bạn thử lại nhé.')).mockResolvedValue(CART);
      const { button } = await openFix(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        fireEvent.click(button());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        await act(async () => {
          fireEvent.click(button());
        });
        expect(mocks.updateCartItem).toHaveBeenCalledTimes(1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
      } finally {
        vi.useRealTimers();
      }
      fireEvent.click(button());
      await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2));
    });
  });
});

describe('CheckoutPage — phân loại không có tên (86/154 phân loại trên PROD)', () => {
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.kind = 'ctv';
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  const withVariation = (variationName: unknown) => ({ ...CART, items: [{ ...CART.items[0]!, variationName }] });
  const columnTexts = async (variationName: unknown) => {
    mocks.getCart.mockResolvedValue(withVariation(variationName));
    const { unmount } = renderPage();
    const column = (await screen.findByText('Xà bông thảo mộc')).parentElement!;
    const texts = Array.from(column.children).map((n) => n.textContent);
    unmount();
    return texts;
  };

  it('có tên: dòng phân loại hiện giữa tên sản phẩm và dòng giá × SL', async () => {
    const named = await columnTexts('Sả');
    expect(named.slice(0, 3)).toEqual(['Xà bông thảo mộc', 'Sả', '50.000đ × 1']);
  });

  it('tên trống, toàn khoảng trắng hay null: không dựng dòng phân loại (cột chữ ít đúng một khối)', async () => {
    const named = await columnTexts('Sả');
    for (const name of ['', '   ', null]) {
      const blank = await columnTexts(name);
      expect(blank).toHaveLength(named.length - 1);
      expect(blank.slice(0, 2)).toEqual(['Xà bông thảo mộc', '50.000đ × 1']);
    }
  });

  it('tên phân loại dạng đối tượng { name } (đã đọc được từ trước) vẫn hiện; đối tượng không có name thì ẩn', async () => {
    expect((await columnTexts({ name: 'Sả' }))[1]).toBe('Sả');
    expect((await columnTexts({ name: '' }))[1]).toBe('50.000đ × 1');
    expect((await columnTexts({}))[1]).toBe('50.000đ × 1');
  });
});

describe('CheckoutPage — phễu mua (checkout_started, checkout_step, checkout_abandoned)', () => {
  const TWO_LINES = {
    ...CART,
    items: [CART.items[0]!, { ...CART.items[0]!, id: 'ci2', variationId: 'v2', productName: 'Nước rửa chén' }],
    subtotal: 100_000,
    itemCount: 2,
  };
  const events = (name: string) => vi.mocked(trackEvent).mock.calls.filter((c) => c[0] === name).map((c) => c[2]);
  const started = async () => {
    await waitFor(() => expect(events('checkout_started')).toHaveLength(1));
    return events('checkout_started')[0];
  };

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    takeCheckoutEntry();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.kind = 'ctv';
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.user.phone = '0900000000';
    mocks.locState = null;
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(TWO_LINES);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });
  afterEach(() => {
    mocks.locState = null;
  });

  it.each([
    ['buy_now', { itemIds: ['ci1'] }, 1],
    ['cart_subset', { itemIds: ['ci2'] }, 1],
    ['cart', { itemIds: null }, 2],
    ['flash', { itemIds: ['ci1'] }, 1],
  ] as const)('nơi bấm ghi dấu %s → checkout_started mang đúng entry, một lần', async (entry, state, itemCount) => {
    setCheckoutEntry(entry);
    mocks.locState = state;
    renderPage();
    expect(await started()).toEqual({ entry, itemCount });
    expect(takeCheckoutEntry()).toBe('unknown');
  });

  it('không có dấu nơi bấm (tải lại trang): có lựa chọn món → cart_subset, không có → cart', async () => {
    mocks.locState = { itemIds: ['ci1'] };
    const a = renderPage();
    expect(await started()).toEqual({ entry: 'cart_subset', itemCount: 1 });
    a.unmount();
    vi.mocked(trackEvent).mockClear();
    mocks.locState = { itemIds: null };
    renderPage();
    expect(await started()).toEqual({ entry: 'cart', itemCount: 2 });
  });

  it('các bước: địa chỉ có sẵn và báo giá đầu phát ngay sau checkout_started; đổi cách thanh toán và bấm Đặt hàng phát theo thao tác', async () => {
    renderPage();
    await started();
    fireEvent.click(await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    await placeOrderClick();
    const funnel = vi.mocked(trackEvent).mock.calls.filter((c) => c[0] === 'checkout_started' || c[0] === 'checkout_step').map((c) => [c[0], c[2]]);
    expect(funnel).toEqual([
      ['checkout_started', { entry: 'cart', itemCount: 2 }],
      ['checkout_step', { step: 'address_saved' }],
      ['checkout_step', { step: 'shipping_quote_shown' }],
      ['checkout_step', { step: 'payment_method_selected', paymentMethod: 'BANK_TRANSFER' }],
      ['checkout_step', { step: 'place_order_click' }],
    ]);
  });

  it('rời màn khi chưa đặt được đơn → checkout_abandoned đúng một lần, lastStep là bước xa nhất đã tới', async () => {
    const view = renderPage();
    await started();
    fireEvent.click(await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    view.unmount();
    expect(events('checkout_abandoned')).toEqual([{ lastStep: 'payment_method_selected' }]);
  });

  it('đặt đơn thành công rồi rời màn → không có checkout_abandoned', async () => {
    const view = renderPage();
    await placeOrderClick();
    await screen.findByTestId('order-success');
    view.unmount();
    expect(events('checkout_abandoned')).toEqual([]);
  });

  it('chuyển khoản: đơn tạo xong sang màn QR → không có checkout_abandoned', async () => {
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001', paymentMethod: 'BANK_TRANSFER' });
    const view = renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    await placeOrderClick();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TT001', { replace: true }));
    view.unmount();
    expect(events('checkout_abandoned')).toEqual([]);
  });

  it('chưa có checkout_started (báo giá chưa về) mà rời màn → không có gì để bỏ dở', async () => {
    mocks.checkoutQuote.mockReturnValue(new Promise(() => {}));
    const view = renderPage();
    await waitFor(() => expect(mocks.checkoutQuote).toHaveBeenCalled());
    view.unmount();
    expect(events('checkout_started')).toEqual([]);
    expect(events('checkout_abandoned')).toEqual([]);
  });
});

describe('CheckoutPage — ô nhận hành trình đơn qua Zalo (wave tubu-mss-consent-ui)', () => {
  const STATUS = { enabled: true, prechecked: false, choice: null, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.publicConfig.waste.pickup = false;
    mocks.publicConfig.orderZaloEnabled = false;
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.user.phone = '0900000000';
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getAddresses.mockResolvedValue([ADDRESS]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.coreGet.mockResolvedValue(STATUS);
  });
  afterEach(() => {
    mocks.publicConfig.orderZaloEnabled = false;
  });

  it('cờ tắt: không hỏi máy chủ, không có ô, thân đơn không có orderZaloConsent', async () => {
    renderPage();
    const body = await placeOrderClick();
    expect(screen.queryByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ })).toBeNull();
    expect(mocks.coreGet).not.toHaveBeenCalled();
    expect('orderZaloConsent' in body).toBe(false);
  });

  it('cờ bật: ô ngay trên dòng điều khoản, không tick sẵn, có câu PO và số đã che; đặt luôn thì gửi false', async () => {
    mocks.publicConfig.orderZaloEnabled = true;
    renderPage();
    const row = await screen.findByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });
    expect(mocks.coreGet).toHaveBeenCalledWith('/config/order-zalo');
    expect(row).toHaveAttribute('aria-checked', 'false');
    expect(row).toHaveTextContent('Nhận hành trình đơn hàng qua Zalo');
    expect(row).toHaveTextContent('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này.');
    expect(row).toHaveTextContent('Số nhận: 090•••4567');
    expect(row.compareDocumentPosition(screen.getByTestId('order-consent')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trackEvent).toHaveBeenCalledWith('order_zalo_consent_shown', 'miniapp', {});
    const body = await placeOrderClick();
    expect(body.orderZaloConsent).toBe(false);
  });

  it('tick ô (chạm hoặc phím Space) → thân place-order có orderZaloConsent: true, đo sự kiện checked', async () => {
    mocks.publicConfig.orderZaloEnabled = true;
    renderPage();
    const row = await screen.findByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ });
    fireEvent.keyDown(row, { key: ' ' });
    expect(row).toHaveAttribute('aria-checked', 'true');
    expect(trackEvent).toHaveBeenCalledWith('order_zalo_consent_checked', 'miniapp', { checked: true });
    const body = await placeOrderClick();
    expect(body.orderZaloConsent).toBe(true);
  });

  it('lần sau nhớ lựa chọn đã bật: ô tick sẵn theo lựa chọn của khách', async () => {
    mocks.publicConfig.orderZaloEnabled = true;
    mocks.coreGet.mockResolvedValue({ ...STATUS, choice: true });
    renderPage();
    expect(await screen.findByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('không có số đã xác minh: không hiện ô, không gửi trường', async () => {
    mocks.publicConfig.orderZaloEnabled = true;
    mocks.coreGet.mockResolvedValue({ ...STATUS, phoneMasked: null });
    renderPage();
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalled());
    const body = await placeOrderClick();
    expect(screen.queryByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ })).toBeNull();
    expect('orderZaloConsent' in body).toBe(false);
  });

  it('lỗi tải trạng thái Zalo: vẫn đặt được hàng, không gửi trường (máy chủ dùng lựa chọn đã nhớ)', async () => {
    mocks.publicConfig.orderZaloEnabled = true;
    mocks.coreGet.mockRejectedValue(new Error('mạng'));
    renderPage();
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalled());
    const body = await placeOrderClick();
    expect(screen.queryByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ })).toBeNull();
    expect('orderZaloConsent' in body).toBe(false);
  });

  it('đơn trước vừa đổi lựa chọn (cache còn choice cũ): mở lại màn hỏi lại máy chủ, chưa có câu trả lời thì chưa hiện ô, không tick theo cache', async () => {
    mocks.publicConfig.orderZaloEnabled = true;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(ORDER_ZALO_KEY, { ...STATUS, choice: true });
    let answer!: (v: unknown) => void;
    mocks.coreGet.mockReturnValue(new Promise((r) => (answer = r)));
    render(
      <QueryClientProvider client={qc}>
        <CheckoutPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalledWith('/config/order-zalo'));
    expect(screen.queryByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ })).toBeNull();
    await act(async () => answer({ ...STATUS, choice: false }));
    expect(await screen.findByRole('checkbox', { name: /Nhận hành trình đơn hàng qua Zalo/ })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('CheckoutPage — địa chỉ gọn, đổi trong 2 chạm, xem trước chuyển khoản (w2-06)', () => {
  const B2 = { ...ADDRESS, id: 'a2', recipient: 'Bình', street: '9 Hai Bà Trưng', isDefault: false };
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const placeBtn = async () => (await screen.findByText(/Đặt hàng · /)).closest('button')!;
  const switchTo = async (name: RegExp) => {
    fireEvent.click(await screen.findByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    fireEvent.click(await screen.findByRole('radio', { name }));
  };
  const PREVIEW_ON = { enabled: true, bank: { name: 'Techcombank', accountName: 'CONG TY TUBU TREE' } };

  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    mocks.placeOrder.mockReset();
    mocks.checkoutQuote.mockReset();
    mocks.coreGet.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.sfCtx.referralEligible = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS, B2]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.coreGet.mockResolvedValue(undefined);
  });

  it('đổi địa chỉ: tổng cũ đứng yên trên nút (không về "…"), nút khoá tới khi báo giá mới về rồi mở với tổng mới', async () => {
    const slow = pending<typeof QUOTE>();
    mocks.checkoutQuote.mockImplementation((addressId: string) => (addressId === 'a1' ? Promise.resolve(QUOTE) : slow.promise));
    renderPage();
    const btn = await placeBtn();
    await waitFor(() => expect(btn).not.toBeDisabled());
    await switchTo(/Bình/);
    expect(await screen.findByTestId('checkout-address-row')).toHaveTextContent('Bình');
    expect(screen.getByText(/Đặt hàng · 70\.000/).closest('button')).toBeDisabled();
    expect(screen.queryByText('…')).toBeNull();
    expect(screen.getByText('Đang tính lại…')).toBeInTheDocument();
    await act(async () => slow.resolve({ ...QUOTE, shippingFee: 30_000, total: 80_000 }));
    const next = (await screen.findByText(/Đặt hàng · 80\.000/)).closest('button')!;
    await waitFor(() => expect(next).not.toBeDisabled());
    expect(screen.queryByText('Đang tính lại…')).toBeNull();
    const body = await placeOrderClick();
    expect(body).toMatchObject({ addressId: 'a2', expectedTotal: 80_000 });
    expect(JSON.parse(localStorage.getItem('tubu_recent_address_ids:u1') ?? '[]')).toEqual(['a2']);
  });

  it('báo giá của địa chỉ mới lỗi: giữ địa chỉ mới, hiện lỗi kèm Thử lại, nút Đặt hàng không dùng số cũ', async () => {
    mocks.checkoutQuote.mockImplementation((addressId: string) => (addressId === 'a1' ? Promise.resolve(QUOTE) : Promise.reject(new Error('mạng'))));
    renderPage();
    await placeBtn();
    await switchTo(/Bình/);
    expect(await screen.findByRole('button', { name: viCopy.common.retry })).toBeInTheDocument();
    expect(screen.getByTestId('checkout-address-row')).toHaveTextContent('Bình');
    expect(screen.queryByText(/Đặt hàng · 70\.000/)).toBeNull();
  });

  it('Chuyển khoản, cờ bật: thẻ có ngân hàng, chủ tài khoản, đúng tổng báo giá; KHÔNG có mã QR trước khi đặt', async () => {
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.coreGet.mockImplementation((path: string) => Promise.resolve(path === '/payments/bank-preview' ? PREVIEW_ON : undefined));
    renderPage();
    await placeBtn();
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    const card = await screen.findByTestId('transfer-preview');
    expect(card).toHaveTextContent('Techcombank');
    expect(card).toHaveTextContent('CONG TY TUBU TREE');
    expect(card).toHaveTextContent('70.000');
    expect(card).toHaveTextContent('Mã QR có đúng số tiền và nội dung sẽ hiện ngay sau khi bạn bấm Đặt hàng.');
    expect(document.querySelector('img[alt="VietQR"], img[src*="vietqr"], canvas')).toBeNull();
    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith('transfer_preview_shown', 'miniapp', {});
  });

  it('cờ tắt (hoặc API cũ): chọn Chuyển khoản không có thẻ nào, màn như trước', async () => {
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.coreGet.mockImplementation((path: string) => Promise.resolve(path === '/payments/bank-preview' ? { enabled: false, bank: null } : undefined));
    renderPage();
    await placeBtn();
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalledWith('/payments/bank-preview'));
    expect(screen.queryByTestId('transfer-preview')).toBeNull();
    expect(vi.mocked(trackEvent)).not.toHaveBeenCalledWith('transfer_preview_shown', expect.anything(), expect.anything());
  });

  it('đặt đơn Chuyển khoản: gọi QR của đúng đơn ngay khi đơn về rồi sang màn QR', async () => {
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.getBankQr.mockResolvedValue({ orderCode: 'TT009' });
    mocks.placeOrder.mockResolvedValue({ id: 'o9', code: 'TT009', paymentMethod: 'BANK_TRANSFER' });
    renderPage();
    await placeBtn();
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    await placeOrderClick();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TT009', { replace: true }));
    expect(mocks.getBankQr).toHaveBeenCalledWith('TT009');
  });
});

describe('CheckoutPage — giữ địa chỉ và ghi chú qua một lần sang giỏ sửa hàng, dòng phụ cách thanh toán (tubu-w22-03)', () => {
  const ADDRESS_B = { ...ADDRESS, id: 'a2', recipient: 'Bình', street: '9 Hàng Bài', isDefault: false };
  const DRAFT = 'tubu_checkout_draft:u1';
  beforeEach(() => {
    mocks.publicConfig.waste.pickup = false;
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.sfCtx.slug = null;
    mocks.sfCtx.referralCode = null;
    mocks.getAddresses.mockResolvedValue([ADDRESS, ADDRESS_B]);
    mocks.getCart.mockResolvedValue(CART);
    mocks.checkoutQuote.mockResolvedValue(QUOTE);
    mocks.placeOrder.mockResolvedValue({ id: 'o1', code: 'TT001' });
    mocks.ensurePhone.mockResolvedValue('0900000000');
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0 });
  });

  it('quay lại từ giỏ: địa chỉ đã chọn (không phải mặc định) và ghi chú còn nguyên; cách trả tiền về COD; bản nháp xoá sau khi đọc', async () => {
    sessionStorage.setItem(DRAFT, JSON.stringify({ addressId: 'a2', note: 'Giao giờ hành chính', at: Date.now() }));
    renderPage();
    expect(await screen.findByDisplayValue('Giao giờ hành chính')).toBeInTheDocument();
    const body = await placeOrderClick();
    expect(body).toMatchObject({ addressId: 'a2', note: 'Giao giờ hành chính', paymentMethod: 'COD' });
    expect(sessionStorage.getItem(DRAFT)).toBeNull();
  });

  it('địa chỉ của bản nháp đã bị xoá: dùng địa chỉ mặc định', async () => {
    sessionStorage.setItem(DRAFT, JSON.stringify({ addressId: 'gone', note: '', at: Date.now() }));
    renderPage();
    const body = await placeOrderClick();
    expect(body.addressId).toBe('a1');
  });

  it('FLASH_LIMIT rồi chạm "Về giỏ hàng": ghi địa chỉ đang chọn và ghi chú đã gõ (không ghi cách trả tiền)', async () => {
    mocks.placeOrder.mockRejectedValue(
      Object.assign(new Error('x'), { isHttpError: true, response: { status: 400, data: { code: 'FLASH_LIMIT', limit: 2, message: 'Vượt giới hạn.' } } }),
    );
    renderPage();
    // Khách tự đổi sang địa chỉ phụ trên màn (không gieo nháp trước): bản ghi phải lấy đúng địa chỉ đang chọn lúc chạm.
    fireEvent.click(await screen.findByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Bình/ }));
    await waitFor(() => expect(screen.getByTestId('checkout-address-row')).toHaveTextContent('Bình'));
    fireEvent.change(await screen.findByLabelText(viCopy.checkout.note), { target: { value: 'Để ở bảo vệ' } });
    fireEvent.click(within(paymentBox()).getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    await placeOrderClick();
    const banner = await screen.findByTestId('checkout-cart-issue');
    fireEvent.click(within(banner).getByRole('button', { name: 'Về giỏ hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    const saved = JSON.parse(sessionStorage.getItem(DRAFT)!) as Record<string, unknown>;
    expect(saved).toMatchObject({ addressId: 'a2', note: 'Để ở bảo vệ' });
    expect(saved).not.toHaveProperty('payment');
  });

  it('dòng phụ là mô tả của radio, tên giữ ngắn; cách bị khoá thì lý do khoá thay dòng phụ', async () => {
    const reason = 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ.';
    mocks.checkoutQuote.mockResolvedValue({ ...QUOTE, blockedPaymentMethods: { COD: reason } });
    renderPage();
    await screen.findByText('Phương thức thanh toán');
    const bank = await within(paymentBox()).findByRole('radio', { name: 'Chuyển khoản ngân hàng' });
    expect(bank).toHaveAccessibleDescription(fillCopy('checkout.payCueBank'));
    const cod = within(paymentBox()).getByRole('radio', { name: /Thanh toán khi nhận hàng/ });
    await waitFor(() => expect(cod).toHaveAccessibleDescription(reason));
    expect(paymentBox()).not.toHaveTextContent(fillCopy('checkout.payCueCod'));
  });
});
