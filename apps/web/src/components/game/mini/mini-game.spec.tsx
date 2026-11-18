// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiniSortBin, MiniSortItem, MiniTodayResponse } from '@tubutree/shared-types';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { gameWebCopy } from '@tubutree/app-core/game-mini/web-copy';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn(), post: vi.fn(), phase: 'authenticated' as 'authenticated' | 'guest' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/vuon-xanh/choi/sort' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ waste: { enabled: false } }) }));

import MiniSort from './mini-sort';
import MiniRoundShell from './mini-round-shell';
import { PlayTodayCard } from './play-today-card';

function today(over: Partial<MiniTodayResponse> = {}): MiniTodayResponse {
  return {
    dayKey: '2026-11-17',
    games: [
      { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 1, rewardedRoundsLeft: 0, playedToday: 1 },
    ],
    rewardEligible: true,
    noRewardReason: null,
    caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
    dailyQuizDoneToday: true,
    ...over,
  };
}

const ITEMS: MiniSortItem[] = [
  { id: 'a', label: 'Chai nhựa', emoji: null },
  { id: 'b', label: 'Vỏ chuối', emoji: null },
  { id: 'c', label: 'Lon nhôm', emoji: null },
];

let mounted: Rendered | null = null;
const q = (id: string) => mounted!.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const buttonByText = (text: string) => [...mounted!.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.get.mockReset();
  mocks.post.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('PlayTodayCard (web)', () => {
  it('mỗi game có giao diện là một liên kết tới /vuon-xanh/choi/<game>, ghi lượt thưởng thật', () => {
    mounted = render(<PlayTodayCard today={today()} />);
    expect(q('mini-play-row-sort')?.getAttribute('href')).toBe('/vuon-xanh/choi/sort');
    expect(q('mini-play-row-daily_quiz')?.getAttribute('href')).toBe('/vuon-xanh/choi/daily_quiz');
    expect(q('mini-play-status-sort')?.textContent).toBe(gameCopy('row.left', { n: 2 }));
    expect(q('mini-play-status-daily_quiz')?.textContent).toBe(gameCopy('row.full'));
  });
});

describe('MiniSort (web)', () => {
  const setup = () => {
    const onFinish = vi.fn();
    mounted = render(<MiniSort content={{ bins: ['recycle', 'food', 'other'] as MiniSortBin[], items: ITEMS }} onFinish={onFinish} onStatus={() => {}} />);
    return onFinish;
  };

  it('chạm thẻ rồi chạm thùng là bỏ được món, không cần kéo', () => {
    vi.useFakeTimers();
    setup();
    click(q('mini-sort-card'));
    expect(q('mini-sort-card')?.getAttribute('aria-pressed')).toBe('true');
    click(q('mini-sort-bin-food'));
    expect(q('mini-sort-card')?.textContent).toContain('Vỏ chuối');
  });

  it('chạm đúp một thùng chỉ bỏ một món; bỏ hết thì nộp đúng một lần', () => {
    vi.useFakeTimers();
    const onFinish = setup();
    click(q('mini-sort-bin-recycle'));
    click(q('mini-sort-bin-recycle'));
    expect(q('mini-sort-card')?.textContent).toContain('Vỏ chuối');
    for (const bin of ['food', 'other']) {
      act(() => void vi.advanceTimersByTime(350));
      click(q(`mini-sort-bin-${bin}`));
    }
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['recycle', 'food', 'other']);
  });
});

describe('MiniRoundShell (web)', () => {
  it('hết lượt thưởng: nhãn "không tính thưởng" hiện trước khi bấm Bắt đầu; có cột Cách chơi', async () => {
    mocks.get.mockResolvedValue(today());
    mounted = render(<MiniRoundShell game="daily_quiz" />);
    await waitFor(() => expect(q('mini-no-reward')?.textContent).toBe(gameCopy('intro.noReward')));
    expect(mounted.container.textContent).toContain(gameCopy('reason.NO_REWARDED_ROUNDS_LEFT'));
    expect(mounted.container.querySelector('.tubu-mg-aside')?.textContent).toContain(gameWebCopy('aside.how'));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('cờ tắt (404): báo game tạm nghỉ, không có nút Bắt đầu', async () => {
    mocks.get.mockRejectedValue({ status: 404, code: 'GAME_DISABLED' });
    mounted = render(<MiniRoundShell game="sort" />);
    await waitFor(() => expect(q('mini-disabled')).not.toBeNull());
    expect(buttonByText(gameCopy('intro.start'))).toBeNull();
  });

  it('bấm Bắt đầu hai lần liền chỉ xin một ván', async () => {
    mocks.get.mockResolvedValue(today());
    mocks.post.mockReturnValue(new Promise(() => {}));
    mounted = render(<MiniRoundShell game="sort" />);
    await waitFor(() => expect(buttonByText(gameCopy('intro.start'))?.hasAttribute('disabled')).toBe(false));
    const start = buttonByText(gameCopy('intro.start'));
    click(start);
    click(start);
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/game/mini/sort/start', {});
  });
});
