// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { TierCard } from './tier-card';

const dash = {
  monthRevenue: 3_000_000,
  tier: { name: 'Nảy Mầm', emoji: '🌿', nextName: 'Đơm Hoa', nextThreshold: 10_000_000, toNext: 7_000_000 },
};
const tiers = {
  revenue: 3_000_000,
  tier: dash.tier,
  allTiers: [
    { name: 'Hạt Giống', emoji: '🌱', min: 0, milestoneRewardPoints: null },
    { name: 'Nảy Mầm', emoji: '🌿', min: 1_000_000, milestoneRewardPoints: 600 },
    { name: 'Đơm Hoa', emoji: '🌸', min: 10_000_000, milestoneRewardPoints: 2_000 },
  ],
};

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('TierCard — bậc CTV theo doanh số đã chốt', () => {
  it('nêu bậc hiện tại, doanh số đã chốt và còn bao nhiêu để lên bậc kế', () => {
    mounted = render(<TierCard dash={dash} tiers={tiers} />);
    const text = mounted.container.textContent ?? '';
    expect(text).toContain('CTV Nảy Mầm');
    expect(text).toContain('Đã chốt: 3.000.000đ');
    expect(text).toContain('Còn 7.000.000đ doanh số đã chốt để lên bậc Đơm Hoa');
    expect(mounted.container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('30');
  });

  it('bậc cao nhất: không có dòng "để lên bậc"', () => {
    mounted = render(<TierCard dash={{ ...dash, tier: { ...dash.tier, nextName: null, nextThreshold: null, toNext: 0 } }} tiers={tiers} />);
    expect(mounted.container.textContent).not.toContain('để lên bậc');
  });

  it('bảng 5 bậc đóng mặc định; mở thì đánh dấu bậc hiện tại và chỉ nói thưởng mốc Điểm Xanh, không nói % bonus', () => {
    mounted = render(<TierCard dash={dash} tiers={tiers} />);
    const toggle = mounted.container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(mounted.container.querySelector('li')).toBeNull();
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = Array.from(mounted.container.querySelectorAll('li'));
    expect(rows).toHaveLength(3);
    expect(rows[1]!.getAttribute('aria-current')).toBe('true');
    expect(rows[1]!.textContent).toContain('Nảy Mầm (Hiện tại)');
    expect(rows[0]!.textContent).toContain('Bậc khởi đầu');
    expect(rows[0]!.textContent).toContain('Mặc định');
    expect(rows[2]!.textContent).toContain('Thưởng mốc +2.000 điểm');
    expect(rows[2]!.textContent).toContain('DS từ 10.000.000đ');
    expect(mounted.container.textContent).not.toMatch(/bonus/i);
  });

  it('chưa tải được bảng bậc: mở ra không vẽ gì sai', () => {
    mounted = render(<TierCard dash={dash} tiers={undefined} />);
    click(mounted.container.querySelector('button[aria-expanded]'));
    expect(mounted.container.querySelector('li')).toBeNull();
  });
});
