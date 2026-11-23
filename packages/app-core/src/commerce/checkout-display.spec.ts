import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_LINES_COLLAPSED,
  COMPACT_ADDRESS_MAX,
  RECENT_ADDRESS_KEY,
  checkoutPlaceHint,
  checkoutTotalText,
  collapseCheckoutLines,
  compactAddressView,
  markTransferOrderPlaced,
  maskPhone,
  paymentMethodCue,
  pushRecentAddress,
  readRecentAddressIds,
  rememberRecentAddress,
  sortAddressesForPicker,
  takeTransferQrDelay,
  transferPreviewView,
} from './checkout-display';
import { fillCopy } from '../shop-copy';

const fmt = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

describe('checkoutPlaceHint', () => {
  it('thiếu địa chỉ: nói chọn địa chỉ, kể cả khi báo giá cũng lỗi (địa chỉ thắng)', () => {
    expect(checkoutPlaceHint({ hasAddress: false, quoteFailed: true })).toBe('Chọn địa chỉ giao hàng để đặt hàng.');
    expect(checkoutPlaceHint({ hasAddress: false, quoteFailed: false })).toBe('Chọn địa chỉ giao hàng để đặt hàng.');
  });

  it('có địa chỉ mà báo giá lỗi: nói chưa tính được tổng tiền', () => {
    expect(checkoutPlaceHint({ hasAddress: true, quoteFailed: true })).toBe(fillCopy('checkout.quoteFailed'));
    expect(fillCopy('checkout.quoteFailed')).toContain('Thử lại');
  });

  it('máy chủ từ chối địa chỉ (ADDRESS_OUTDATED): bảo sửa địa chỉ, không bảo bấm Thử lại', () => {
    expect(checkoutPlaceHint({ hasAddress: true, quoteFailed: true, addressOutdated: true })).toBe(fillCopy('checkout.addressFix'));
    expect(fillCopy('checkout.addressFix')).not.toContain('Thử lại');
    expect(checkoutPlaceHint({ hasAddress: false, quoteFailed: true, addressOutdated: true })).toBe(fillCopy('checkout.addressNeeded'));
  });

  it('đủ địa chỉ và báo giá tốt: không có lý do', () => {
    expect(checkoutPlaceHint({ hasAddress: true, quoteFailed: false })).toBeNull();
    expect(checkoutPlaceHint({ hasAddress: true, quoteFailed: false, addressOutdated: true })).toBeNull();
  });
});

describe('checkoutTotalText', () => {
  it('có số báo giá thì ghi số', () => {
    expect(checkoutTotalText({ total: 330_000, hasAddress: true }, fmt)).toBe(fmt(330_000));
  });

  it('đơn 0đ vẫn là số, không bị coi là chưa có', () => {
    expect(checkoutTotalText({ total: 0, hasAddress: true }, fmt)).toBe(fmt(0));
  });

  it('có địa chỉ mà chưa có số: "…", không phải 0đ', () => {
    expect(checkoutTotalText({ total: null, hasAddress: true }, fmt)).toBe('…');
  });

  it('chưa có địa chỉ: "Chưa tính", không có số nào đứng ở chỗ tổng', () => {
    expect(checkoutTotalText({ total: null, hasAddress: false }, fmt)).toBe('Chưa tính');
  });
});

