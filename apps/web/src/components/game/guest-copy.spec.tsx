// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameProfile } from '@tubutree/app-core/api/game';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import { render, type Rendered } from '@/test-utils/dom';

import { CheckInStreak } from './checkin-streak';
import { TreeActions } from './tree-actions';

const PROFILE = { streakDays: 0, totalSeeds: 5, dailyLoginSeeds: 10, firstCheckinBonus: 0, lastCheckInAt: new Date().toISOString(), lastDewAt: null } as unknown as GameProfile;
const STATUS = { checkedInToday: false, streakDays: 0, streakDay: 1, currentCycleDay: 1, rewards: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, points: 1000, claimed: false, isToday: i === 0 })) } as unknown as CheckInStatusResponse;

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const streak = (status: CheckInStatusResponse) => {
  mounted = render(<CheckInStreak profile={PROFILE} status={status} onBuyFreeze={vi.fn()} freezePending={false} onCollectDew={vi.fn()} dewPending={false} onNeedWater={vi.fn()} />);
  return mounted.container;
};
const actions = (pointsBlocked: boolean, onClaim = vi.fn()) => {
  mounted = render(<TreeActions profile={PROFILE} pointsPending pointsBlocked={pointsBlocked} pending={false} onClaim={onClaim} onWater={vi.fn()} onHarvest={vi.fn()} onEarn={vi.fn()} />);
  return { c: mounted.container, onClaim };
};

describe('CheckInStreak (web): câu phụ theo khách vãng lai', () => {
  it('user thật: hứa kèm Điểm Xanh', () => {
    expect(streak(STATUS).textContent).toContain('Nhận +10💧 và Điểm Xanh mỗi ngày');
  });
  it('khách vãng lai (pointsBlocked): chỉ giọt nước, không chữ Điểm Xanh', () => {
    const c = streak({ ...STATUS, pointsBlocked: 'GUEST' });
    expect(c.textContent).toContain('Nhận +10💧 mỗi ngày');
    expect(c.textContent).not.toContain('Điểm Xanh');
  });
});

describe('TreeActions (web): nhãn khi còn dở phần điểm danh', () => {
  it('user thật: "Nhận Điểm Xanh hôm nay"', () => {
    expect(actions(false).c.textContent).toContain('Nhận Điểm Xanh hôm nay');
  });
  it('khách vãng lai: "Điểm danh hôm nay", không hứa Điểm Xanh, vẫn gọi onClaim', () => {
    const { c, onClaim } = actions(true);
    expect(c.textContent).toContain('Điểm danh hôm nay');
    expect(c.textContent).not.toContain('Điểm Xanh');
    c.querySelector('button')!.click();
    expect(onClaim).toHaveBeenCalledTimes(1);
  });
});
