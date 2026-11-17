// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionItem } from '@tubutree/app-core/api/game';
import type { DailyMissionsResponse } from '@tubutree/shared-types';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ phase: 'guest' as string, get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

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

const DAILY: DailyMissionsResponse = {
  enabled: true,
  dayKey: '2026-11-17',
  missions: [
    { id: 'DAILY_QUIZ', done: true, claimed: true },
    { id: 'DAILY_STORY', done: true, claimed: false },
    { id: 'DAILY_WATER', done: false, claimed: false },
  ],
  water: 5,
  bonusPoints: 10,
  bonusClaimed: false,
  pointsBlocked: false,
  waterLeft: 35,
  pointsLeft: 100,
  quizPending: false,
};

describe('MissionsCard (web): phần Hôm nay (cờ engagement.daily_missions_enabled)', () => {
  beforeEach(() => {
    mocks.phase = 'authenticated';
    mocks.get.mockReset();
    mocks.post.mockReset();
  });
  afterEach(() => {
    mocks.phase = 'guest';
  });

  const showWith = async (onGo = vi.fn(), missions: MissionItem[] = [{ ...DONE, claimed: true }, OPEN]) => {
    mounted = render(<MissionsCard missions={missions} streakDays={0} claimPending={false} claimVariables={undefined} onClaim={vi.fn()} onGo={onGo} />);
    await flush();
    return mounted.container;
  };

  it('cờ tắt: thẻ như cũ, không có phần Hôm nay', async () => {
    mocks.get.mockResolvedValue({ enabled: false });
    const c = await showWith(vi.fn(), [DONE, OPEN]);
    expect(mocks.get).toHaveBeenCalledWith('/game/daily');
    expect(c.querySelector('[data-testid="daily-missions"]')).toBeNull();
    expect(buttons(c)).toContain('Nhận thưởng');
  });

  it('API cũ (404): thẻ như cũ', async () => {
    mocks.get.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const c = await showWith(vi.fn(), [DONE, OPEN]);
    expect(c.querySelector('[data-testid="daily-missions"]')).toBeNull();
    expect(c.textContent).toContain('Đơn hàng đầu tiên');
  });

  it('cờ bật: 3 dòng Hôm nay đứng đầu, nhiệm vụ một lần thu lại sau một nút', async () => {
    mocks.get.mockResolvedValue(DAILY);
    const onGo = vi.fn();
    const c = await showWith(onGo);
    const section = c.querySelector('[data-testid="daily-missions"]')!;
    expect(section).not.toBeNull();
    expect(section.querySelectorAll('[data-testid^="daily-row-"]')).toHaveLength(3);
    expect(section.textContent).toContain('2/3');
    expect(section.textContent).toContain('Xong cả 3 nhiệm vụ: +10 Điểm Xanh');
    expect(c.textContent).not.toContain('Nhà phê bình');
    const toggle = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Xem nhiệm vụ một lần (2)')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle.click());
    expect(c.textContent).toContain('Nhà phê bình');
    act(() => (c.querySelector('button[aria-label="Làm nhiệm vụ: Tưới cây"]') as HTMLButtonElement).click());
    expect(onGo).toHaveBeenCalledWith('checkin');
  });

  it('nhiệm vụ một lần có thưởng chờ nhận: mở sẵn, không có nút gập', async () => {
    mocks.get.mockResolvedValue(DAILY);
    const c = await showWith(vi.fn(), [DONE, OPEN]);
    expect(c.querySelector('[data-testid="daily-missions"]')).not.toBeNull();
    expect(buttons(c)).toContain('Nhận thưởng');
    expect(buttons(c).some((t) => t?.startsWith('Xem nhiệm vụ một lần'))).toBe(false);
  });

  it('tài khoản mới chưa đủ tuổi: báo chờ, không báo lỗi chung', async () => {
    mocks.get.mockResolvedValue(DAILY);
    mocks.post.mockRejectedValue({ status: 403, code: 'DAILY_TOO_NEW' });
    const c = await showWith();
    act(() => (c.querySelector('button[aria-label="Nhận thưởng: Xem một sản phẩm"]') as HTMLButtonElement).click());
    await flush();
    expect(Array.from(document.body.querySelectorAll('[role="alert"]')).map((n) => n.textContent)).toContain('Tài khoản mới tạo chưa nhận được thưởng nhiệm vụ, bạn quay lại sau nhé.');
  });

  it('Nhận: gửi mã thiết bị 32 hex và báo thưởng thật', async () => {
    mocks.get.mockResolvedValue(DAILY);
    mocks.post.mockResolvedValue({ id: 'DAILY_STORY', water: 5, points: 0, bonus: false, capped: [], totalSeeds: null });
    const c = await showWith();
    act(() => (c.querySelector('button[aria-label="Nhận thưởng: Xem một sản phẩm"]') as HTMLButtonElement).click());
    await flush();
    expect(mocks.post).toHaveBeenCalledWith('/game/daily/DAILY_STORY/claim', { deviceId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe('Đã nhận +5 💧');
  });
});
