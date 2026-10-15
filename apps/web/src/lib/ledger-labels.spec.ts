import { describe, expect, it } from 'vitest';
import { pointsReasonDetail, pointsReasonLabel, walletTxLabel } from './ledger-labels';

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

/**
 * Mọi `reason` mà API ghi vào points_transactions (R5-ADMIN-4). Nguồn: loyalty.service (ORDER_DELIVERED, ORDER_REVERSED,
 * ORDER_REFUND_POINTS, LOYALTY_REDEEM_VOUCHER, DAILY_CHECKIN, POS_OFFLINE_ORDER), loyalty-expiry.service (POINTS_EXPIRED),
 * checkout.service (ORDER_REDEEM, ORDER_REDEEM_CONVERTED), order-reversal.service (ORDER_REFUND_*, RETURN_*),
 * wallet/referral-reward + reward-points.service (REFERRAL_*), feed/community-reward.service (COMMUNITY_*),
 * storefront-quest.service, affiliate.service (CTV_MILESTONE), game.service (GAME_*, MISSION), season-pass.service,
 * reviews.service (REVIEW, REVIEW_DELETE), migration pd3_xu_to_points (XU_TO_POINTS), auth.service gộp phiên (tiền tố MERGED:<id>:).
 * Thêm mã mới ở API thì thêm một dòng ở đây và ở ledger-labels.ts (và account-api.ts của miniapp).
 */
const API_REASONS: ReadonlyArray<readonly [reason: string, label: string, detail: string]> = [
  ['ORDER_DELIVERED:TUBU2026101546241', 'Tích điểm từ đơn hàng', 'Tích điểm từ đơn hàng · TUBU2026101546241'],
  ['ORDER_REVERSED:TUBU2026101546241', 'Hoàn ngược điểm (hủy/trả)', 'Hoàn ngược điểm (hủy/trả) · TUBU2026101546241'],
  ['ORDER_REFUND_POINTS:TUBU2026101546241', 'Hoàn lại điểm đã dùng', 'Hoàn lại điểm đã dùng · TUBU2026101546241'],
  ['ORDER_REFUND_CONVERTED:TUBU2026101546241', 'Hoàn điểm đơn huỷ/trả', 'Hoàn điểm đơn huỷ/trả · TUBU2026101546241'],
  ['ORDER_REFUND_XU:TUBU2026101546241', 'Hoàn điểm đơn huỷ/trả', 'Hoàn điểm đơn huỷ/trả · TUBU2026101546241'],
  ['ORDER_REDEEM:TUBU2026101546241', 'Dùng điểm khi thanh toán', 'Dùng điểm khi thanh toán · TUBU2026101546241'],
  ['ORDER_REDEEM_CONVERTED:TUBU2026101546241', 'Dùng điểm khi thanh toán', 'Dùng điểm khi thanh toán · TUBU2026101546241'],
  ['RETURN_REVERSED:TUBU2026101538731', 'Thu hồi điểm của đơn trả hàng', 'Thu hồi điểm của đơn trả hàng · TUBU2026101538731'],
  ['RETURN_REFUND_POINTS:TUBU2026101538731', 'Hoàn lại điểm đã dùng (trả hàng)', 'Hoàn lại điểm đã dùng (trả hàng) · TUBU2026101538731'],
  ['RETURN_REFUND_CONVERTED:TUBU2026101538731', 'Hoàn lại điểm đã dùng (trả hàng)', 'Hoàn lại điểm đã dùng (trả hàng) · TUBU2026101538731'],
  ['LOYALTY_REDEEM_VOUCHER:reward-discount-50k', 'Đổi điểm lấy mã giảm giá', 'Đổi điểm lấy mã giảm giá'],
  ['DAILY_CHECKIN:DAY_3', 'Điểm danh hằng ngày', 'Điểm danh hằng ngày · ngày 3'],
  ['POS_OFFLINE_ORDER:rcpt-77', 'Tích điểm mua tại cửa hàng', 'Tích điểm mua tại cửa hàng'],
  ['POINTS_EXPIRED', 'Điểm hết hạn', 'Điểm hết hạn'],
  ['XU_TO_POINTS:123456', 'Chuyển từ xu cũ sang Điểm Xanh', 'Chuyển từ xu cũ sang Điểm Xanh'],
  ['REFERRAL_ORDER2:u1', 'Thưởng giới thiệu bạn bè', 'Thưởng giới thiệu bạn bè'],
  ['REFERRAL_MILESTONE:u1:3', 'Thưởng giới thiệu bạn bè', 'Thưởng giới thiệu bạn bè'],
  ['REFERRAL_MILESTONE:u1:3#1', 'Thưởng giới thiệu bạn bè', 'Thưởng giới thiệu bạn bè'],
  ['REFERRAL_ORDER2_REVOKE:u1', 'Thu hồi thưởng giới thiệu', 'Thu hồi thưởng giới thiệu'],
  ['REFERRAL_MILESTONE_REVOKE:u1:3#1', 'Thu hồi thưởng giới thiệu', 'Thu hồi thưởng giới thiệu'],
  ['REFERRAL_ORDER2_DEBT:u1', 'Ghi nợ thu hồi thưởng giới thiệu', 'Ghi nợ thu hồi thưởng giới thiệu'],
  ['REFERRAL_MILESTONE_DEBT:u1:3#1:12', 'Ghi nợ thu hồi thưởng giới thiệu', 'Ghi nợ thu hồi thưởng giới thiệu'],
  ['COMMUNITY_POST:p1', 'Thưởng cộng đồng', 'Thưởng cộng đồng'],
  ['COMMUNITY_ANSWER:c1', 'Thưởng cộng đồng', 'Thưởng cộng đồng'],
  ['COMMUNITY_BEST:p1', 'Thưởng cộng đồng', 'Thưởng cộng đồng'],
  ['COMMUNITY_EVENT_WIN:e1:u1', 'Thưởng cộng đồng', 'Thưởng cộng đồng'],
  ['STOREFRONT_QUEST:PROFILE', 'Thưởng nhiệm vụ gian hàng', 'Thưởng nhiệm vụ gian hàng'],
  ['CTV_MILESTONE:m1:2026-10', 'Thưởng mốc doanh số CTV', 'Thưởng mốc doanh số CTV'],
  ['GAME_BUY_TREE:TUBU-ABC', 'Góp quỹ trồng cây', 'Góp quỹ trồng cây'],
  ['GAME_SPIN_COST', 'Quay vòng quay may mắn', 'Quay vòng quay may mắn'],
  ['GAME_SPIN_WIN:p1', 'Phần thưởng Vườn Xanh', 'Phần thưởng Vườn Xanh'],
  ['SEASONPASS:s1:3:FREE', 'Phần thưởng Vườn Xanh', 'Phần thưởng Vườn Xanh'],
  ['MISSION:WATER_5:2026-10-15', 'Thưởng nhiệm vụ Vườn Xanh', 'Thưởng nhiệm vụ Vườn Xanh'],
  ['REVIEW:ca-phe', 'Đánh giá sản phẩm', 'Đánh giá sản phẩm'],
  ['REVIEW_DELETE:prod1', 'Thu hồi điểm đánh giá đã xoá', 'Thu hồi điểm đánh giá đã xoá'],
];
const FALLBACK = 'Điều chỉnh Điểm Xanh';

