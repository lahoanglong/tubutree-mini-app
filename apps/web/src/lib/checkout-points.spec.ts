import { describe, it, expect } from 'vitest';
import { checkoutPointsOffer, partnerPointsState, pointsSummary, zeroTotalNote } from './checkout-points';

// Backend kẹp Điểm Xanh ở checkout theo số DÙNG ĐƯỢC (số dư − điểm đơn còn trong hạn đổi/trả hoặc đang
// chờ xử lý đổi/trả) — ô "Dùng … Điểm Xanh" trên web phải đề nghị đúng số đó, không phải số dư.
describe('checkoutPointsOffer', () => {
  it('dùng redeemablePoints của báo giá, kèm ghi chú phần chưa dùng được', () => {
    expect(checkoutPointsOffer({ pointsBalance: 500, redeemablePoints: 200, lockedPoints: 300 })).toEqual({
      usable: 200,
      lockNote: '300 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
      convertedNote: null,
    });
  });

  it('không có điểm khoá → dùng được toàn bộ số dư, không ghi chú', () => {
    expect(checkoutPointsOffer({ pointsBalance: 120, redeemablePoints: 120, lockedPoints: 0 })).toEqual({ usable: 120, lockNote: null, convertedNote: null });
  });

  it('toàn bộ số dư đang khoá → usable 0 nhưng vẫn giải thích vì sao', () => {
    expect(checkoutPointsOffer({ pointsBalance: 80, redeemablePoints: 0, lockedPoints: 80 })).toEqual({
      usable: 0,
      lockNote: '80 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
      convertedNote: null,
    });
  });

  it('API cũ chưa trả redeemablePoints → số dư (backend vẫn tự kẹp)', () => {
    expect(checkoutPointsOffer({ pointsBalance: 90 })).toEqual({ usable: 90, lockNote: null, convertedNote: null });
  });

  it('chưa có báo giá → 0', () => {
    expect(checkoutPointsOffer(undefined)).toEqual({ usable: 0, lockNote: null, convertedNote: null });
  });
});

// Điểm Xanh = lô thường (có hạn, bị khoá/trần 20%) + lô quy đổi (không hết hạn, không khoá, trả tới 100% giá trị
// hàng). Web phải đề nghị cả hai lô như Mini App, nếu không khách chỉ có điểm quy đổi không bao giờ thấy ô dùng điểm.
describe('checkoutPointsOffer với điểm quy đổi (PD-3)', () => {
  it('chỉ có điểm quy đổi → dùng được toàn bộ, kèm ghi chú không hết hạn', () => {
    expect(
      checkoutPointsOffer({ pointsBalance: 0, redeemablePoints: 0, lockedPoints: 0, pointsConvertedBalance: 124, redeemableConvertedPoints: 124 }),
    ).toEqual({ usable: 124, lockNote: null, convertedNote: 'trong đó 124 điểm không hết hạn, trả tới 100% giá trị hàng' });
  });

  it('cộng lô thường dùng được với lô quy đổi; điểm thường đang khoá không tính vào usable', () => {
    expect(
      checkoutPointsOffer({
        pointsBalance: 500,
        redeemablePoints: 200,
        lockedPoints: 300,
        pointsConvertedBalance: 1250,
        redeemableConvertedPoints: 1250,
      }),
    ).toEqual({
      usable: 1450,
      lockNote: '300 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
      convertedNote: 'trong đó 1.250 điểm không hết hạn, trả tới 100% giá trị hàng',
    });
  });

  it('API trả pointsConvertedBalance mà chưa trả redeemableConvertedPoints → vẫn dùng số dư lô quy đổi', () => {
    expect(checkoutPointsOffer({ pointsBalance: 0, pointsConvertedBalance: 7 }).usable).toBe(7);
  });

  it('API cũ chưa có điểm quy đổi → hành vi cũ, không ghi chú', () => {
    expect(checkoutPointsOffer({ pointsBalance: 90 })).toEqual({ usable: 90, lockNote: null, convertedNote: null });
  });

  it('số âm hoặc rác ở lô quy đổi → 0, không bao giờ làm usable âm hoặc NaN', () => {
    expect(checkoutPointsOffer({ pointsBalance: 10, pointsConvertedBalance: -5, redeemableConvertedPoints: Number.NaN }).usable).toBe(10);
  });
});

describe('pointsSummary (tài khoản web)', () => {
  it('Điểm Xanh hiển thị = tổng hai lô, kèm phần không hết hạn', () => {
    expect(pointsSummary({ pointsBalance: 30, pointsConvertedBalance: 124 })).toEqual({
      standard: 30,
      converted: 124,
      total: 154,
      convertedNote: 'trong đó 124 điểm không hết hạn',
    });
  });

  it('chỉ có điểm quy đổi vẫn thấy tổng khác 0', () => {
    expect(pointsSummary({ pointsBalance: 0, pointsConvertedBalance: 1250 }).total).toBe(1250);
  });

  it('không có điểm quy đổi (phiên cũ chưa có field) → tổng = lô thường, không ghi chú', () => {
    expect(pointsSummary({ pointsBalance: 42 })).toEqual({ standard: 42, converted: 0, total: 42, convertedNote: null });
  });
});

describe('zeroTotalNote', () => {
  it('đơn 0đ nhờ điểm → nói rõ đã trả đủ bằng Điểm Xanh', () => {
    expect(zeroTotalNote({ total: 0, pointsDiscount: 50000 })).toBe('Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm.');
  });

  it('đơn 0đ không do điểm (mã giảm giá) → lời trung tính', () => {
    expect(zeroTotalNote({ total: 0, pointsDiscount: 0 })).toBe('Đơn không còn số tiền cần thanh toán.');
  });

  it('còn tiền phải trả → null (vẫn chọn phương thức thanh toán)', () => {
    expect(zeroTotalNote({ total: 1000, pointsDiscount: 0 })).toBeNull();
  });
});

const NOTE = 'Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác';

describe('partnerPointsState (Q8 S7)', () => {
  it('giỏ không có hàng đối tác (hoặc API cũ): không đổi gì', () => {
    expect(partnerPointsState(undefined)).toEqual({ disabled: false, capNote: null, partnerNote: null });
    expect(partnerPointsState({ pointsMax: 20, pointsPartnerNote: null })).toEqual({ disabled: false, capNote: null, partnerNote: null });
  });

  it('giỏ có hàng đối tác: nêu trần điểm của đơn và câu giải thích', () => {
    expect(partnerPointsState({ pointsMax: 1250, pointsPartnerNote: NOTE })).toEqual({
      disabled: false,
      capNote: 'Đơn này dùng tối đa 1.250 Điểm Xanh',
      partnerNote: NOTE,
    });
  });

  it('giỏ chỉ hàng đối tác: tắt ô Điểm Xanh, giữ câu giải thích', () => {
    expect(partnerPointsState({ pointsMax: 0, pointsPartnerNote: NOTE })).toEqual({ disabled: true, capNote: null, partnerNote: NOTE });
  });
});
