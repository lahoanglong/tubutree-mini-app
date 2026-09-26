import { describe, it, expect } from 'vitest';
import { recyclingCheckoutFields, recyclingMaxKg, recyclingPickupView } from './format';

describe('recyclingCheckoutFields — chỉ gửi hasRecyclingPickup khi tính năng bật VÀ khách chọn', () => {
  it('tính năng tắt → không gửi field nào (body y hệt bản cũ, không vướng forbidNonWhitelisted)', () => {
    expect(recyclingCheckoutFields(false, true, 'pin')).toEqual({});
  });

  it('bật nhưng khách không chọn → không gửi hasRecyclingPickup:false', () => {
    const out = recyclingCheckoutFields(true, false, 'pin');
    expect(out).toEqual({});
    expect('hasRecyclingPickup' in out).toBe(false);
  });

  it('bật + chọn → gửi true kèm ghi chú đã trim; ghi chú rỗng thì bỏ', () => {
    expect(recyclingCheckoutFields(true, true, '  3 cục pin ')).toEqual({ hasRecyclingPickup: true, recyclingNote: '3 cục pin' });
    expect(recyclingCheckoutFields(true, true, '   ')).toEqual({ hasRecyclingPickup: true });
  });
});

describe('recyclingMaxKg — cùng công thức BE (fallback 500g, tối thiểu 500g)', () => {
  it('cộng cân nặng × số lượng, dòng thiếu/0 gram lấy 500g', () => {
    expect(recyclingMaxKg([{ weight: 1200, quantity: 2 }, { weight: 0, quantity: 1 }])).toBe('2.9');
    expect(recyclingMaxKg([{ weight: null, quantity: 1 }])).toBe('0.5');
    expect(recyclingMaxKg([])).toBe('0.5');
  });
});

describe('recyclingPickupView — trạng thái thu gom trung thực ở chi tiết đơn', () => {
  const cod = { status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID' };

  it('chưa có vận đơn (đơn COD vừa đặt) → "Đang đặt lịch thu gom"', () => {
    expect(recyclingPickupView({ ...cod, gomdonStatus: null }).title).toBe('Đang đặt lịch thu gom');
    expect(recyclingPickupView({ ...cod, gomdonStatus: 'CREATING' }).title).toBe('Đang đặt lịch thu gom');
  });

  it('đã có vận đơn (1) → "Đã đặt lịch thu gom" + mã vận đơn', () => {
    const v = recyclingPickupView({ ...cod, gomdonStatus: '1', gomdonPartnerCode: 'BE77' });
    expect(v.title).toBe('Đã đặt lịch thu gom');
    expect(v.waybill).toBe('BE77');
  });

  it('chuyển khoản chưa thanh toán → "Chờ thanh toán", KHÔNG hứa bưu tá tới', () => {
    const v = recyclingPickupView({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', gomdonStatus: 'AWAITING_PAYMENT' });
    expect(v.title).toBe('Chờ thanh toán');
    expect(v.detail).not.toMatch(/bưu tá sẽ/i);
    expect(recyclingPickupView({ status: 'PENDING_PAYMENT', paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID', gomdonStatus: null }).title).toBe('Chờ thanh toán');
  });

  it('tạo vận đơn lỗi / chưa cấu hình / cần kiểm tra / Gomdon báo lỗi → "CSKH sẽ liên hệ hẹn thu gom"', () => {
    for (const s of ['FAILED', 'NOT_CONFIGURED', 'NEEDS_MANUAL_CHECK', '2', '10', '11', '6']) {
      const v = recyclingPickupView({ ...cod, gomdonStatus: s, gomdonPartnerCode: 'BE77' });
      expect(v.title).toBe('CSKH sẽ liên hệ hẹn thu gom');
      expect(v.tone).toBe('warning');
    }
  });

  it('đơn đã huỷ → "Đã huỷ thu gom", không hiện mã vận đơn', () => {
    const v = recyclingPickupView({ status: 'CANCELLED', paymentMethod: 'COD', paymentStatus: 'UNPAID', gomdonStatus: '1', gomdonPartnerCode: 'BE77', gomdonCancelStatus: 'CANCELLED' });
    expect(v.title).toBe('Đã huỷ thu gom');
    expect(v.waybill).toBeNull();
    expect(
      recyclingPickupView({ status: 'CANCELLED', paymentMethod: 'COD', paymentStatus: 'UNPAID', gomdonStatus: '1', gomdonCancelStatus: 'FAILED' }).detail,
    ).toContain('CSKH');
  });

  it('đang giao (3/4/5) → nhắc gửi vật liệu cho bưu tá; giao thành công (7) → cảm ơn, không khẳng định đã thu', () => {
    expect(recyclingPickupView({ ...cod, status: 'SHIPPING', gomdonStatus: '5' }).title).toBe('Bưu tá đang giao hàng');
    const done = recyclingPickupView({ ...cod, status: 'DELIVERED', gomdonStatus: '7' });
    expect(done.tone).toBe('success');
    expect(done.detail).toContain('Zalo OA');
  });
});
