import { describe, it, expect } from 'vitest';
import {
  gomdonAdminActions,
  gomdonCancelLabel,
  gomdonStatusLabel,
  needsRecyclingAttention,
  recyclingBookedAfterPayment,
  recyclingCheckoutFields,
  recyclingPickupView,
  RECYCLING_NOTE_MAX,
  type RecyclingOrderFields,
} from './recycling';

const base: RecyclingOrderFields = {
  status: 'CONFIRMED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  hasRecyclingPickup: true,
  gomdonStatus: null,
  gomdonOrderId: null,
  gomdonPartnerCode: null,
  gomdonCancelStatus: null,
};

describe('recyclingCheckoutFields — chỉ gửi khi tính năng bật VÀ khách chọn', () => {
  it('tắt tính năng hoặc không chọn → KHÔNG có khoá nào (body y hệt bản cũ)', () => {
    expect(recyclingCheckoutFields(false, true, 'pin')).toEqual({});
    expect(recyclingCheckoutFields(true, false, 'pin')).toEqual({});
    expect('hasRecyclingPickup' in recyclingCheckoutFields(true, false, '')).toBe(false);
  });

  it('bật + chọn → hasRecyclingPickup true, kèm ghi chú đã trim (bỏ nếu rỗng)', () => {
    expect(recyclingCheckoutFields(true, true, '  3 cục pin ')).toEqual({ hasRecyclingPickup: true, recyclingNote: '3 cục pin' });
    expect(recyclingCheckoutFields(true, true, '   ')).toEqual({ hasRecyclingPickup: true });
  });

  it('ghi chú cắt ở 500 ký tự (khớp @MaxLength(500) của API)', () => {
    const out = recyclingCheckoutFields(true, true, 'x'.repeat(600));
    expect(out.recyclingNote).toHaveLength(RECYCLING_NOTE_MAX);
  });

  it('chuyển khoản / ZaloPay → lịch thu gom đặt SAU khi thanh toán; COD thì không', () => {
    expect(recyclingBookedAfterPayment('BANK_TRANSFER')).toBe(true);
    expect(recyclingBookedAfterPayment('ZALOPAY')).toBe(true);
    expect(recyclingBookedAfterPayment('COD')).toBe(false);
  });
});

describe('gomdonStatusLabel / gomdonCancelLabel — nhãn tiếng Việt cho admin', () => {
  it('trạng thái nội bộ', () => {
    expect(gomdonStatusLabel('NEEDS_MANUAL_CHECK')).toEqual(expect.objectContaining({ label: 'Cần kiểm tra trên Gomdon', tone: 'danger' }));
    expect(gomdonStatusLabel('FAILED').tone).toBe('danger');
    expect(gomdonStatusLabel('NOT_CONFIGURED').tone).toBe('warning');
    expect(gomdonStatusLabel('AWAITING_PAYMENT').label).toBe('Chờ khách thanh toán');
    expect(gomdonStatusLabel(null).label).toBe('Chưa tạo vận đơn');
  });

  it('mã số Gomdon dùng đúng chữ của Gomdon', () => {
    expect(gomdonStatusLabel('1')).toEqual({ label: 'Tạo đơn thành công', tone: 'info' });
    expect(gomdonStatusLabel('7')).toEqual({ label: 'Giao thành công', tone: 'success' });
    expect(gomdonStatusLabel('11').label).toBe('Đơn giao hàng thất bại');
    expect(gomdonStatusLabel('11').tone).toBe('danger');
    expect(gomdonStatusLabel('99').label).toBe('Trạng thái 99');
  });

  it('kết quả huỷ vận đơn', () => {
    expect(gomdonCancelLabel(null)).toBeNull();
    expect(gomdonCancelLabel('TOO_LATE')?.tone).toBe('danger');
    expect(gomdonCancelLabel('CANCELLED')?.label).toBe('Đã huỷ vận đơn');
  });
});

describe('needsRecyclingAttention — cùng điều kiện với bộ lọc BE', () => {
  it('lỗi tạo vận đơn / mã lỗi Gomdon khi đơn còn mở → cần xử lý', () => {
    for (const s of ['FAILED', 'NEEDS_MANUAL_CHECK', 'NOT_CONFIGURED', '2', '6', '8', '9', '10', '11', '12']) {
      expect(needsRecyclingAttention({ ...base, gomdonStatus: s })).toBe(true);
    }
  });

  it('đơn đã giao/huỷ/trả → vận đơn lỗi cũ không còn là việc cần làm', () => {
    expect(needsRecyclingAttention({ ...base, status: 'CANCELLED', gomdonStatus: '2' })).toBe(false);
    expect(needsRecyclingAttention({ ...base, status: 'DELIVERED', gomdonStatus: 'FAILED' })).toBe(false);
  });

  it('huỷ vận đơn thất bại / quá muộn → luôn cần xử lý', () => {
    expect(needsRecyclingAttention({ ...base, status: 'CANCELLED', gomdonCancelStatus: 'FAILED' })).toBe(true);
    expect(needsRecyclingAttention({ ...base, status: 'CANCELLED', gomdonCancelStatus: 'TOO_LATE' })).toBe(true);
  });

  it('bình thường / không chọn thu gom → không', () => {
    expect(needsRecyclingAttention({ ...base, gomdonStatus: '1' })).toBe(false);
    expect(needsRecyclingAttention({ ...base, hasRecyclingPickup: false, gomdonStatus: 'FAILED' })).toBe(false);
  });
});

