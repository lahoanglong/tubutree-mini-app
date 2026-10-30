// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionItem } from '@tubutree/app-core/api/game';
import { render, type Rendered } from '@/test-utils/dom';

vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/vuon-xanh' }));

import { MissionsCard } from './missions-card';

const DONE: MissionItem = { code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', rewardPoints: 20_000, progress: 1, goal: 1, completed: true, claimed: false };
const OPEN: MissionItem = { code: 'REVIEW_3', title: 'Nhà phê bình', rewardPoints: 15_000, progress: 1, goal: 3, completed: false, claimed: false };

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});
const show = (missions: MissionItem[]) => {
  mounted = render(<MissionsCard missions={missions} streakDays={0} claimPending={false} claimVariables={undefined} onClaim={vi.fn()} />);
  return mounted.container;
};
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).map((b) => b.textContent);

describe('MissionsCard (web): khách vãng lai không được hứa Điểm Xanh', () => {
  it('user thật: có "+N Điểm Xanh" và nút Nhận thưởng, không có câu mời đăng nhập', () => {
    const c = show([DONE, OPEN]);
    expect(c.textContent).toContain('+20.000 Điểm Xanh');
    expect(buttons(c)).toContain('Nhận thưởng');
    expect(c.querySelector('[data-testid="guest-points-note"]')).toBeNull();
  });

  it('khách vãng lai: một câu mời đăng nhập cho cả thẻ, không chữ "+N Điểm Xanh", không nút Nhận thưởng; tiến độ vẫn hiện', () => {
    const c = show([{ ...DONE, pointsBlocked: 'GUEST' }, { ...OPEN, pointsBlocked: 'GUEST' }]);
    expect(c.querySelectorAll('[data-testid="guest-points-note"]')).toHaveLength(1);
    expect(c.querySelector('[data-testid="guest-points-note"]')!.textContent).toContain('Đăng nhập Zalo để nhận Điểm Xanh');
    expect(c.textContent).not.toMatch(/\+[\d.]+ Điểm Xanh/);
    expect(buttons(c)).not.toContain('Nhận thưởng');
    expect(c.textContent).toContain('1/1');
    expect(c.textContent).toContain('1/3');
    expect(c.querySelector('[data-testid="guest-points-note"] a')!.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fvuon-xanh');
  });
});
