import { describe, expect, it } from 'vitest';
import { formatPoints, milestoneStatusText, monthLabel, progressPct, revenueRuleText, tierRewardLabel } from './milestone-copy';

describe('milestone-copy — thưởng mốc CTV là Điểm Xanh', () => {
  it('formatPoints dùng đơn vị "điểm", không có "xu"', () => {
    expect(formatPoints(2_000)).toMatch(/^2[.,]000 điểm$/);
    expect(formatPoints(600)).not.toMatch(/xu/i);
  });

  it('trạng thái mốc: đã nhận, đạt, chưa đạt kèm doanh số ĐÃ CHỐT còn thiếu', () => {
    expect(milestoneStatusText({ achieved: true, claimed: true, threshold: 3_000_000 }, 5_000_000)).toBe('Đã cộng vào Điểm Xanh');
    expect(milestoneStatusText({ achieved: true, claimed: false, threshold: 3_000_000 }, 5_000_000)).toContain('Đã đạt');
    expect(milestoneStatusText({ achieved: false, claimed: false, threshold: 3_000_000 }, 1_000_000)).toMatch(
      /^Còn thiếu 2[.,]000[.,]000đ doanh số đã chốt$/,
    );
  });

  it('bảng bậc không hứa "% bonus"', () => {
    expect(tierRewardLabel({ milestoneRewardPoints: 600 })).toBe('Thưởng mốc +600 điểm');
    expect(tierRewardLabel({ milestoneRewardPoints: null })).toBe('Bậc khởi đầu');
    expect(tierRewardLabel({ milestoneRewardPoints: 600 })).not.toMatch(/%|bonus|xu/i);
  });

  it('quy tắc doanh số đã chốt nêu đúng số ngày giữ và không gồm phí ship', () => {
    const t = revenueRuleText(20);
    expect(t).toContain('20 ngày');
    expect(t).toContain('không gồm phí ship');
  });

  it('thanh bậc chưa tới ngưỡng tối đa 99%', () => {
    expect(progressPct(9_990_000, 10_000_000)).toBe(99);
    expect(progressPct(10_000_000, 10_000_000)).toBe(100);
  });

  it('monthLabel', () => {
    expect(monthLabel('2026-09')).toBe('tháng 9/2026');
    expect(monthLabel('bad')).toBe('bad');
  });
});
