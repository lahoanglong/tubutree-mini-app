import { describe, expect, it } from 'vitest';
import { pointsReasonLabel, walletTxLabel } from './ledger-labels';

describe('pointsReasonLabel — sổ Điểm Xanh luôn đọc được bằng tiếng Việt', () => {
  it.each([
    ['ORDER_DELIVERED:TB1', 'Tích điểm từ đơn hàng'],
    ['ORDER_REDEEM:TB1', 'Dùng điểm khi thanh toán'],
    ['ORDER_REVERSED:TB1', 'Hoàn ngược điểm (hủy/trả)'],
    ['ORDER_REFUND_POINTS:TB1', 'Hoàn lại điểm đã dùng'],
    ['DAILY_CHECKIN:2026-10-14', 'Điểm danh hằng ngày'],
    ['POINTS_EXPIRED:2026-09', 'Điểm hết hạn'],
    ['REFERRAL_REVOKE:abc', 'Thu hồi thưởng giới thiệu'],
    ['REFERRAL_REWARD:abc', 'Thưởng giới thiệu bạn bè'],
    ['REVIEW:p1', 'Đánh giá sản phẩm'],
  ])('%s → %s', (reason, label) => {
    expect(pointsReasonLabel(reason)).toBe(label);
  });

  it('mã lạ không lộ ra màn hình', () => {
    expect(pointsReasonLabel('SOMETHING_NEW:1')).toBe('Điều chỉnh Điểm Xanh');
  });
});

describe('walletTxLabel', () => {
  it('nhãn theo loại biến động, loại chưa biết vẫn hiện được', () => {
    expect(walletTxLabel('ORDER_PAY')).toBe('Thanh toán đơn hàng');
    expect(walletTxLabel('ORDER_REFUND')).toBe('Hoàn tiền đơn hàng');
    expect(walletTxLabel('WITHDRAW')).toBe('Rút về ngân hàng');
    expect(walletTxLabel('BRAND_NEW_TYPE')).toBe('Biến động ví');
  });
});
