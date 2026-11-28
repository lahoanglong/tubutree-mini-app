// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conveyorDecode, type MiniConveyorItem, type MiniTodayResponse } from '@tubutree/shared-types';
import { CONVEYOR_LEAD_MS, CONVEYOR_ROUND_MS } from '@tubutree/app-core/game-mini/conveyor';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn() } }));

import MiniEcoMerge from './mini-eco-merge';
import MiniGreenConveyor from './mini-green-conveyor';
import { PlayTodayCard } from './play-today-card';

const BINS = ['recycle', 'organic', 'refill'] as const;
const items: MiniConveyorItem[] = Array.from({ length: 24 }, (_, i) => ({ id: `m-${i}`, label: `Món ${i}`, art: 'can', bin: BINS[i % 3]!, golden: false }));
const q = (r: Rendered, id: string) => r.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })));

let r: Rendered | null = null;
beforeEach(() => {
  localStorage.clear();
  mocks.get.mockResolvedValue({ enabled: false });
});
afterEach(() => {
  r?.unmount();
  r = null;
  vi.useRealTimers();
});

describe('MiniEcoMerge (web)', () => {
  it('phím mũi tên dồn bàn trên máy tính; ô đặt theo data-cell', () => {
    r = render(<MiniEcoMerge content={{ seed: 7, size: 4, goal: 256, maxMoves: 2000 }} onFinish={vi.fn()} onStatus={vi.fn()} />);
    expect(r.container.querySelectorAll('[data-testid="eco-merge-tile"]')).toHaveLength(2);
    for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) key(k);
    expect(Number(q(r, 'eco-merge-grid')!.getAttribute('data-moves'))).toBeGreaterThan(0);
    for (const t of r.container.querySelectorAll('[data-testid="eco-merge-tile"]')) expect(t.getAttribute('data-cell')).toMatch(/^\d{1,2}$/);
  });

  it('phím gõ trong ô tìm ở đầu trang hay đang ghép chữ bằng bộ gõ không dồn bàn, chữ vẫn vào ô', () => {
    r = render(
      <>
        <input data-testid="site-search" />
        <MiniEcoMerge content={{ seed: 7, size: 4, goal: 256, maxMoves: 2000 }} onFinish={vi.fn()} onStatus={vi.fn()} />
      </>,
    );
    const input = q(r, 'site-search')!;
    act(() => {
      for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'a', 's', 'd', 'w']) {
        expect(input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))).toBe(true);
      }
      for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) window.dispatchEvent(new KeyboardEvent('keydown', { key: k, isComposing: true }));
    });
    expect(q(r, 'eco-merge-grid')!.getAttribute('data-moves')).toBe('0');
    for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) key(k);
    expect(Number(q(r, 'eco-merge-grid')!.getAttribute('data-moves'))).toBeGreaterThan(0);
  });
});

describe('MiniGreenConveyor (web)', () => {
  it('chạm thùng đúng cộng điểm; hết giờ nộp đủ 24 ký tự', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const onFinish = vi.fn();
    r = render(<MiniGreenConveyor content={{ seed: 1, bins: [...BINS], items }} onFinish={onFinish} onStatus={vi.fn()} />);
    act(() => void vi.advanceTimersByTime(CONVEYOR_LEAD_MS + 100));
    click(q(r, 'conveyor-bin-recycle'));
    expect(q(r, 'conveyor-score')!.textContent).toBe('1');
    act(() => void vi.advanceTimersByTime(CONVEYOR_ROUND_MS));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(conveyorDecode((onFinish.mock.calls[0]![0] as string[])[0], 24)?.[0]).toBe('recycle');
  });
});

describe('PlayTodayCard (web)', () => {
  it('lưới thẻ: hai game mới có nhãn "Mới" và liên kết tới màn chơi web, Đố Xanh đứng đầu', async () => {
    const today: MiniTodayResponse = {
      dayKey: '2026-11-28',
      games: [
        { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
        { game: 'eco_merge', items: 8, timeLimitMs: 180_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
        { game: 'green_conveyor', items: 24, timeLimitMs: 30_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
        { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 1, rewardedRoundsLeft: 1, playedToday: 0 },
      ],
      rewardEligible: true,
      noRewardReason: null,
      caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
      dailyQuizDoneToday: false,
    };
    r = render(<PlayTodayCard today={today} />);
    await flush();
    const cards = [...r.container.querySelectorAll('.tubu-mg-gcard')];
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['mini-play-row-daily_quiz', 'mini-play-row-eco_merge', 'mini-play-row-green_conveyor', 'mini-play-row-sort']);
    expect(q(r, 'mini-play-row-eco_merge')!.getAttribute('href')).toBe('/vuon-xanh/choi/eco_merge');
    expect(q(r, 'mini-play-row-green_conveyor')!.getAttribute('href')).toBe('/vuon-xanh/choi/green_conveyor');
    const badges = cards.map((c) => c.querySelector('.tubu-mg-gcard-badge')?.textContent ?? null);
    expect(badges).toEqual([null, gameCopy('card.new'), gameCopy('card.new'), null]);
    expect(q(r, 'mini-play-row-eco_merge')!.querySelector('svg')).not.toBeNull();
  });
});