describe('gomdonAdminActions — chỉ hiện nút có nghĩa (BE vẫn là người quyết định)', () => {
  it('NEEDS_MANUAL_CHECK → cho tạo lại nhưng BẮT BUỘC tick xác nhận, có cảnh báo vận đơn tay', () => {
    const a = gomdonAdminActions({ ...base, gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    expect(a.canRetry).toBe(true);
    expect(a.retryNeedsConfirm).toBe(true);
    expect(a.retryWarning).toContain('Pancake');
  });

  it('FAILED / NOT_CONFIGURED → tạo lại không cần tick, vẫn cảnh báo kho có thể đã tạo tay', () => {
    for (const s of ['FAILED', 'NOT_CONFIGURED']) {
      const a = gomdonAdminActions({ ...base, gomdonStatus: s });
      expect(a).toEqual(expect.objectContaining({ canRetry: true, retryNeedsConfirm: false }));
      expect(a.retryWarning).toContain('vận đơn tay');
    }
  });

  it('vận đơn đang sống / đang tạo / đơn đã huỷ / trả trước chưa thanh toán → không cho tạo lại', () => {
    expect(gomdonAdminActions({ ...base, gomdonStatus: '1', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1' }).canRetry).toBe(false);
    expect(gomdonAdminActions({ ...base, gomdonStatus: 'CREATING' }).canRetry).toBe(false);
    expect(gomdonAdminActions({ ...base, status: 'CANCELLED', gomdonStatus: 'FAILED' }).canRetry).toBe(false);
    expect(gomdonAdminActions({ ...base, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', gomdonStatus: 'FAILED' }).canRetry).toBe(false);
  });

  it('Gomdon đã huỷ vận đơn cũ ("2") khi đơn còn hiệu lực → cho tạo vận đơn mới', () => {
    const a = gomdonAdminActions({ ...base, gomdonStatus: '2', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1' });
    expect(a.canRetry).toBe(true);
    expect(a.canCancel).toBe(false);
  });

  it('huỷ vận đơn: có mã + bưu tá chưa lấy hàng; đơn đã huỷ chỉ khi lần huỷ trước lỗi', () => {
    expect(gomdonAdminActions({ ...base, gomdonStatus: '1', gomdonOrderId: 'g1' }).canCancel).toBe(true);
    expect(gomdonAdminActions({ ...base, gomdonStatus: '3', gomdonOrderId: 'g1' }).canCancel).toBe(false);
    expect(gomdonAdminActions({ ...base, gomdonStatus: 'FAILED' }).canCancel).toBe(false);
    expect(gomdonAdminActions({ ...base, status: 'CANCELLED', gomdonOrderId: 'g1', gomdonCancelStatus: 'FAILED' }).canCancel).toBe(true);
    expect(gomdonAdminActions({ ...base, status: 'CANCELLED', gomdonOrderId: 'g1', gomdonCancelStatus: 'CANCELLED' }).canCancel).toBe(false);
    expect(gomdonAdminActions({ ...base, status: 'CANCELLED', gomdonOrderId: 'g1', gomdonCancelStatus: 'TOO_LATE' }).canCancel).toBe(false);
  });

  it('đơn không chọn thu gom → không có nút nào', () => {
    expect(gomdonAdminActions({ ...base, hasRecyclingPickup: false, gomdonStatus: 'FAILED' })).toEqual({
      canRetry: false,
      retryNeedsConfirm: false,
      retryWarning: null,
      canCancel: false,
    });
  });
});

describe('recyclingPickupView — lời hứa trung thực cho khách (giống miniapp)', () => {
  it('trả trước chưa thanh toán → "Chờ thanh toán", không có mã vận đơn', () => {
    const v = recyclingPickupView({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    expect(v.title).toBe('Chờ thanh toán');
    expect(v.waybill).toBeNull();
  });

  it('vận đơn lỗi → CSKH sẽ liên hệ (không hứa bưu tá tới)', () => {
    expect(recyclingPickupView({ status: 'CONFIRMED', paymentMethod: 'COD', gomdonStatus: 'FAILED' }).title).toBe(
      'CSKH sẽ liên hệ hẹn thu gom',
    );
  });

  it('đã tạo vận đơn → hiện mã BestExpress', () => {
    const v = recyclingPickupView({ status: 'CONFIRMED', paymentMethod: 'COD', gomdonStatus: '1', gomdonPartnerCode: 'BE123' });
    expect(v).toEqual(expect.objectContaining({ title: 'Đã đặt lịch thu gom', waybill: 'BE123' }));
  });

  it('đơn huỷ → "Đã huỷ thu gom", ẩn mã', () => {
    const v = recyclingPickupView({ status: 'CANCELLED', paymentMethod: 'COD', gomdonStatus: '1', gomdonPartnerCode: 'BE1' });
    expect(v.title).toBe('Đã huỷ thu gom');
    expect(v.waybill).toBeNull();
  });
});
