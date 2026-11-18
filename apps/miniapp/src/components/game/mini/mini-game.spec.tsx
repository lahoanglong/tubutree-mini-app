import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiniSortBin, MiniSortItem, MiniTodayResponse } from '@tubutree/shared-types';
import type { MiniBoardStatus } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading',
}));
vi.mock('../../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.navigate }));
vi.mock('../../ui/auth-gate', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ waste: { enabled: false } }) }));
vi.mock('../../../services/account-api', () => ({ getDailyCheckInStatus: () => Promise.resolve({ streakDays: 3 }) }));
vi.mock('../../../services/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

import MiniSort from './mini-sort';
import MiniRoundShell from './mini-round-shell';
import { PlayTodayCard } from './play-today-card';

function today(over: Partial<MiniTodayResponse> = {}): MiniTodayResponse {
  return {
    dayKey: '2026-11-17',
    games: [
      { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'match', items: 6, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 1, rewardedRoundsLeft: 0, playedToday: 1 },
    ],
    rewardEligible: true,
    noRewardReason: null,
    caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
    dailyQuizDoneToday: true,
    ...over,
  };
}

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

const ITEMS: MiniSortItem[] = [
  { id: 'a', label: 'Chai nhựa', emoji: null },
  { id: 'b', label: 'Vỏ chuối', emoji: null },
  { id: 'c', label: 'Lon nhôm', emoji: null },
];

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.navigate.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('PlayTodayCard', () => {
  it('mọi game máy chủ bật đều là dòng chơi ngay trong Mini App, theo thứ tự cố định, ghi lượt thưởng thật; không còn dòng "chơi trên tubutree.com"', () => {
    mocks.get.mockResolvedValue({ enabled: false });
    render(wrap(<PlayTodayCard today={today()} />));
    const rows = screen.getAllByRole('button').map((b) => b.getAttribute('data-testid'));
    expect(rows).toEqual(['mini-play-row-daily_quiz', 'mini-play-row-sort', 'mini-play-row-match']);
    expect(screen.queryByText(/tubutree\.com/)).toBeNull();
    expect(screen.getByTestId('mini-play-status-sort')).toHaveTextContent(gameCopy('row.left', { n: 2 }));
    expect(screen.getByTestId('mini-play-status-daily_quiz')).toHaveTextContent(gameCopy('row.full'));
    fireEvent.click(screen.getByTestId('mini-play-row-match'));
    expect(mocks.navigate).toHaveBeenCalledWith('/game/play/match');
  });

  it('Chọn Chuẩn Xanh: cờ bật thì thêm dòng cuối mở màn chơi trong Mini App (kèm from), cờ tắt thì không có dòng', async () => {
    mocks.get.mockImplementation((path: string) => Promise.resolve(path === '/game/matcher/status' ? { enabled: true } : undefined));
    render(wrap(<PlayTodayCard today={today()} />));
    const row = await screen.findByTestId('mini-play-row-matcher');
    expect(row.tagName).toBe('BUTTON');
    expect(screen.getAllByRole('button').at(-1)).toBe(row);
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith('/game/matcher?from=play_today');
  });

  it('Chọn Chuẩn Xanh: cờ tắt thì không có dòng', async () => {
    mocks.get.mockResolvedValue({ enabled: false });
    render(wrap(<PlayTodayCard today={today()} />));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/game/matcher/status'));
    // Đợi câu trả lời {enabled:false} về và được vẽ, không chỉ lúc lệnh vừa gửi.
    await act(async () => {
      await mocks.get.mock.results[0]!.value;
    });
    expect(screen.queryByTestId('mini-play-row-matcher')).toBeNull();
  });
});

describe('MiniSort', () => {
  function setup() {
    const onFinish = vi.fn();
    const status: MiniBoardStatus[] = [];
    render(<MiniSort content={{ bins: ['recycle', 'food', 'other'] as MiniSortBin[], items: ITEMS }} onFinish={onFinish} onStatus={(s) => status.push(s)} />);
    const card = () => screen.getByTestId('mini-sort-card');
    return { onFinish, card };
  }

  it('chạm thẻ rồi chạm thùng là bỏ được món, không cần kéo', () => {
    vi.useFakeTimers();
    const { card } = setup();
    fireEvent.click(card());
    expect(card()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('mini-sort-bin-food'));
    expect(card()).toHaveTextContent('Vỏ chuối');
    expect(card()).toHaveAttribute('aria-pressed', 'false');
  });

  it('chạm đúp một thùng chỉ bỏ một món', () => {
    vi.useFakeTimers();
    const { card } = setup();
    const bin = screen.getByTestId('mini-sort-bin-recycle');
    fireEvent.click(bin);
    fireEvent.click(bin);
    expect(card()).toHaveTextContent('Vỏ chuối');
    act(() => void vi.advanceTimersByTime(350));
    fireEvent.click(screen.getByTestId('mini-sort-bin-recycle'));
    expect(card()).toHaveTextContent('Lon nhôm');
  });

  it('bỏ hết món thì nộp đúng một lần với đáp án theo thứ tự', () => {
    vi.useFakeTimers();
    const { onFinish } = setup();
    for (const bin of ['recycle', 'food', 'other']) {
      fireEvent.click(screen.getByTestId(`mini-sort-bin-${bin}`));
      act(() => void vi.advanceTimersByTime(350));
    }
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['recycle', 'food', 'other']);
  });

  it('hết 45 giây thì nộp phần đã làm, món chưa làm là null', () => {
    vi.useFakeTimers();
    const { onFinish } = setup();
    fireEvent.click(screen.getByTestId('mini-sort-bin-recycle'));
    act(() => void vi.advanceTimersByTime(46_000));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(['recycle', null, null]);
  });
});

