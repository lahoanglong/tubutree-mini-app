import { describe, it, expect } from 'vitest';
import {
  gomdonAdminActions,
  gomdonCancelLabel,
  gomdonStatusLabel,
  needsRecyclingAttention,
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

  it('chưa có vận đơn tự động mà hàng đã rời kho (SHIPPING) / kho đã giao bằng hãng khác → hết là việc cần làm', () => {
    for (const s of ['FAILED', 'NOT_CONFIGURED', 'NEEDS_MANUAL_CHECK']) {
      expect(needsRecyclingAttention({ ...base, status: 'SHIPPING', gomdonStatus: s })).toBe(false);
      expect(needsRecyclingAttention({ ...base, gomdonStatus: s, shippingCode: 'GHN123', shippingPartner: 'GHN' })).toBe(false);
      expect(needsRecyclingAttention({ ...base, gomdonStatus: s, shippingCode: 'X1', shippingPartner: null })).toBe(false);
      // Mã do Gomdon ghi (BestExpress) không tính là hãng khác.
      expect(needsRecyclingAttention({ ...base, gomdonStatus: s, shippingCode: 'BE1', shippingPartner: 'BestExpress' })).toBe(true);
    }
    // Mã lỗi Gomdon (2, 6, 8–12) vẫn cần xử lý khi đơn còn mở, kể cả đang giao.
    expect(needsRecyclingAttention({ ...base, status: 'SHIPPING', gomdonStatus: '11' })).toBe(true);
  });

  it('"Đã xử lý tay" (MANUAL_HANDLED) → không bao giờ trong hàng đợi, kể cả huỷ vận đơn lỗi', () => {
    expect(needsRecyclingAttention({ ...base, gomdonStatus: 'MANUAL_HANDLED' })).toBe(false);
    expect(needsRecyclingAttention({ ...base, status: 'CANCELLED', gomdonStatus: 'MANUAL_HANDLED', gomdonCancelStatus: 'FAILED' })).toBe(false);
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
      canMarkHandled: false,
    });
  });

  it('đơn đang giao / đã giao (hàng đã rời kho) → ẩn "Tạo lại vận đơn", vẫn cho "Đã xử lý tay"', () => {
    for (const status of ['SHIPPING', 'DELIVERED']) {
      for (const s of ['FAILED', 'NOT_CONFIGURED', 'NEEDS_MANUAL_CHECK', '2']) {
        const a = gomdonAdminActions({ ...base, status, gomdonStatus: s, gomdonOrderId: s === '2' ? 'g1' : null });
        expect(a.canRetry).toBe(false);
        expect(a.canMarkHandled).toBe(true);
      }
    }
  });

  it('"Đã xử lý tay" chỉ hiện ở trạng thái cần người xử lý (BE GOMDON_MANUAL_HANDLEABLE)', () => {
    for (const s of ['FAILED', 'NOT_CONFIGURED', 'NEEDS_MANUAL_CHECK', '2', '6', '8', '9', '10', '11', '12']) {
      expect(gomdonAdminActions({ ...base, gomdonStatus: s }).canMarkHandled).toBe(true);
    }
    for (const s of [null, 'AWAITING_PAYMENT', 'CREATING', '1', '3', '4', '5', '7', 'MANUAL_HANDLED']) {
      expect(gomdonAdminActions({ ...base, gomdonStatus: s }).canMarkHandled).toBe(false);
    }
    // Đơn đã huỷ mà vẫn cần kiểm tra tay (không rõ đã tạo vận đơn) → vẫn đánh dấu được sau khi huỷ tay.
    expect(gomdonAdminActions({ ...base, status: 'CANCELLED', gomdonStatus: 'NEEDS_MANUAL_CHECK', gomdonCancelStatus: 'FAILED' }).canMarkHandled).toBe(true);
  });

  it('đã xử lý tay → không tạo lại, không huỷ tự động', () => {
    const a = gomdonAdminActions({ ...base, gomdonStatus: 'MANUAL_HANDLED', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1' });
    expect(a).toEqual(expect.objectContaining({ canRetry: false, canCancel: false, canMarkHandled: false }));
    expect(gomdonStatusLabel('MANUAL_HANDLED')).toEqual(expect.objectContaining({ label: 'Đã xử lý tay', tone: 'neutral' }));
  });
});

describe('UAT GOMDON-2/9: báo động đang mở và huỷ vận đơn đã xử lý tay', () => {
  const alert = { id: 'a1', message: 'Gomdon CÓ vận đơn BE1 — kiểm tra ngay tránh giao trùng 2 vận đơn.', createdAt: '2026-10-13T00:00:00.000Z' };

  it('báo động chưa xử lý → luôn trong hàng đợi, kể cả vận đơn trông bình thường / hàng đã rời kho / đã xử lý tay', () => {
    expect(needsRecyclingAttention({ ...base, gomdonStatus: '1', gomdonAlerts: [alert] })).toBe(true);
    expect(needsRecyclingAttention({ ...base, status: 'SHIPPING', gomdonStatus: 'FAILED', gomdonAlerts: [alert] })).toBe(true);
    expect(needsRecyclingAttention({ ...base, status: 'DELIVERED', gomdonStatus: '7', gomdonAlerts: [alert] })).toBe(true);
    expect(needsRecyclingAttention({ ...base, gomdonStatus: 'MANUAL_HANDLED', gomdonAlerts: [alert] })).toBe(true);
    expect(needsRecyclingAttention({ ...base, gomdonStatus: '1', gomdonAlerts: [] })).toBe(false);
    expect(needsRecyclingAttention({ ...base, hasRecyclingPickup: false, gomdonAlerts: [alert] })).toBe(false);
  });

  it('huỷ vận đơn đã xử lý tay (MANUAL_HANDLED) → nhãn trung tính, rời hàng đợi, không còn nút huỷ', () => {
    expect(gomdonCancelLabel('MANUAL_HANDLED')).toEqual({ label: 'Đã xử lý huỷ tay', tone: 'neutral' });
    const o = { ...base, status: 'CANCELLED', gomdonStatus: '1', gomdonOrderId: 'g1', gomdonCancelStatus: 'MANUAL_HANDLED' };
    expect(needsRecyclingAttention(o)).toBe(false);
    expect(gomdonAdminActions(o).canCancel).toBe(false);
    expect(gomdonAdminActions(o).canMarkHandled).toBe(false);
  });

  it('đơn đã huỷ mà huỷ vận đơn lỗi / quá muộn → cho "Đã xử lý tay" (CSKH đã huỷ trên cổng Gomdon)', () => {
    for (const c of ['FAILED', 'TOO_LATE']) {
      const o = { ...base, status: 'CANCELLED', gomdonStatus: '1', gomdonOrderId: 'g1', gomdonCancelStatus: c };
      expect(gomdonAdminActions(o).canMarkHandled).toBe(true);
    }
    expect(gomdonAdminActions({ ...base, status: 'RETURNED', gomdonStatus: '3', gomdonCancelStatus: 'TOO_LATE' }).canMarkHandled).toBe(true);
    expect(gomdonAdminActions({ ...base, status: 'CANCELLED', gomdonStatus: '1', gomdonCancelStatus: 'CANCELLED' }).canMarkHandled).toBe(false);
  });
});