describe('collapseCheckoutLines', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, total: (i + 1) * 10_000 }));

  it('trần mặc định là 5 dòng', () => {
    expect(CHECKOUT_LINES_COLLAPSED).toBe(5);
  });

  it('đúng 5 dòng thì không gập', () => {
    const r = collapseCheckoutLines(lines(5), false);
    expect(r.shown).toHaveLength(5);
    expect(r.hiddenCount).toBe(0);
    expect(r.hiddenTotal).toBe(0);
  });

  it('6 dòng đang gập: 5 dòng thấy, 1 dòng ẩn kèm tiền để cộng đủ Tạm tính', () => {
    const all = lines(6);
    const r = collapseCheckoutLines(all, false);
    expect(r.shown.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(r.hiddenCount).toBe(1);
    expect(r.hiddenTotal).toBe(60_000);
    expect(r.shown.reduce((s, l) => s + l.total, 0) + r.hiddenTotal).toBe(all.reduce((s, l) => s + l.total, 0));
  });

  it('đã mở thì hiện đủ, không còn dòng ẩn', () => {
    const r = collapseCheckoutLines(lines(8), true);
    expect(r.shown).toHaveLength(8);
    expect(r.hiddenCount).toBe(0);
    expect(r.hiddenTotal).toBe(0);
  });

  it('giỏ rỗng và trần tuỳ chọn', () => {
    expect(collapseCheckoutLines([], false)).toEqual({ shown: [], hiddenCount: 0, hiddenTotal: 0 });
    const r = collapseCheckoutLines(lines(4), false, 3);
    expect(r.shown).toHaveLength(3);
    expect(r.hiddenCount).toBe(1);
  });
});

describe('chữ thanh toán dùng chung', () => {
  it('khoá chốt cho cả hai app', () => {
    expect(fillCopy('checkout.totalPending')).toBe('Chưa tính');
    expect(fillCopy('checkout.shipNeedsAddress')).toBe('Nhập địa chỉ để tính phí');
    expect(fillCopy('checkout.calculating')).toBe('Đang tính…');
    expect(fillCopy('checkout.moreLines', { n: 2 })).toBe('Xem thêm 2 sản phẩm');
    expect(fillCopy('checkout.fewerLines')).toBe('Thu gọn');
    expect(fillCopy('checkout.placeWith', { price: '330.000đ' })).toBe('Đặt hàng · 330.000đ');
    expect(fillCopy('coupon.autoApplied')).toBe('Tubu đã tự áp mã tốt nhất');
    expect(fillCopy('flash.priceChangedBody')).toBe('Vài sản phẩm Giờ vàng vừa hết suất hoặc hết giờ. Bạn xem lại giỏ trước khi đặt nhé.');
  });
});

