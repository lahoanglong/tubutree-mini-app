import { describe, expect, it } from 'vitest';
import { applyPitch, formatRatePct, pendingBody, rewardClaimView, vnLastDayLabel } from './dealer-view';

const base = { achieved: true, canClaim: true, claimStatus: null, rejectionReason: null, toGo: 0, pendingVolume: 0, isCurrentPeriod: true, claimDeadline: '2026-11-01T00:00:00+07:00' } as const;

describe('rewardClaimView', () => {
  it('claimStatus của máy chủ luôn thắng: đã có yêu cầu thì không hiện nút', () => {
    for (const claimStatus of ['PENDING', 'APPROVED', 'PAID', 'REJECTED'] as const) {
      expect(rewardClaimView({ ...base, claimStatus }).showClaimButton).toBe(false);
    }
    expect(rewardClaimView({ ...base, claimStatus: 'PENDING' }).badge).toEqual({ label: 'Đã gửi yêu cầu · chờ duyệt', tone: 'info' });
    expect(rewardClaimView({ ...base, claimStatus: 'APPROVED' }).badge?.label).toBe('Đã duyệt · chờ trao thưởng');
    expect(rewardClaimView({ ...base, claimStatus: 'PAID' }).badge?.label).toBe('Đã trao thưởng');
  });

  it('bị từ chối: nêu lý do admin, không có lý do thì chỉ về Zalo OA', () => {
    expect(rewardClaimView({ ...base, claimStatus: 'REJECTED', rejectionReason: 'Sai số liệu' }).hint).toBe('Lý do: Sai số liệu');
    expect(rewardClaimView({ ...base, claimStatus: 'REJECTED' }).hint).toBe('Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.');
  });

  it('chưa đạt: còn bao nhiêu, kèm phần đang chờ thanh toán/đóng gói', () => {
    expect(rewardClaimView({ ...base, achieved: false, toGo: 5_000_000 }).hint).toBe('Còn 5.000.000đ để đạt');
    expect(rewardClaimView({ ...base, achieved: false, toGo: 5_000_000, pendingVolume: 1_000_000 }).hint).toBe(
      'Còn 5.000.000đ để đạt · 1.000.000đ đang chờ thanh toán/đóng gói',
    );
    expect(rewardClaimView({ ...base, achieved: false }).showClaimButton).toBe(false);
  });

  it('đạt nhưng quá hạn gửi: nhãn hết hạn, không nút', () => {
    const v = rewardClaimView({ ...base, canClaim: false });
    expect(v.showClaimButton).toBe(false);
    expect(v.badge).toEqual({ label: 'Đã hết hạn gửi yêu cầu', tone: 'muted' });
  });

  it('đạt và còn hạn: hiện nút; kỳ trước nói hạn gửi là hết ngày cuối', () => {
    expect(rewardClaimView(base)).toMatchObject({ showClaimButton: true, badge: null, hint: 'Đã đạt chỉ tiêu doanh số' });
    expect(rewardClaimView({ ...base, isCurrentPeriod: false }).hint).toBe('Đã đạt · hạn gửi yêu cầu: hết ngày 31/10/2026');
  });
});

describe('vnLastDayLabel', () => {
  it('mốc loại trừ 00:00 giờ VN ngày kế thì ngày cuối còn hạn là ngày liền trước', () => {
    expect(vnLastDayLabel('2026-10-31T17:00:00Z')).toBe('31/10/2026');
    expect(vnLastDayLabel('2027-01-01T00:00:00+07:00')).toBe('31/12/2026');
  });
});

describe('chữ có số theo cấu hình', () => {
  it('formatRatePct: tỉ lệ 0..1 ra phần trăm kiểu Việt', () => {
    expect(formatRatePct(0.45)).toBe('45%');
    expect(formatRatePct(0.035)).toBe('3,5%');
    expect(formatRatePct(null)).toBe('0%');
  });
  it('applyPitch và pendingBody bỏ con số khi cấu hình chưa có', () => {
    expect(applyPitch(0.45)).toBe('Giá sỉ đến 45% · công nợ · đặt hàng nhanh số lượng lớn.');
    expect(applyPitch(null)).toBe('Giá sỉ ưu đãi · công nợ · đặt hàng nhanh số lượng lớn.');
    expect(pendingBody(24)).toBe('Đội ngũ Tubu sẽ xét duyệt trong vòng 24 giờ và liên hệ lại với bạn qua Zalo.');
    expect(pendingBody(null)).toBe('Đội ngũ Tubu sẽ xét duyệt và liên hệ lại với bạn qua Zalo.');
  });
});
