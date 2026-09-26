import { describe, it, expect } from 'vitest';
import { rewardClaimView, vnLastDayLabel, type DealerRewardProgress } from './dealer-api';

/**
 * Card "Phần thưởng đại lý" rẽ nhánh theo claimStatus THẬT backend trả về. Bản WIP trước đây
 * rẽ theo 'CLAIMED' (backend không bao giờ trả) → nút "Yêu cầu nhận thưởng" luôn hiện, bấm vô hạn.
 */
const base: DealerRewardProgress = {
  id: 'r1',
  type: 'TOUR',
  title: 'Tour Đà Lạt',
  description: null,
  threshold: 50_000_000,
  period: 'QUARTER',
  periodKey: 'Q3/2026',
  periodLabel: 'Quý 3/2026',
  isCurrentPeriod: true,
  volume: 60_000_000,
  pendingVolume: 0,
  achieved: true,
  toGo: 0,
  claimStatus: null,
  claimId: null,
  rejectionReason: null,
  claimDeadline: '2026-10-30T17:00:00.000Z',
  canClaim: true,
};

describe('rewardClaimView', () => {
  it('đạt mốc, chưa gửi → hiện nút yêu cầu, không badge', () => {
    const v = rewardClaimView(base);
    expect(v.showClaimButton).toBe(true);
    expect(v.badge).toBeNull();
  });

  it('PENDING → ẩn nút, badge "chờ duyệt"', () => {
    const v = rewardClaimView({ ...base, claimStatus: 'PENDING', canClaim: false });
    expect(v.showClaimButton).toBe(false);
    expect(v.badge).toEqual({ label: 'Đã gửi yêu cầu · chờ duyệt', tone: 'info' });
  });

  it('APPROVED → badge đã duyệt, chờ trao', () => {
    const v = rewardClaimView({ ...base, claimStatus: 'APPROVED', canClaim: false });
    expect(v.showClaimButton).toBe(false);
    expect(v.badge).toEqual({ label: 'Đã duyệt · chờ trao thưởng', tone: 'success' });
  });

  it('PAID → badge đã trao thưởng', () => {
    const v = rewardClaimView({ ...base, claimStatus: 'PAID', canClaim: false });
    expect(v.showClaimButton).toBe(false);
    expect(v.badge).toEqual({ label: 'Đã trao thưởng ✓', tone: 'success' });
  });

  it('REJECTED → badge từ chối + lý do, KHÔNG cho gửi lại', () => {
    const v = rewardClaimView({ ...base, claimStatus: 'REJECTED', rejectionReason: 'Đơn đã trả hàng', canClaim: false });
    expect(v.showClaimButton).toBe(false);
    expect(v.badge).toEqual({ label: 'Yêu cầu bị từ chối', tone: 'danger' });
    expect(v.hint).toContain('Đơn đã trả hàng');
  });

  it('claimStatus có giá trị thì luôn thắng canClaim (phòng dữ liệu lệch)', () => {
    expect(rewardClaimView({ ...base, claimStatus: 'PENDING', canClaim: true }).showClaimButton).toBe(false);
  });

  it('chưa đạt → không nút; gợi ý còn thiếu + phần đang chờ chốt', () => {
    const v = rewardClaimView({
      ...base,
      achieved: false,
      canClaim: false,
      toGo: 20_000_000,
      pendingVolume: 40_000_000,
    });
    expect(v.showClaimButton).toBe(false);
    expect(v.badge).toBeNull();
    expect(v.hint).toContain('Còn 20.000.000đ để đạt');
    expect(v.hint).toContain('40.000.000đ');
  });

  it('đạt nhưng hết hạn gửi, chưa gửi → badge hết hạn, không nút', () => {
    const v = rewardClaimView({ ...base, canClaim: false });
    expect(v.showClaimButton).toBe(false);
    expect(v.badge).toEqual({ label: 'Đã hết hạn gửi yêu cầu', tone: 'muted' });
  });

  it('kỳ trước còn trong hạn gia hạn → nhắc hạn chót', () => {
    const v = rewardClaimView({ ...base, isCurrentPeriod: false });
    expect(v.showClaimButton).toBe(true);
    expect(v.hint).toContain('30/10/2026');
  });
});

describe('vnLastDayLabel', () => {
  it('mốc loại trừ 00:00 giờ VN → ngày cuối còn hạn là hôm trước', () => {
    expect(vnLastDayLabel('2026-10-30T17:00:00.000Z')).toBe('30/10/2026');
  });
});