describe('mọi mã reason API ghi vào sổ Điểm Xanh đều có nhãn tiếng Việt (R5-ADMIN-4)', () => {
  it.each(API_REASONS)('%s → %s', (reason, label, detail) => {
    expect(pointsReasonLabel(reason)).toBe(label);
    expect(pointsReasonDetail(reason)).toBe(detail);
  });

  it('không mã nào của API rơi về nhãn chung, và không nhãn nào còn chữ hoa kỹ thuật dạng MÃ_MÃ', () => {
    for (const [reason, label, detail] of API_REASONS) {
      expect(pointsReasonLabel(reason)).not.toBe(FALLBACK);
      expect(`${label}${detail}`).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
  });

  it('mã chỉ có dòng ngày điểm danh nhưng DAY_ lạ vẫn đọc được', () => {
    expect(pointsReasonDetail('DAILY_CHECKIN:DAY_x')).toBe('Điểm danh hằng ngày');
    expect(pointsReasonDetail('DAILY_CHECKIN')).toBe('Điểm danh hằng ngày');
  });

  it('dòng sổ của khách vãng lai gộp vào tài khoản chính (tiền tố MERGED:<id>:) vẫn đọc được', () => {
    expect(pointsReasonLabel('MERGED:guest-1:STOREFRONT_QUEST:PROFILE')).toBe('Thưởng nhiệm vụ gian hàng');
    expect(pointsReasonDetail('MERGED:guest-1:ORDER_DELIVERED:TUBU1')).toBe('Tích điểm từ đơn hàng · TUBU1');
  });

  it('mã lạ hoặc rỗng: nhãn chung, không lộ mã, không kèm tham chiếu', () => {
    expect(pointsReasonLabel('SOMETHING_NEW:1')).toBe(FALLBACK);
    expect(pointsReasonDetail('SOMETHING_NEW:TUBU1')).toBe(FALLBACK);
    expect(pointsReasonDetail('')).toBe(FALLBACK);
    expect(pointsReasonDetail('ORDER_DELIVERED')).toBe('Tích điểm từ đơn hàng');
  });

  it('phần tham chiếu không giống mã đơn thì bị bỏ (không in rác ra màn hình)', () => {
    expect(pointsReasonDetail('ORDER_DELIVERED:<script>x</script>')).toBe('Tích điểm từ đơn hàng');
    expect(pointsReasonDetail(`ORDER_DELIVERED:${'A'.repeat(80)}`)).toBe('Tích điểm từ đơn hàng');
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