describe('MiniRoundShell', () => {
  it('hết lượt thưởng: nhãn "không tính thưởng" và lý do hiện trước khi bấm Bắt đầu', async () => {
    mocks.get.mockResolvedValue(today());
    render(wrap(<MiniRoundShell game="daily_quiz" />));
    expect(await screen.findByTestId('mini-no-reward')).toHaveTextContent(gameCopy('intro.noReward'));
    expect(screen.getByText(gameCopy('reason.NO_REWARDED_ROUNDS_LEFT'))).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('cờ tắt (404): báo game tạm nghỉ, không có nút Bắt đầu', async () => {
    mocks.get.mockRejectedValue({ response: { status: 404, data: { code: 'GAME_DISABLED' } } });
    render(wrap(<MiniRoundShell game="sort" />));
    expect(await screen.findByTestId('mini-disabled')).toHaveTextContent(gameCopy('error.disabled'));
    expect(screen.queryByRole('button', { name: gameCopy('intro.start') })).toBeNull();
  });

  it('bấm Bắt đầu hai lần liền chỉ xin một ván', async () => {
    mocks.get.mockResolvedValue(today());
    mocks.post.mockReturnValue(new Promise(() => {}));
    render(wrap(<MiniRoundShell game="sort" />));
    const start = await screen.findByRole('button', { name: gameCopy('intro.start') });
    await waitFor(() => expect(start).not.toBeDisabled());
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith('/game/mini/sort/start', {});
  });

  it.each(['match', 'origin', 'basket', 'kitchen_swap'] as const)('%s chơi ngay trong Mini App: màn mở đầu có luật chơi, Bắt đầu xin ván của chính game đó', async (game) => {
    mocks.get.mockResolvedValue(today({ games: [{ game, items: 3, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 }] }));
    mocks.post.mockReturnValue(new Promise(() => {}));
    render(wrap(<MiniRoundShell game={game} />));
    expect(await screen.findByTestId('mini-intro')).toHaveTextContent(gameCopy(`game.${game}.rules`));
    const start = screen.getByRole('button', { name: gameCopy('intro.start') });
    await waitFor(() => expect(start).not.toBeDisabled());
    fireEvent.click(start);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(`/game/mini/${game}/start`, {}));
  });
});

describe('mini-game.css', () => {
  it('Mini App và web dùng cùng một file CSS game mini', () => {
    const mini = readFileSync(join(__dirname, 'mini-game.css'), 'utf8');
    const web = readFileSync(join(__dirname, '../../../../../web/src/components/game/mini/mini-game.css'), 'utf8');
    expect(web).toBe(mini);
  });

  it('thùng ≥ 96×72px, đáp án ≥ 48px, thẻ kéo chặn cuộn chỉ trên chính nó, tôn trọng giảm chuyển động', () => {
    const css = readFileSync(join(__dirname, 'mini-game.css'), 'utf8');
    expect(css).toMatch(/\.tubu-mg-bins \{[^}]*minmax\(96px, 1fr\)/);
    expect(css).toMatch(/\.tubu-mg-bin \{[^}]*min-height: 72px/);
    expect(css).toMatch(/\.tubu-mg-option \{[^}]*min-height: 52px/);
    expect(css).toMatch(/\.tubu-mg-card \{[^}]*touch-action: none/);
    expect(css.match(/touch-action: none/g)).toHaveLength(1);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
