import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({
  getCoupons: vi.fn(),
  getCouponPreviews: vi.fn(),
  applyCoupon: vi.fn(),
  removeCoupon: vi.fn(),
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/account-api', () => ({ getCoupons: mocks.getCoupons }));
vi.mock('../../services/shop-api', () => ({
  applyCoupon: mocks.applyCoupon,
  removeCoupon: mocks.removeCoupon,
  getCouponPreviews: mocks.getCouponPreviews,
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { VoucherSheet } from './voucher-sheet';

const COUPONS = [
  { code: 'GIAM10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50_000, endAt: '2027-01-01T00:00:00.000Z' },
  { code: 'FREESHIP', type: 'FREESHIP', value: 20_000, minOrder: 500_000, maxDiscount: null, endAt: '2027-01-01T00:00:00.000Z' },
];

function renderSheet(
  currentCode?: string,
  extra: {
    onClose?: () => void;
    onCouponApplied?: () => void;
    subtotal?: number;
    shippingFee?: number;
    previewParams?: { addressId?: string; itemIds?: string[] };
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoucherSheet visible onClose={extra.onClose ?? (() => {})} onCouponApplied={extra.onCouponApplied} currentCode={currentCode} subtotal={extra.subtotal ?? 100_000} shippingFee={extra.shippingFee} previewParams={extra.previewParams} />
    </QueryClientProvider>,
  );
}

const px = (v: string) => Number.parseFloat(v);
// Nút đóng của BottomSheet (IconButton) khai báo vùng chạm bằng min-width/min-height.
const declared = (el: HTMLElement, axis: 'w' | 'h') => Math.max(px(axis === 'w' ? el.style.width : el.style.height) || 0, px(axis === 'w' ? el.style.minWidth : el.style.minHeight) || 0);

describe('VoucherSheet — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nút đóng (x) vuông tối thiểu 44x44', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS);
    renderSheet();
    const close = await screen.findByRole('button', { name: 'Đóng' });
    expect(declared(close, 'w')).toBeGreaterThanOrEqual(44);
    expect(declared(close, 'h')).toBeGreaterThanOrEqual(44);
  });

  it('nút "Dùng mã" / "Chưa đủ" / "Bỏ dùng" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS);
    renderSheet('GIAM10');
    const used = await screen.findByRole('button', { name: 'Bỏ dùng' });
    const notEnough = await screen.findByRole('button', { name: 'Chưa đủ' });
    expect(px(used.style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(px(notEnough.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('"Dùng mã" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS.slice(0, 1));
    renderSheet();
    const use = await screen.findByRole('button', { name: 'Dùng mã' });
    expect(px(use.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('tải mã lỗi → "Thử lại" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockRejectedValue(new Error('Mạng lỗi'));
    renderSheet();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(px(retry.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});

describe('VoucherSheet — hành vi (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoupons.mockResolvedValue(COUPONS);
    mocks.applyCoupon.mockResolvedValue({ couponCode: 'GIAM10' });
    mocks.removeCoupon.mockResolvedValue({ couponCode: null });
  });

  it('tiêu đề h2, ghi chú 1 mã/đơn, ô nhập có tên truy cập, mô tả từng loại mã và điều kiện đơn tối thiểu', async () => {
    renderSheet();
    expect(await screen.findByRole('heading', { level: 2, name: 'Chọn mã giảm giá' })).toBeInTheDocument();
    expect(screen.getByText('Mỗi đơn hàng chỉ áp dụng 1 mã giảm giá')).toBeInTheDocument();
    expect(screen.getByLabelText('Nhập mã giảm giá khác')).toBeInTheDocument();
    expect(await screen.findByText('Giảm 10% (tối đa 50.000đ)')).toBeInTheDocument();
    expect(screen.getByText('Miễn phí giao hàng')).toBeInTheDocument();
    expect(screen.queryByText(/Miễn phí giao hàng \(tối đa/)).toBeNull();
    expect(screen.getByText('Cần đơn tối thiểu 500.000đ')).toBeInTheDocument();
    expect(screen.getAllByText('HSD: 01/01/2027')).toHaveLength(2);
  });

  it('mã không có hạn hoặc hạn hỏng → "HSD: Không thời hạn", không hiện "—" hay Invalid Date', async () => {
    mocks.getCoupons.mockResolvedValue([
      { ...COUPONS[0], code: 'KHONGHAN', endAt: null },
      { ...COUPONS[0], code: 'HANHONG', endAt: 'không phải ngày' },
    ]);
    renderSheet();
    expect(await screen.findAllByText('HSD: Không thời hạn')).toHaveLength(2);
    expect(screen.queryByText(/Invalid Date|—/)).toBeNull();
  });

  it('chạm "Dùng mã" → áp dụng đúng mã, báo thành công, báo cho trang và đóng sheet', async () => {
    const onClose = vi.fn();
    const onCouponApplied = vi.fn();
    renderSheet(undefined, { onClose, onCouponApplied });
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mã' }));
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('GIAM10'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCouponApplied).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã áp dụng mã GIAM10', type: 'success' }));
  });

  it('mã được giữ nhưng giỏ giảm 0đ kèm lời báo (combo kéo dưới đơn tối thiểu): hiện lời báo dạng cảnh báo, không báo "đã áp dụng"', async () => {
    const notice = 'Mã chưa được áp dụng cho đơn này (phần giảm combo không được tính vào điều kiện của mã): Đơn tối thiểu 95.000đ để dùng mã này.';
    mocks.applyCoupon.mockResolvedValue({ couponCode: 'GIAM10', discount: 0, freeship: false, couponNotice: notice });
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mã' }));
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('GIAM10'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: notice, type: 'warning' })));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã áp dụng mã GIAM10' }));
  });

  it('mã chưa đủ điều kiện: nút "Chưa đủ" bị khoá, bấm không gọi API', async () => {
    renderSheet();
    const notEnough = await screen.findByRole('button', { name: 'Chưa đủ' });
    expect(notEnough).toBeDisabled();
    fireEvent.click(notEnough);
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('nhập mã tay: bỏ khoảng trắng + IN HOA; ô trống thì nút "Áp dụng" khoá; Enter cũng áp dụng', async () => {
    renderSheet();
    await screen.findByRole('button', { name: 'Dùng mã' });
    const apply = screen.getByRole('button', { name: 'Áp dụng' });
    expect(apply).toBeDisabled();
    const input = screen.getByLabelText('Nhập mã giảm giá khác');
    fireEvent.change(input, { target: { value: '  welcome ' } });
    expect(apply).toBeEnabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('WELCOME'));
  });

  it('mã đang dùng: nhãn "Đang dùng" và "Bỏ dùng" gỡ mã, báo trang nhưng KHÔNG đóng sheet', async () => {
    const onClose = vi.fn();
    const onCouponApplied = vi.fn();
    renderSheet('giam10', { onClose, onCouponApplied });
    expect(await screen.findByText('Đang dùng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ dùng' }));
    await waitFor(() => expect(mocks.removeCoupon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCouponApplied).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã bỏ mã giảm giá' }));
  });

  it('áp dụng đang chạy: nút của chính mã đó hiện trạng thái đang tải, nút khác bị khoá', async () => {
    mocks.getCoupons.mockResolvedValue([COUPONS[0], { ...COUPONS[0], code: 'KHAC' }]);
    mocks.applyCoupon.mockReturnValue(new Promise(() => {}));
    renderSheet();
    const buttons = await screen.findAllByRole('button', { name: 'Dùng mã' });
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Dùng mã' })[0]).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getAllByRole('button', { name: 'Dùng mã' })[1]).toBeDisabled();
  });

  it('áp dụng mã trong danh sách: nút "Áp dụng" của ô nhập tay bị khoá, không quay spinner', async () => {
    mocks.getCoupons.mockResolvedValue([COUPONS[0]]);
    mocks.applyCoupon.mockReturnValue(new Promise(() => {}));
    renderSheet();
    fireEvent.change(await screen.findByLabelText('Nhập mã giảm giá khác'), { target: { value: 'abc' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mã' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dùng mã' })).toHaveAttribute('aria-busy', 'true'));
    const manual = screen.getByRole('button', { name: 'Áp dụng' });
    expect(manual).toBeDisabled();
    expect(manual).not.toHaveAttribute('aria-busy');
  });

  it('áp dụng mã nhập tay: nút "Áp dụng" quay spinner, nút "Dùng mã" trong danh sách bị khoá', async () => {
    mocks.getCoupons.mockResolvedValue([COUPONS[0]]);
    mocks.applyCoupon.mockReturnValue(new Promise(() => {}));
    renderSheet();
    await screen.findByRole('button', { name: 'Dùng mã' });
    fireEvent.change(screen.getByLabelText('Nhập mã giảm giá khác'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Áp dụng' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Dùng mã' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dùng mã' })).not.toHaveAttribute('aria-busy');
  });

  it('không có mã nào → trạng thái trống hướng dẫn nhập tay', async () => {
    mocks.getCoupons.mockResolvedValue([]);
    renderSheet();
    expect(await screen.findByText('Bạn chưa có mã giảm giá trong ví')).toBeInTheDocument();
    expect(screen.getByText('Nhập mã giảm giá thủ công ở phía trên để áp dụng.')).toBeInTheDocument();
  });

  it('tải lỗi → hiện lý do và "Thử lại" tải lại được', async () => {
    mocks.getCoupons.mockRejectedValueOnce(new Error('Mạng lỗi')).mockResolvedValue(COUPONS);
    renderSheet();
    expect(await screen.findByText(/Không thể tải danh sách mã giảm giá/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('GIAM10')).toBeInTheDocument();
  });

  it('nút đóng gọi onClose', async () => {
    const onClose = vi.fn();
    renderSheet(undefined, { onClose });
    fireEvent.click(await screen.findByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('VoucherSheet — mã chỉ áp cho sản phẩm cụ thể (R2-BUYERMINI-3)', () => {
  beforeEach(() => vi.clearAllMocks());

  const scoped = { code: 'GBUY-CHIA', type: 'AMOUNT', value: 17_250, minOrder: null, maxDiscount: null, endAt: '2027-01-01T00:00:00.000Z', products: [{ id: 'p-chia', name: 'Hạt chia Úc' }] };
  const renderWith = (productIds: string[]) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <VoucherSheet visible onClose={() => {}} subtotal={300_000} productIds={productIds} />
      </QueryClientProvider>,
    );
  };

  it('giỏ không có sản phẩm của mã: ghi rõ mã chỉ áp cho sản phẩm nào và không cho bấm dùng', async () => {
    mocks.getCoupons.mockResolvedValue([scoped]);
    renderWith(['p-dau-goi']);
    expect(await screen.findByText('Chỉ áp cho Hạt chia Úc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Không áp dụng' })).toBeDisabled();
  });

  it('giỏ có sản phẩm của mã: dùng được như thường', async () => {
    mocks.getCoupons.mockResolvedValue([scoped]);
    renderWith(['p-chia']);
    expect(await screen.findByRole('button', { name: 'Dùng mã' })).toBeEnabled();
    expect(screen.getByText('Chỉ áp cho Hạt chia Úc')).toBeInTheDocument();
  });
});

describe('VoucherSheet: mã freeship khi phí ship đã 0 (R6-BUYER-12)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('không tự tính "Giảm X cho đơn này": API tính trên hàng không flash, sau combo và theo phạm vi sản phẩm của mã', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS);
    renderSheet(undefined, { subtotal: 438_000 });
    await screen.findByText('Giảm 10% (tối đa 50.000đ)');
    expect(screen.queryByText(/cho đơn này/)).toBeNull();
  });

  it('phí ship đã 0: mã freeship bị làm mờ và khoá, ghi lý do', async () => {
    mocks.getCoupons.mockResolvedValue([{ ...COUPONS[1], minOrder: null }]);
    renderSheet(undefined, { shippingFee: 0 });
    expect(await screen.findByText('Đơn này đã miễn phí giao hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Không cần dùng' })).toBeDisabled();
  });

  it('phí ship còn hoặc chưa biết: mã freeship dùng bình thường', async () => {
    mocks.getCoupons.mockResolvedValue([{ ...COUPONS[1], minOrder: null }]);
    renderSheet(undefined, { shippingFee: 30_000 });
    expect(await screen.findByRole('button', { name: 'Dùng mã' })).toBeEnabled();
    cleanup();
    renderSheet();
    expect(await screen.findByRole('button', { name: 'Dùng mã' })).toBeEnabled();
  });
});

describe('VoucherSheet: mức giảm thật của từng mã từ máy chủ (/checkout/coupon-previews)', () => {
  const PERCENT = COUPONS[0];
  const FS = { ...COUPONS[1], minOrder: null };
  const SCOPED = { ...PERCENT, code: 'MUACHUNG', type: 'AMOUNT', value: 20_000, maxDiscount: null, products: [{ id: 'p-x', name: 'Chậu gốm' }] };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoupons.mockResolvedValue([PERCENT, FS, SCOPED]);
  });

  it('có số: ghi "Giảm X cho đơn này" (vẫn giữ "tối đa" của mã), freeship ghi phí ship miễn được, gửi đúng tham số báo giá', async () => {
    mocks.getCouponPreviews.mockResolvedValue([
      { code: 'GIAM10', eligible: true, discount: 43_800 },
      { code: 'FREESHIP', eligible: true, discount: 0, freeshipSaving: 19_000 },
      { code: 'MUACHUNG', eligible: true, discount: 12_000 },
    ]);
    renderSheet(undefined, { previewParams: { addressId: 'a1', itemIds: ['l1'] }, shippingFee: 19_000 });
    expect(await screen.findByText('Giảm 43.800đ cho đơn này')).toBeInTheDocument();
    expect(screen.getByText('Giảm 10% (tối đa 50.000đ)')).toBeInTheDocument();
    expect(screen.getByText('Miễn phí giao hàng 19.000đ cho đơn này')).toBeInTheDocument();
    expect(screen.getByText('Giảm 12.000đ cho đơn này')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dùng mã' })).toHaveLength(3);
    expect(mocks.getCouponPreviews).toHaveBeenCalledWith({ addressId: 'a1', itemIds: ['l1'] });
  });

  const HELD_NOTICE = 'Mã chưa được áp dụng cho đơn này (phần giảm combo không được tính vào điều kiện của mã): Đơn tối thiểu 95.000đ để dùng mã này.';

  it('mua một phần giỏ, xem trước nói mã dùng được nhưng giỏ (cả giỏ) giữ mã kèm lời báo: báo "Đã áp dụng", không hiện chữ "chưa được áp dụng"', async () => {
    mocks.getCouponPreviews.mockResolvedValue([{ code: 'GIAM10', eligible: true, discount: 10_000 }]);
    mocks.applyCoupon.mockResolvedValue({ couponCode: 'GIAM10', discount: 0, freeship: false, couponNotice: HELD_NOTICE });
    renderSheet(undefined, { previewParams: { itemIds: ['l1'] } });
    await screen.findByText('Giảm 10.000đ cho đơn này');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dùng mã' })[0]!);
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('GIAM10'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã áp dụng mã GIAM10', type: 'success' })));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    expect(JSON.stringify(mocks.openSnackbar.mock.calls)).not.toContain('chưa được áp dụng');
  });

  it('xem trước nói mã không dùng được cho phần đang chọn (hoặc chưa có xem trước): lời báo của giỏ vẫn hiện dạng cảnh báo', async () => {
    mocks.getCouponPreviews.mockResolvedValue([{ code: 'GIAM10', eligible: false, discount: 0, reason: 'Đơn tối thiểu 95.000đ để dùng mã này.' }]);
    mocks.applyCoupon.mockResolvedValue({ couponCode: 'GIAM10', discount: 0, freeship: false, couponNotice: HELD_NOTICE });
    renderSheet(undefined, { previewParams: {} });
    await screen.findByText('Đơn tối thiểu 95.000đ để dùng mã này.');
    fireEvent.change(screen.getByLabelText('Nhập mã giảm giá khác'), { target: { value: 'giam10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('GIAM10'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: HELD_NOTICE, type: 'warning' })));
  });

  const FIRST_ORDER_REASON = 'Đơn đầu đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau.';

  it('đơn đầu đã miễn phí giao: thẻ FREESHIP ghi lý do, khoá nút; mã gõ tay không báo "Đã áp dụng" mà nói đúng lý do như thanh toán (U1-B03)', async () => {
    mocks.getCouponPreviews.mockResolvedValue([
      { code: 'GIAM10', eligible: true, discount: 5_000 },
      { code: 'FREESHIP', eligible: false, reason: FIRST_ORDER_REASON, discount: 0 },
      { code: 'MUACHUNG', eligible: true, discount: 1_000 },
    ]);
    mocks.applyCoupon.mockResolvedValue({ couponCode: 'FREESHIP', discount: 0, freeship: true, couponNotice: null });
    renderSheet(undefined, { previewParams: {} });
    expect(await screen.findByText(FIRST_ORDER_REASON)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Không áp dụng' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nhập mã giảm giá khác'), { target: { value: 'freeship' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('FREESHIP'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ text: `Mã chưa được áp dụng cho đơn này: ${FIRST_ORDER_REASON}`, type: 'warning' }),
      ),
    );
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã áp dụng mã FREESHIP' }));
  });

  const THRESHOLD_REASON = 'Đơn từ 199.000đ đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau.';

  it('đơn đạt ngưỡng miễn phí giao: thẻ FREESHIP ghi lý do, mã gõ tay báo cảnh báo đúng câu của máy chủ, không báo "Đã áp dụng" (U1-B03 sau Q12)', async () => {
    mocks.getCouponPreviews.mockResolvedValue([
      { code: 'GIAM10', eligible: true, discount: 5_000 },
      { code: 'FREESHIP', eligible: false, reason: THRESHOLD_REASON, discount: 0 },
    ]);
    mocks.applyCoupon.mockResolvedValue({ couponCode: 'FREESHIP', discount: 0, freeship: true, couponNotice: null });
    renderSheet(undefined, { previewParams: {} });
    expect(await screen.findByText(THRESHOLD_REASON)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nhập mã giảm giá khác'), { target: { value: 'freeship' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('FREESHIP'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ text: `Mã chưa được áp dụng cho đơn này: ${THRESHOLD_REASON}`, type: 'warning' }),
      ),
    );
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã áp dụng mã FREESHIP' }));
  });

  it('freeship không miễn được đồng nào (hoặc trang giỏ chưa có phí giao): không ghi số tiền', async () => {
    mocks.getCouponPreviews.mockResolvedValue([
      { code: 'GIAM10', eligible: true, discount: 5_000 },
      { code: 'FREESHIP', eligible: true, discount: 0 },
      { code: 'MUACHUNG', eligible: true, discount: 1_000 },
    ]);
    renderSheet(undefined, { previewParams: {} });
    await screen.findByText('Giảm 5.000đ cho đơn này');
    expect(screen.queryByText(/Miễn phí giao hàng .*cho đơn này/)).toBeNull();
  });

  it('mã không dùng được: hiện lý do của máy chủ và khoá nút, kể cả khi phép đoán phía máy nói đủ điều kiện', async () => {
    const reason = 'Đơn tối thiểu 150.000đ để dùng mã này.';
    mocks.getCouponPreviews.mockResolvedValue([
      { code: 'GIAM10', eligible: false, reason, discount: 0 },
      { code: 'FREESHIP', eligible: true, discount: 0, freeshipSaving: 19_000 },
      { code: 'MUACHUNG', eligible: true, discount: 1_000 },
    ]);
    renderSheet(undefined, { previewParams: { addressId: 'a1' }, subtotal: 900_000 });
    expect(await screen.findByText(reason)).toBeInTheDocument();
    const blocked = screen.getByRole('button', { name: 'Không áp dụng' });
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    expect(screen.queryByText(/Giảm .* cho đơn này/, { selector: 'div' })).toHaveTextContent('Giảm 1.000đ cho đơn này');
  });

  it('API cũ / lỗi: giữ cách hiện cũ (không có số, phép đoán phía máy vẫn chạy)', async () => {
    mocks.getCouponPreviews.mockRejectedValue(new Error('404'));
    renderSheet(undefined, { previewParams: { addressId: 'a1' }, shippingFee: 0 });
    expect(await screen.findByText('Đơn này đã miễn phí giao hàng')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalled());
    expect(screen.queryByText(/cho đơn này/)).toBeNull();
    expect(screen.getByText('Chỉ áp cho Chậu gốm')).toBeInTheDocument();
  });

  it('đang tải số: thẻ hiện như cũ, chưa có số; không truyền tham số thì không gọi API', async () => {
    mocks.getCouponPreviews.mockReturnValue(new Promise(() => {}));
    renderSheet(undefined, { previewParams: { addressId: 'a1' } });
    expect(await screen.findByText('Giảm 10% (tối đa 50.000đ)')).toBeInTheDocument();
    expect(screen.queryByText(/cho đơn này/)).toBeNull();
    cleanup();
    mocks.getCouponPreviews.mockClear();
    renderSheet();
    await screen.findByText('Giảm 10% (tối đa 50.000đ)');
    expect(mocks.getCouponPreviews).not.toHaveBeenCalled();
  });
});

describe('VoucherSheet: số xem trước cũ không được tin khi giỏ đổi', () => {
  const MIN = { ...COUPONS[0], code: 'MIN150', minOrder: 150_000 };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoupons.mockResolvedValue([MIN]);
  });

  function sheet(subtotal: number, previewKey: string) {
    return (
      <VoucherSheet visible onClose={() => {}} subtotal={subtotal} previewParams={{ addressId: 'a1' }} previewKey={previewKey} />
    );
  }

  it('đổi số lượng: hỏi lại máy chủ; trong lúc chờ không hiện số cũ, dưới đơn tối thiểu thì nút khoá', async () => {
    mocks.getCouponPreviews.mockResolvedValueOnce([{ code: 'MIN150', eligible: true, discount: 20_000 }]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(<QueryClientProvider client={qc}>{sheet(200_000, 'l1:4:200000')}</QueryClientProvider>);
    expect(await screen.findByText('Giảm 20.000đ cho đơn này')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dùng mã' })).toBeEnabled();

    mocks.getCouponPreviews.mockReturnValueOnce(new Promise(() => {}));
    r.rerender(<QueryClientProvider client={qc}>{sheet(100_000, 'l1:2:100000')}</QueryClientProvider>);
    expect(screen.queryByText('Giảm 20.000đ cho đơn này')).toBeNull();
    expect(screen.getByRole('button', { name: 'Chưa đủ' })).toBeDisabled();
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Chưa đủ' })).toBeDisabled();
  });

  it('giỏ đổi liên tục: chỉ hỏi một lần sau khi đứng yên', async () => {
    mocks.getCouponPreviews.mockResolvedValue([{ code: 'MIN150', eligible: true, discount: 20_000 }]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(<QueryClientProvider client={qc}>{sheet(200_000, 'k0')}</QueryClientProvider>);
    await screen.findByText('Giảm 20.000đ cho đơn này');
    for (const k of ['k1', 'k2', 'k3']) r.rerender(<QueryClientProvider client={qc}>{sheet(200_000, k)}</QueryClientProvider>);
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(2));
    await new Promise((res) => setTimeout(res, 400));
    expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(2);
  });
});
