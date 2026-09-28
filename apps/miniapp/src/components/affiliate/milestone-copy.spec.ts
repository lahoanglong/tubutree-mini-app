import { describe, it, expect } from 'vitest';
import { formatXu } from '../../utils/format';
import {
  milestoneStatusText,
  monthLabel,
  progressPct,
  revenueRuleText,
  tierRewardLabel,
} from './milestone-copy';

describe('milestone-copy — thưởng mốc CTV là Tubu Xu, không phải điểm', () => {
  it('formatXu hiển thị đơn vị "xu" (không phải "điểm" của Điểm Xanh)', () => {
    expect(formatXu(2_000_000)).toMatch(/^2[.,]000[.,]000 xu$/);
    expect(formatXu(50_000)).not.toContain('điểm');
  });

  it('trạng thái mốc: đã nhận → ví Tubu Xu; đạt → mời nhận; chưa đạt → còn thiếu doanh số ĐÃ CHỐT', () => {
    expect(milestoneStatusText({ achieved: true, claimed: true, threshold: 3_000_000 }, 5_000_000)).toBe(
      'Đã cộng vào ví Tubu Xu',
    );
    expect(milestoneStatusText({ achieved: true, claimed: false, threshold: 3_000_000 }, 5_000_000)).toContain(
      'Đã đạt',
    );
    const missing = milestoneStatusText({ achieved: false, claimed: false, threshold: 3_000_000 }, 1_000_000);
    expect(missing).toMatch(/^Còn thiếu 2[.,]000[.,]000đ doanh số đã chốt$/);
  });

  it('bảng bậc không hứa "% bonus" — chỉ nêu thưởng mốc xu có thật', () => {
    expect(tierRewardLabel({ milestoneRewardXu: 600_000 })).toMatch(/^Thưởng mốc \+600[.,]000 xu$/);
    expect(tierRewardLabel({ milestoneRewardXu: null })).toBe('Bậc khởi đầu');
    expect(tierRewardLabel({ milestoneRewardXu: 600_000 })).not.toMatch(/%|bonus/i);
  });

  it('giải thích doanh số đã chốt nêu đúng số ngày giữ đổi/trả và không gồm phí ship', () => {
    const t = revenueRuleText(20);
    expect(t).toContain('20 ngày');
    expect(t).toContain('không gồm phí ship');
  });

  it('progressPct (thanh bậc): chưa tới ngưỡng thì tối đa 99% — không hiện 100% khi chưa lên bậc', () => {
    expect(progressPct(9_990_000, 10_000_000)).toBe(99);
    expect(progressPct(9_999_999, 10_000_000)).toBe(99);
    expect(progressPct(10_000_000, 10_000_000)).toBe(100);
    expect(progressPct(0, 10_000_000)).toBe(0);
    expect(progressPct(5_000_000, 0)).toBe(100);
  });

  it('monthLabel: "2026-09" → "tháng 9/2026"', () => {
    expect(monthLabel('2026-09')).toBe('tháng 9/2026');
    expect(monthLabel('2026-12')).toBe('tháng 12/2026');
    expect(monthLabel('bad')).toBe('bad');
  });
});
