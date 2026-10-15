import { describe, expect, it } from 'vitest';
import {
  bankDetailsError,
  cancelRefundMode,
  destinationBody,
  maskedBank,
  refundOfReturn,
  refundStatusText,
  remainingByLine,
  returnLinesText,
  returnStatusLabel,
  returnFormError,
  showsPaymentDeadline,
  showsRefundPanel,
  type MyRefund,
  type ReturnLineState,
} from './refund-rules';

const BANK = { bankName: 'Techcombank', accountNumber: '1903 1234 5678', accountName: 'Nguyen Van A' };

describe('cancelRefundMode (D2: khách chọn nơi nhận khi huỷ đơn đã trả)', () => {
  it('đơn chuyển khoản/ZaloPay đã trả → chọn Ví hoặc ngân hàng', () => {
    expect(cancelRefundMode({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' })).toBe('choose');
    expect(cancelRefundMode({ paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' })).toBe('choose');
  });
  it('đơn trả bằng Ví → hoàn về Ví', () => {
    expect(cancelRefundMode({ paymentMethod: 'WALLET', paymentStatus: 'PAID' })).toBe('wallet');
  });
  it('đơn chuyển khoản chưa ghi nhận tiền → cảnh báo trước khi huỷ (MONEY-6)', () => {
    expect(cancelRefundMode({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' })).toBe('unpaidTransfer');
  });
  it('COD chưa giao → không có gì để hoàn', () => {
    expect(cancelRefundMode({ paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe('none');
  });
});

describe('bankDetailsError', () => {
  it('chấp nhận số tài khoản có dấu cách/chấm/gạch', () => {
    expect(bankDetailsError(BANK)).toBeNull();
    expect(bankDetailsError({ ...BANK, accountNumber: '0071.000-123' })).toBeNull();
  });
  it('báo lỗi tiếng Việt cho từng ô', () => {
    expect(bankDetailsError({ ...BANK, bankName: '' })).toBe('Vui lòng nhập tên ngân hàng.');
    expect(bankDetailsError({ ...BANK, accountNumber: '12ab' })).toBe('Số tài khoản chỉ gồm chữ số, từ 6 đến 24 số.');
    expect(bankDetailsError({ ...BANK, accountName: ' ' })).toBe('Vui lòng nhập tên chủ tài khoản.');
  });
});

describe('destinationBody / maskedBank', () => {
  it('Ví không gửi tài khoản; ngân hàng gửi đủ ba ô', () => {
    expect(destinationBody('WALLET', BANK)).toEqual({ refundMethod: 'WALLET' });
    expect(destinationBody('BANK', BANK)).toEqual({ refundMethod: 'BANK', ...BANK });
  });
  it('che số tài khoản, chỉ hiện 4 số cuối', () => {
    expect(maskedBank('Techcombank', '190312345678')).toBe('Techcombank ••• 5678');
  });
});

describe('remainingByLine + returnFormError (D3: trả theo dòng và số lượng)', () => {
  const items = [
    { id: 'a', quantity: 3 },
    { id: 'b', quantity: 1 },
  ];
  it('trừ phần đã duyệt trả, bỏ qua yêu cầu bị từ chối', () => {
    const m = remainingByLine(items, [
      { status: 'APPROVED', items: [{ orderItemId: 'a', quantity: 1 }] },
      { status: 'REJECTED', items: [{ orderItemId: 'b', quantity: 1 }] },
    ]);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(1);
  });

  const line = (over: Partial<ReturnLineState> = {}): ReturnLineState => ({
    orderItemId: 'a',
    productName: 'Nước giặt',
    variationName: 'Chai',
    remaining: 3,
    selected: true,
    quantity: 1,
    ...over,
  });
  const base = { lines: [line()], reasonCode: 'DEFECTIVE' as const, reason: '', refundMethod: 'WALLET' as const, bank: BANK };

  it('lý do chọn sẵn không bắt buộc mô tả', () => {
    expect(returnFormError(base)).toBeNull();
  });
  it('chưa chọn dòng nào / chưa chọn lý do / "Lý do khác" thiếu mô tả', () => {
    expect(returnFormError({ ...base, lines: [line({ selected: false })] })).toBe('Chọn ít nhất một sản phẩm muốn trả.');
    expect(returnFormError({ ...base, reasonCode: null })).toBe('Chọn lý do đổi/trả.');
    expect(returnFormError({ ...base, reasonCode: 'OTHER', reason: 'abc' })).toBe('Mô tả lý do (tối thiểu 5 ký tự).');
  });
  it('chọn hoàn về ngân hàng thì kiểm tài khoản', () => {
    expect(returnFormError({ ...base, refundMethod: 'BANK', bank: { ...BANK, accountNumber: '1' } })).toMatch(/Số tài khoản/);
  });
});

describe('refundStatusText', () => {
  const r = (over: Partial<MyRefund> = {}): MyRefund => ({
    id: 'r1',
    orderId: 'o1',
    orderCode: 'TB1',
    kind: 'LATE_PAYMENT',
    amount: 197_000,
    method: 'MANUAL_TRANSFER',
    status: 'PENDING',
    bankName: null,
    bankAccountNo: null,
    bankAccountName: null,
    bankRef: null,
    completedAt: null,
    createdAt: '2026-10-14T00:00:00Z',
    canChooseDestination: true,
    ...over,
  });
  it('tiền về muộn chưa có tài khoản → nhắc khách chọn nơi nhận', () => {
    expect(refundStatusText(r())).toMatchObject({ title: 'Tiền về sau khi đơn đã huỷ: chờ bạn chọn nơi nhận', tone: 'warning' });
  });
  it('chờ chuyển (còn đổi sang Ví được) / đang chuyển (đã chốt) / đã chuyển kèm mã giao dịch / đã vào Ví', () => {
    expect(refundStatusText(r({ kind: 'CANCEL', bankName: 'VCB', bankAccountNo: '0071000123456' }))).toEqual({
      title: 'Hoàn tiền huỷ đơn: chờ Tubu chuyển khoản',
      detail: 'Về VCB ••• 3456 trong 1-3 ngày làm việc, miễn phí. Bạn vẫn đổi sang Ví Tubu được tới khi Tubu bắt đầu chuyển.',
      tone: 'muted',
    });
    // R2-LIFECYCLE-2: Tubu đã bắt đầu chuyển thì nơi nhận chốt — nói rõ để khách không tìm nút đổi.
    expect(
      refundStatusText(r({ kind: 'CANCEL', status: 'PROCESSING', canChooseDestination: false, bankName: 'VCB', bankAccountNo: '0071000123456' })),
    ).toEqual({
      title: 'Hoàn tiền huỷ đơn: Tubu đang chuyển khoản',
      detail: 'Về VCB ••• 3456 trong 1-3 ngày làm việc, miễn phí. Nơi nhận đã chốt, không đổi được nữa.',
      tone: 'muted',
    });
    expect(
      refundStatusText(r({ kind: 'RETURN', status: 'COMPLETED', bankName: 'VCB', bankAccountNo: '0071000123456', bankRef: 'FT1' })).detail,
    ).toBe('Về VCB ••• 3456 · Mã GD FT1');
    expect(refundStatusText(r({ status: 'COMPLETED', method: 'WALLET' })).title).toBe('Tiền về sau khi đơn đã huỷ: đã hoàn vào Ví Tubu');
  });
});

describe('refundStatusText — R3-MONEY-1 / R2-LIFECYCLE-5', () => {
  const base: MyRefund = {
    id: 'r1',
    orderId: 'o1',
    orderCode: 'TB1',
    kind: 'OVERPAYMENT',
    amount: 114_000,
    method: 'MANUAL_TRANSFER',
    status: 'PENDING',
    bankName: null,
    bankAccountNo: null,
    bankAccountName: null,
    bankRef: null,
    completedAt: null,
    createdAt: '2026-10-14T00:00:00Z',
    canChooseDestination: true,
  };
  it('khoản tiền trả dư (trả hai lần, chuyển dư) → nói rõ là tiền bạn trả dư, chờ chọn nơi nhận', () => {
    expect(refundStatusText(base)).toMatchObject({ title: 'Tiền bạn trả dư: chờ bạn chọn nơi nhận', tone: 'warning' });
  });
  it('đã hoàn thẳng vào Ví khi huỷ → nói lúc cộng tiền', () => {
    const s = refundStatusText({ ...base, kind: 'CANCEL', method: 'WALLET', status: 'COMPLETED', completedAt: '2026-10-14T03:05:00Z', canChooseDestination: false });
    expect(s.title).toBe('Hoàn tiền huỷ đơn: đã hoàn vào Ví Tubu');
    expect(s.detail).toBe('Đã cộng vào Ví Tubu lúc 10:05 14/10/2026.');
  });
});

describe('showsRefundPanel — khối Hoàn tiền ở chi tiết đơn', () => {
  it('đơn đã huỷ/trả/giao, hoặc đơn đã nhận tiền (có thể có khoản trả dư) → hiện', () => {
    expect(showsRefundPanel({ status: 'CANCELLED', paymentStatus: 'UNPAID' })).toBe(true);
    expect(showsRefundPanel({ status: 'RETURNED', paymentStatus: 'REFUNDED' })).toBe(true);
    expect(showsRefundPanel({ status: 'DELIVERED', paymentStatus: 'UNPAID' })).toBe(true);
    expect(showsRefundPanel({ status: 'CONFIRMED', paymentStatus: 'PAID' })).toBe(true);
  });
  it('đơn chưa trả tiền đang xử lý → không hỏi khoản hoàn', () => {
    expect(showsRefundPanel({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' })).toBe(false);
    expect(showsRefundPanel({ status: 'SHIPPING', paymentStatus: 'UNPAID' })).toBe(false);
  });
});

describe('showsPaymentDeadline', () => {
  it('chỉ đơn chờ thanh toán còn hạn', () => {
    expect(showsPaymentDeadline({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentDeadline: '2026-10-14T03:00:00Z' })).toBe(true);
    expect(showsPaymentDeadline({ status: 'CONFIRMED', paymentStatus: 'PAID', paymentDeadline: null })).toBe(false);
  });
});

describe('returnStatusLabel / returnLinesText', () => {
  it('đơn CTV lên hộ: tiền hoàn trả cho khách, không nói vào Ví Tubu của người xem', () => {
    const ret = { status: 'APPROVED', refundAmount: 89_000, shippingRefund: 15_000, refundMethod: 'WALLET' as const };
    expect(returnStatusLabel(ret, undefined, true)).toBe('Đổi/trả đã duyệt — Tubu hoàn 104.000đ cho khách của bạn');
    expect(returnStatusLabel({ status: 'APPROVED', refundAmount: null }, undefined, true)).toBe('Đổi/trả đã duyệt');
    expect(returnStatusLabel({ status: 'REJECTED', adminNote: 'Quá hạn' }, undefined, true)).toBe('Đổi/trả bị từ chối: Quá hạn');
  });

  it('đã duyệt: nói rõ số tiền và nơi nhận', () => {
    expect(returnStatusLabel({ status: 'APPROVED', refundAmount: 89_000, shippingRefund: 15_000, refundMethod: 'WALLET' })).toBe(
      'Đổi/trả đã duyệt — đã hoàn 104.000đ vào Ví Tubu',
    );
    expect(
      returnStatusLabel({ status: 'APPROVED', refundAmount: 89_000, refundMethod: 'BANK', bankName: 'VCB', bankAccountNo: '0071000123456' }),
    ).toBe('Đổi/trả đã duyệt — Tubu chuyển khoản 89.000đ về VCB ••• 3456 (1-3 ngày làm việc)');
    expect(returnStatusLabel({ status: 'APPROVED', refundAmount: null })).toBe('Đổi/trả đã duyệt — tiền hoàn vào Ví Tubu');
    expect(returnStatusLabel({ status: 'APPROVED', refundAmount: 0 })).toBe('Đổi/trả đã duyệt');
  });
  // R2-LIFECYCLE-6: nơi nhận theo khoản hoàn thật, không theo lựa chọn lúc gửi yêu cầu.
  it('có khoản hoàn thật: khách đã đổi sang Ví → nói Ví; chờ/đang chuyển → chuyển khoản; đã chuyển → "đã chuyển khoản"', () => {
    const ret = { status: 'APPROVED', refundAmount: 19_500, refundMethod: 'BANK' as const, bankName: 'MB Bank', bankAccountNo: '0123453456' };
    const bank = { bankName: 'MB Bank', bankAccountNo: '0123453456' };
    expect(returnStatusLabel(ret, { method: 'WALLET', status: 'COMPLETED', ...bank })).toBe('Đổi/trả đã duyệt — đã hoàn 19.500đ vào Ví Tubu');
    expect(returnStatusLabel(ret, { method: 'MANUAL_TRANSFER', status: 'PROCESSING', ...bank })).toBe(
      'Đổi/trả đã duyệt — Tubu chuyển khoản 19.500đ về MB Bank ••• 3456 (1-3 ngày làm việc)',
    );
    expect(returnStatusLabel(ret, { method: 'MANUAL_TRANSFER', status: 'COMPLETED', ...bank })).toBe(
      'Đổi/trả đã duyệt — Tubu đã chuyển khoản 19.500đ về MB Bank ••• 3456',
    );
    expect(returnStatusLabel(ret, { method: 'MANUAL_TRANSFER', status: 'PENDING', bankName: null, bankAccountNo: null })).toBe(
      'Đổi/trả đã duyệt — hoàn 19.500đ, chờ bạn chọn nơi nhận',
    );
  });
  it('refundOfReturn: khớp khoản RETURN theo refKey = id yêu cầu', () => {
    const list = [
      { kind: 'CANCEL' as const, refKey: 'x', id: 'a' },
      { kind: 'RETURN' as const, refKey: 'ret1', id: 'b' },
    ];
    expect(refundOfReturn(list, 'ret1')?.id).toBe('b');
    expect(refundOfReturn(list, 'x')).toBeUndefined();
    expect(refundOfReturn(undefined, 'ret1')).toBeUndefined();
  });
  it('liệt kê dòng trả kèm số lượng', () => {
    expect(
      returnLinesText({ status: 'APPROVED', items: [{ orderItemId: 'a', quantity: 1 }] }, [{ id: 'a', productName: 'Nước giặt' }]),
    ).toBe('Nước giặt ×1');
  });
});
