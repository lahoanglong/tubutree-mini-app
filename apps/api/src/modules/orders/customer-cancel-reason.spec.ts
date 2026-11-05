import { CANCEL_REASONS, cancelReasonNote } from './cancel-reasons';
import { customerCancelReason, type CancelHistoryRow } from './customer-cancel-reason';

const row = (over: Partial<CancelHistoryRow>): CancelHistoryRow => ({
  fromStatus: 'CONFIRMED',
  toStatus: 'CANCELLED',
  actorType: 'SYSTEM',
  note: null,
  createdAt: new Date('2026-11-05T03:00:00Z'),
  ...over,
});

const CONTACT = 'Cần biết thêm, bạn liên hệ CSKH.';

describe('customerCancelReason', () => {
  it('chưa có dòng huỷ nào (đơn chưa huỷ, lịch sử rỗng) → null', () => {
    expect(customerCancelReason([])).toBeNull();
    expect(customerCancelReason([row({ toStatus: 'CONFIRMED', fromStatus: 'PENDING_PAYMENT' })])).toBeNull();
  });

  describe('CUSTOMER', () => {
    it('đúng chuỗi cancelReasonNote: "Khách huỷ: <nhãn>" → "Bạn đã huỷ: <nhãn>"', () => {
      const note = cancelReasonNote('CHANGED_MIND', undefined);
      expect(customerCancelReason([row({ actorType: 'CUSTOMER', note })])).toBe(`Bạn đã huỷ: ${CANCEL_REASONS.CHANGED_MIND}`);
    });

    it('kèm chữ của khách: "Bạn đã huỷ: <nhãn>. <chữ khách>"', () => {
      const note = cancelReasonNote('OTHER', 'Con ốm, đi viện');
      expect(customerCancelReason([row({ actorType: 'CUSTOMER', note })])).toBe(`Bạn đã huỷ: ${CANCEL_REASONS.OTHER}. Con ốm, đi viện`);
    });

    it('note null (app cũ không gửi lý do) → "Bạn đã huỷ đơn này"', () => {
      expect(customerCancelReason([row({ actorType: 'CUSTOMER', note: null })])).toBe('Bạn đã huỷ đơn này');
    });

    it('note không đúng khuôn của cancelReasonNote không được in ra', () => {
      expect(customerCancelReason([row({ actorType: 'CUSTOMER', note: 'ghi chú lạ nội bộ' })])).toBe('Bạn đã huỷ đơn này');
    });

    it('chữ khách quá dài bị cắt, không trả chuỗi vô hạn', () => {
      const note = `Khách huỷ: ${CANCEL_REASONS.OTHER}. ${'a'.repeat(2000)}`;
      expect((customerCancelReason([row({ actorType: 'CUSTOMER', note })]) ?? '').length).toBeLessThanOrEqual(400);
    });
  });

  describe('SYSTEM', () => {
    it('tự huỷ quá hạn thanh toán (cả đơn đại lý và ca đã mở lệnh cổng) → câu cố định, không lộ gợi ý đối chiếu nội bộ', () => {
      const plain = 'Tự huỷ: quá 24 giờ chưa thanh toán';
      const gateway = 'Tự huỷ: quá 48 giờ chưa thanh toán — đã mở lệnh ZALOPAY: đối chiếu ZALOPAY, đã trừ tiền thì hoàn thủ công';
      for (const note of [plain, gateway]) {
        const out = customerCancelReason([row({ actorType: 'SYSTEM', fromStatus: 'PENDING_PAYMENT', note })]);
        expect(out).toBe('Đơn tự huỷ vì quá hạn thanh toán');
      }
    });

    it('note không nhận ra hoặc rỗng → "Đơn đã được huỷ", không in note thô', () => {
      expect(customerCancelReason([row({ actorType: 'SYSTEM', note: 'cron X: lỗi nội bộ mã 42' })])).toBe('Đơn đã được huỷ');
      expect(customerCancelReason([row({ actorType: 'SYSTEM', note: null })])).toBe('Đơn đã được huỷ');
    });
  });

  describe('ADMIN', () => {
    it('admin nhập lý do: khách đã đọc đúng chữ đó trong thông báo huỷ nên được dùng (bỏ tiền tố "Admin: " và dấu chấm cuối)', () => {
      expect(customerCancelReason([row({ actorType: 'ADMIN', note: 'Admin: Hết hàng, xin lỗi bạn.' })])).toBe(
        'Tubu Tree đã huỷ đơn này. Lý do: Hết hàng, xin lỗi bạn',
      );
    });

    it('không có lý do → câu cố định kèm CSKH', () => {
      expect(customerCancelReason([row({ actorType: 'ADMIN', note: null })])).toBe(`Tubu Tree đã huỷ đơn này. ${CONTACT}`);
      expect(customerCancelReason([row({ actorType: 'ADMIN', note: 'Admin:   ' })])).toBe(`Tubu Tree đã huỷ đơn này. ${CONTACT}`);
    });

    it('note KHÔNG có tiền tố "Admin: " (ghi nội bộ khác) không được lọt ra', () => {
      expect(customerCancelReason([row({ actorType: 'ADMIN', note: 'Kế toán hoàn tay 120k, khách nghi lừa đảo' })])).toBe(`Tubu Tree đã huỷ đơn này. ${CONTACT}`);
    });
  });

  describe('MERCHANT', () => {
    it('gian hàng nhập lý do: chính chữ đó đã gửi khách (MERCHANT_ORDER_CANCELLED_BY_SELLER) nên được dùng', () => {
      expect(customerCancelReason([row({ actorType: 'MERCHANT', note: 'Hết hàng đợt này' })])).toBe('Gian hàng đã huỷ đơn này. Lý do: Hết hàng đợt này');
    });

    it('không có lý do → câu cố định kèm CSKH', () => {
      expect(customerCancelReason([row({ actorType: 'MERCHANT', note: null })])).toBe(`Gian hàng đã huỷ đơn này. ${CONTACT}`);
    });
  });

  describe('PANCAKE', () => {
    it('không bao giờ lộ note: câu cố định kèm CSKH', () => {
      for (const note of ['Pancake: giao không thành, hàng đã hoàn về kho', 'Đồng bộ trạng thái Pancake khi yêu cầu huỷ', null]) {
        expect(customerCancelReason([row({ actorType: 'PANCAKE', note })])).toBe(`Tubu Tree đã huỷ đơn này. ${CONTACT}`);
      }
    });
  });

  it('actorType lạ → "Đơn đã được huỷ", không in note', () => {
    expect(customerCancelReason([row({ actorType: 'ROBOT', note: 'bí mật' })])).toBe('Đơn đã được huỷ');
  });

  describe('chọn dòng huỷ', () => {
    it('lấy dòng huỷ mới nhất, bất kể thứ tự mảng', () => {
      const old = row({ actorType: 'CUSTOMER', note: cancelReasonNote('CHANGED_MIND', undefined), createdAt: new Date('2026-11-05T01:00:00Z') });
      const latest = row({ actorType: 'ADMIN', note: 'Admin: Trùng đơn', createdAt: new Date('2026-11-05T05:00:00Z') });
      expect(customerCancelReason([old, latest])).toBe('Tubu Tree đã huỷ đơn này. Lý do: Trùng đơn');
      expect(customerCancelReason([latest, old])).toBe('Tubu Tree đã huỷ đơn này. Lý do: Trùng đơn');
    });

    it('dòng đánh dấu CANCELLED → CANCELLED (Pancake ghi vết khi đơn đã huỷ) không che người thực sự huỷ', () => {
      const cancel = row({ actorType: 'CUSTOMER', note: cancelReasonNote('WRONG_ORDER', undefined), createdAt: new Date('2026-11-05T01:00:00Z') });
      const marker = row({ actorType: 'PANCAKE', fromStatus: 'CANCELLED', note: 'Pancake báo đã thanh toán, chờ đối chiếu', createdAt: new Date('2026-11-05T09:00:00Z') });
      expect(customerCancelReason([cancel, marker])).toBe(`Bạn đã huỷ: ${CANCEL_REASONS.WRONG_ORDER}`);
    });

    it('chỉ có dòng đánh dấu CANCELLED → CANCELLED (không rõ ai huỷ) → null', () => {
      expect(customerCancelReason([row({ actorType: 'PANCAKE', fromStatus: 'CANCELLED', note: 'x' })])).toBeNull();
    });
  });
});
