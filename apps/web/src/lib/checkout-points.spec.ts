import { describe, it, expect } from 'vitest';
import { checkoutPointsOffer } from './checkout-points';

// Backend kẹp Điểm Xanh ở checkout theo số DÙNG ĐƯỢC (số dư − điểm đơn còn trong hạn đổi/trả hoặc đang
// chờ xử lý đổi/trả) — ô "Dùng … Điểm Xanh" trên web phải đề nghị đúng số đó, không phải số dư.
describe('checkoutPointsOffer', () => {
  it('dùng redeemablePoints của báo giá, kèm ghi chú phần chưa dùng được', () => {
    expect(checkoutPointsOffer({ pointsBalance: 500, redeemablePoints: 200, lockedPoints: 300 })).toEqual({
      usable: 200,
      lockNote: '300 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
    });
  });

  it('không có điểm khoá → dùng được toàn bộ số dư, không ghi chú', () => {
    expect(checkoutPointsOffer({ pointsBalance: 120, redeemablePoints: 120, lockedPoints: 0 })).toEqual({ usable: 120, lockNote: null });
  });

  it('toàn bộ số dư đang khoá → usable 0 nhưng vẫn giải thích vì sao', () => {
    expect(checkoutPointsOffer({ pointsBalance: 80, redeemablePoints: 0, lockedPoints: 80 })).toEqual({
      usable: 0,
      lockNote: '80 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
    });
  });

  it('API cũ chưa trả redeemablePoints → số dư (backend vẫn tự kẹp)', () => {
    expect(checkoutPointsOffer({ pointsBalance: 90 })).toEqual({ usable: 90, lockNote: null });
  });

  it('chưa có báo giá → 0', () => {
    expect(checkoutPointsOffer(undefined)).toEqual({ usable: 0, lockNote: null });
  });
});