describe('dòng địa chỉ gọn (wave w2-06)', () => {
  it('che giữa số điện thoại, giữ 3 số đầu và 3 số cuối; dạng +84 đổi về 0', () => {
    expect(maskPhone('0901234567')).toBe('090****567');
    expect(maskPhone('+84 901 234 567')).toBe('090****567');
    expect(maskPhone('0901.234.567')).toBe('090****567');
    expect(maskPhone('12345')).toBe('12345');
  });

  it('tên · SĐT che bớt, địa chỉ nối bằng dấu phẩy, bỏ phần trống, cắt có dấu … khi quá dài', () => {
    const v = compactAddressView({ recipient: ' Lan ', phone: '0901234567', street: '12 Lý Thường Kiệt', ward: 'Phường Bến Nghé', district: '', province: 'TP. Hồ Chí Minh' });
    expect(v.title).toBe('Lan · 090****567');
    expect(v.line).toBe('12 Lý Thường Kiệt, Phường Bến Nghé, TP. Hồ Chí Minh');
    expect(v.title).not.toContain('1234');
    const long = compactAddressView({ recipient: 'A', phone: '0901234567', street: 'x'.repeat(200), province: 'Hà Nội' });
    expect(long.line.length).toBe(COMPACT_ADDRESS_MAX);
    expect(long.line.endsWith('…')).toBe(true);
  });

  it('tấm chọn: mặc định đứng đầu, kế đến dùng gần nhất (mới trước), còn lại giữ thứ tự sổ', () => {
    const list = [
      { id: 'a', isDefault: false },
      { id: 'b', isDefault: false },
      { id: 'c', isDefault: true },
      { id: 'd', isDefault: false },
    ];
    expect(sortAddressesForPicker(list, ['d', 'b']).map((x) => x.id)).toEqual(['c', 'd', 'b', 'a']);
    expect(sortAddressesForPicker(list).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortAddressesForPicker(list, ['c', 'zzz']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('nhớ địa chỉ vừa dùng theo tài khoản, không trùng, tối đa 5, bộ nhớ hỏng thì danh sách rỗng', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    for (const id of ['a', 'b', 'a', 'c', 'd', 'e', 'f']) rememberRecentAddress(storage, id, 'u1');
    expect(readRecentAddressIds(storage, 'u1')).toEqual(['f', 'e', 'd', 'c', 'a']);
    expect(readRecentAddressIds(storage, 'u2')).toEqual([]);
    expect(pushRecentAddress(['x', 'y'], 'y')).toEqual(['y', 'x']);
    store.set(`${RECENT_ADDRESS_KEY}:u1`, '{bad');
    expect(readRecentAddressIds(storage, 'u1')).toEqual([]);
    expect(readRecentAddressIds(null)).toEqual([]);
  });
});

describe('thẻ xem trước chuyển khoản', () => {
  const on = { enabled: true, bank: { name: 'Techcombank', accountName: 'CONG TY TUBU TREE' } };

  it('cờ bật, đủ ngân hàng và có tổng → tên ngân hàng, chủ tài khoản, đúng tổng báo giá', () => {
    expect(transferPreviewView(on, 250000)).toEqual({ bankName: 'Techcombank', accountName: 'CONG TY TUBU TREE', amount: 250000 });
  });

  it('cờ tắt, thiếu cấu hình ngân hàng, chưa có báo giá hay tổng 0 → ẩn thẻ', () => {
    expect(transferPreviewView({ enabled: false, bank: on.bank }, 250000)).toBeNull();
    expect(transferPreviewView({ enabled: true, bank: null }, 250000)).toBeNull();
    expect(transferPreviewView({ enabled: true, bank: { name: ' ', accountName: 'X' } }, 250000)).toBeNull();
    expect(transferPreviewView(on, null)).toBeNull();
    expect(transferPreviewView(on, 0)).toBeNull();
    expect(transferPreviewView(undefined, 250000)).toBeNull();
  });

  it('thời gian tới QR: làm tròn 100 ms, chỉ lấy được một lần, mã lạ thì null', () => {
    markTransferOrderPlaced('TUBU1', 1000);
    expect(takeTransferQrDelay('TUBU1', 1849)).toBe(800);
    expect(takeTransferQrDelay('TUBU1', 2000)).toBeNull();
    expect(takeTransferQrDelay('KHAC', 2000)).toBeNull();
    markTransferOrderPlaced('TUBU2', 5000);
    expect(takeTransferQrDelay('TUBU2', 4000)).toBe(0);
  });
});

describe('paymentMethodCue', () => {
  it('mỗi cách thanh toán đang có một dòng phụ ngắn, đúng xử lý của máy chủ: COD không trả trước, chuyển khoản xác nhận khi tiền về (không hứa "tự"/"ngay"), Ví xác nhận ngay', () => {
    expect(paymentMethodCue('COD')).toBe(fillCopy('checkout.payCueCod'));
    const bank = paymentMethodCue('BANK_TRANSFER')!;
    expect(bank).toBe(fillCopy('checkout.payCueBank'));
    expect(bank).toContain('QR');
    expect(bank).not.toMatch(/(?<!\p{L})(?:tự|ngay)(?!\p{L})/u);
    expect(paymentMethodCue('WALLET')).toBe(fillCopy('checkout.payCueWallet'));
  });

  it('dòng phụ vừa một dòng ở 375px (≤ 44 ký tự) và các dòng khác nhau', () => {
    const cues = ['COD', 'BANK_TRANSFER', 'WALLET'].map((m) => paymentMethodCue(m)!);
    for (const c of cues) expect(c.length).toBeLessThanOrEqual(44);
    expect(new Set(cues).size).toBe(3);
  });

  it('cách lạ (máy chủ thêm sau, ZALOPAY đang ẩn) thì null: không đoán', () => {
    expect(paymentMethodCue('ZALOPAY')).toBeNull();
    expect(paymentMethodCue('')).toBeNull();
  });
});
