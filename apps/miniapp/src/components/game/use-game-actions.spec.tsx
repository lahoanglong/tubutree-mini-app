import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../services/http';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import type * as GameApi from '../../services/game-api';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';

const mocks = vi.hoisted(() => ({
  answerQuiz: vi.fn(),
  openSnackbar: vi.fn(),
  collectDew: vi.fn(),
  unlockPlot: vi.fn(),
  repairStreak: vi.fn(),
  claimMission: vi.fn(),
  claimSeasonPass: vi.fn(),
  waterPlot: vi.fn(),
  waterTree: vi.fn(),
  checkIn: vi.fn(),
  buyStreakFreeze: vi.fn(),
  buyTree: vi.fn(),
  spin: vi.fn(),
}));
vi.mock('zmp-ui', () => ({ useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/game-api', async (orig) => ({
  ...(await orig<typeof GameApi>()),
  answerQuiz: mocks.answerQuiz,
  collectDew: mocks.collectDew,
  unlockPlot: mocks.unlockPlot,
  repairStreak: mocks.repairStreak,
  claimMission: mocks.claimMission,
  claimSeasonPass: mocks.claimSeasonPass,
  waterPlot: mocks.waterPlot,
  waterTree: mocks.waterTree,
  checkIn: mocks.checkIn,
  buyStreakFreeze: mocks.buyStreakFreeze,
  buyTree: mocks.buyTree,
  spin: mocks.spin,
}));

import { useGameActions } from './use-game-actions';

const serverError = (message: string) => new HttpError(message, undefined, { status: 400, data: { message } } as never);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useGameActions({ onHarvest: vi.fn(), onAnswered: vi.fn() }), { wrapper });
  return { invalidate, hook };
}

describe('useGameActions: trả lời câu đố', () => {
  it('máy chủ nói câu không thuộc bộ hôm nay: tải lại bộ câu và báo ngắn, không đọc lời máy chủ', async () => {
    mocks.answerQuiz.mockRejectedValue(serverError('Câu hỏi này không thuộc bộ câu hôm nay.'));
    const { invalidate, hook } = setup();
    await act(async () => hook.result.current.answerM.mutate({ id: 'q1', choice: 0 }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: gameMoreCopy.quiz.staleSet, type: 'warning' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['game', 'quiz'] });
  });

  it('lỗi khác: báo lời máy chủ, không tải lại bộ câu', async () => {
    mocks.openSnackbar.mockClear();
    mocks.answerQuiz.mockRejectedValue(serverError('Bạn đã trả lời câu này rồi.'));
    const { invalidate, hook } = setup();
    await act(async () => hook.result.current.answerM.mutate({ id: 'q1', choice: 0 }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.openSnackbar.mock.calls[0]?.[0].text).not.toBe(gameMoreCopy.quiz.staleSet);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['game', 'quiz'] });
  });
});

type Actions = ReturnType<typeof useGameActions>;

// Mỗi khoá là một truy vấn đang được xem (observer) nên invalidateQueries thật sự tải lại nó; bộ chuyển không có observer thì
// invalidateQueries xong ngay và không chứng minh được khoá có giữ tới khi dữ liệu về hay không.
const PROBES = {
  profile: ['game', 'profile'],
  missions: ['game', 'missions'],
  seasonPass: ['game', 'seasonPass'],
  me: ['me'],
  loyalty: ['loyalty'],
  quiz: ['game', 'quiz'],
  checkIn: ['loyalty-checkin'],
} as const;
type Probe = keyof typeof PROBES;

/** Lần tải đầu của mọi khoá xong ngay; lần tải lại của `held` treo tới khi `release()` (hoặc mãi mãi nếu không ai gọi). */
function setupHeld(held: Probe) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const fetched: Record<Probe, number> = { profile: 0, missions: 0, seasonPass: 0, me: 0, loyalty: 0, quiz: 0, checkIn: 0 };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(
    () => {
      const useProbe = (name: Probe) =>
        useQuery({
          queryKey: PROBES[name],
          queryFn: async () => {
            fetched[name] += 1;
            if (name === held && fetched[name] > 1) await gate;
            return fetched[name];
          },
        });
      useProbe('profile');
      useProbe('missions');
      useProbe('seasonPass');
      useProbe('me');
      useProbe('loyalty');
      useProbe('quiz');
      useProbe('checkIn');
      return useGameActions({ onHarvest: vi.fn(), onAnswered: vi.fn() });
    },
    { wrapper },
  );
  return { hook, fetched, release: () => release() };
}

const ONE_SHOT: {
  name: string;
  api: ReturnType<typeof vi.fn>;
  result: unknown;
  tap: (a: Actions) => void;
  pending: (a: Actions) => boolean;
  held: Probe[];
}[] = [
  { name: 'hứng sương', api: mocks.collectDew, result: { seedsEarned: 5, totalSeeds: 10 }, tap: (a) => a.dewM.mutate(), pending: (a) => a.dewM.isPending, held: ['profile', 'me', 'loyalty'] },
  { name: 'mở lô đất', api: mocks.unlockPlot, result: { unlocked: true }, tap: (a) => a.unlockM.mutate(1), pending: (a) => a.unlockM.isPending, held: ['profile', 'me', 'loyalty'] },
  { name: 'hồi sinh chuỗi', api: mocks.repairStreak, result: { repaired: true }, tap: (a) => a.repairM.mutate(), pending: (a) => a.repairM.isPending, held: ['profile'] },
  { name: 'nhận thưởng bậc Chặng Mùa', api: mocks.claimSeasonPass, result: { claimed: true, reward: { type: 'SEEDS', amount: 5 } }, tap: (a) => a.claimPassM.mutate({ tier: 1, track: 'free' }), pending: (a) => a.claimPassM.isPending, held: ['seasonPass', 'profile', 'loyalty'] },
  { name: 'nhận thưởng nhiệm vụ', api: mocks.claimMission, result: { claimed: true, rewardPoints: 5, couponCode: null }, tap: (a) => a.claimMissionM.mutate('NEW_USER'), pending: (a) => a.claimMissionM.isPending, held: ['missions', 'me', 'loyalty'] },
];
const HOLD_CASES = ONE_SHOT.flatMap((c) => c.held.map((h) => [c.name, h, c] as const));

const settleTicks = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });

describe('useGameActions: việc một-lần giữ khoá tới khi dữ liệu mới về', () => {
  beforeEach(() => {
    for (const c of ONE_SHOT) c.api.mockReset();
  });

  it.each(HOLD_CASES)('%s: chạm lại khi %s chưa tải xong bị bỏ qua; về rồi thì nhả và gọi được lần hai', async (_name, held, c) => {
    c.api.mockResolvedValue(c.result);
    const { hook, fetched, release } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(c.pending(hook.result.current)).toBe(true);
    act(() => c.tap(hook.result.current));
    await settleTicks();
    expect(c.api).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
  });
});

describe('useGameActions: dữ liệu làm mới treo mãi thì nhả khoá sau LOCK_REFRESH_WAIT_MS, không sớm hơn', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(ONE_SHOT.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    c.api.mockReset();
    c.api.mockResolvedValue(c.result);
    const held = c.held[0]!;
    const { hook, fetched } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    vi.useFakeTimers();
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetched[held]).toBe(2);
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1); });
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(c.pending(hook.result.current)).toBe(false);
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(c.api).toHaveBeenCalledTimes(2);
  });
});

const httpError = (status: number) => new HttpError('Máy chủ từ chối', undefined, { status, data: { message: 'Máy chủ từ chối' } } as never);

const REJECTABLE = [
  ...ONE_SHOT,
  { name: 'tưới lô phụ', api: mocks.waterPlot, tap: (a: Actions) => a.waterPlotM.mutate('plot-1'), pending: (a: Actions) => a.waterPlotM.isPending, held: ['profile', 'me', 'loyalty'] as Probe[] },
];
// 400 kiểm mọi khoá cần tải lại (bỏ ['me'] hay ['loyalty'] khỏi nhánh lỗi thì ca tương ứng đỏ); 404/409 chỉ cần chứng minh cùng nhánh.
const REJECT_STALE = REJECTABLE.flatMap((c) => [
  ...c.held.map((h) => [c.name, 400, h, c] as const),
  ...[404, 409].map((status) => [c.name, status, c.held[0]!, c] as const),
]);
const REJECT_TEMPORARY = REJECTABLE.flatMap((c) => [401, 500, 502].map((status) => [c.name, status, c] as const));

describe('useGameActions: máy chủ từ chối việc một-lần (400/404/409) thì tải lại rồi mới nhả khoá', () => {
  beforeEach(() => {
    for (const c of REJECTABLE) c.api.mockReset();
    mocks.openSnackbar.mockClear();
  });

  it.each(REJECT_STALE)('%s bị từ chối %i: tải lại %s, giữ khoá tới khi về, báo lỗi một lần', async (_name, status, held, c) => {
    c.api.mockRejectedValue(httpError(status));
    const { hook, fetched, release } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(c.pending(hook.result.current)).toBe(true);
    act(() => c.tap(hook.result.current));
    await settleTicks();
    expect(c.api).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar.mock.calls[0]?.[0].type).toBe('error');
    await act(async () => release());
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
  });

  it.each(REJECT_TEMPORARY)('%s gặp %i (lỗi tạm): chỉ báo lỗi, không tải lại, nhả khoá ngay', async (_name, status, c) => {
    c.api.mockRejectedValue(httpError(status));
    const { hook, fetched } = setupHeld(c.held[0]!);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    await settleTicks();
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
  });

  it('mất mạng (không có phản hồi): chỉ báo lỗi, không tải lại, nhả khoá ngay', async () => {
    mocks.claimSeasonPass.mockRejectedValue(new HttpError('Network Error', 'ERR_NETWORK'));
    const { hook, fetched } = setupHeld('seasonPass');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => hook.result.current.claimPassM.mutate({ tier: 1, track: 'free' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.claimPassM.isPending).toBe(false));
    await settleTicks();
    expect(fetched.seasonPass).toBe(1);
  });
});

describe('useGameActions: bị từ chối mà dữ liệu tải lại treo mãi thì nhả khoá sau LOCK_REFRESH_WAIT_MS, không sớm hơn', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(REJECTABLE.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    c.api.mockReset();
    c.api.mockRejectedValue(httpError(400));
    const held = c.held[0]!;
    const { hook, fetched } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    vi.useFakeTimers();
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetched[held]).toBe(2);
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1); });
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(c.pending(hook.result.current)).toBe(false);
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(c.api).toHaveBeenCalledTimes(2);
  });
});

describe('useGameActions: bị từ chối, các trường hợp biên của khoá', () => {
  beforeEach(() => {
    mocks.waterPlot.mockReset();
    mocks.waterTree.mockReset();
    mocks.claimSeasonPass.mockReset();
    mocks.openSnackbar.mockClear();
  });

  const WATERED = { progress: 1, target: 100, harvested: false, treesPlanted: 0, reward: {} };

  it('quá hạn (ECONNABORTED) đi qua nhánh từ chối: tải lại không chờ, nhả khoá ngay, chạm lại gọi được', async () => {
    mocks.claimSeasonPass.mockRejectedValue(new HttpError('timeout', 'ECONNABORTED'));
    const { hook, fetched } = setupHeld('seasonPass');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => hook.result.current.claimPassM.mutate({ tier: 1, track: 'free' }));
    await waitFor(() => expect(fetched.seasonPass).toBe(2));
    await waitFor(() => expect(hook.result.current.claimPassM.isPending).toBe(false));
    act(() => hook.result.current.claimPassM.mutate({ tier: 1, track: 'free' }));
    await waitFor(() => expect(mocks.claimSeasonPass).toHaveBeenCalledTimes(2));
  });

  it('lô A bị từ chối đang giữ khoá tải lại: tưới lô B vẫn gọi được ngay (khoá theo lô)', async () => {
    mocks.waterPlot.mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce(WATERED);
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => hook.result.current.waterPlotM.mutate('plot-1'));
    await waitFor(() => expect(fetched.profile).toBe(2));
    act(() => hook.result.current.waterPlotM.mutate('plot-2'));
    await waitFor(() => expect(mocks.waterPlot).toHaveBeenCalledTimes(2));
    expect(mocks.waterPlot).toHaveBeenNthCalledWith(2, 'plot-2', 20);
  });

  it('tưới lô phụ thành công không giữ khoá chờ dữ liệu: nhả ngay dù tải lại còn treo', async () => {
    mocks.waterPlot.mockResolvedValue(WATERED);
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => hook.result.current.waterPlotM.mutate('plot-1'));
    await waitFor(() => expect(fetched.profile).toBe(2));
    await waitFor(() => expect(hook.result.current.waterPlotM.isPending).toBe(false));
  });

  it('nút Thu hoạch (tưới 0💧) bị từ chối 400: tải lại hồ sơ và giữ khoá tới khi về, để thẻ cũ không bấm lại mãi', async () => {
    mocks.waterTree.mockRejectedValue(httpError(400));
    const { hook, fetched, release } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => hook.result.current.waterM.mutate(0));
    await waitFor(() => expect(fetched.profile).toBe(2));
    await settleTicks();
    expect(hook.result.current.waterM.isPending).toBe(true);
    act(() => hook.result.current.waterM.mutate(0));
    await settleTicks();
    expect(mocks.waterTree).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(hook.result.current.waterM.isPending).toBe(false));
  });

  it('tưới thường (20💧) gặp 500 (lỗi tạm): chỉ báo lỗi, không tải lại, nhả khoá ngay', async () => {
    mocks.waterTree.mockRejectedValue(httpError(500));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => hook.result.current.waterM.mutate(20));
    await waitFor(() => expect(hook.result.current.waterM.isPending).toBe(false));
    await settleTicks();
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
  });
});

const quizStaleError = (status: number) =>
  new HttpError('Câu hỏi này không thuộc bộ câu hôm nay.', undefined, { status, data: { message: 'Câu hỏi này không thuộc bộ câu hôm nay.' } } as never);

interface W111aCase {
  name: string;
  api: ReturnType<typeof vi.fn>;
  tap: (a: Actions) => void;
  pending: (a: Actions) => boolean;
  /** Khoá nào bị tải lại khi máy chủ từ chối; ca đầu của danh sách là khoá được giữ treo ở các ca còn lại. */
  held: Probe[];
  stale: (status: number) => HttpError;
}
const W111A: W111aCase[] = [
  { name: 'điểm danh (checkInM)', api: mocks.checkIn, tap: (a) => a.checkInM.mutate(), pending: (a) => a.checkInM.isPending, held: ['profile', 'me', 'loyalty', 'checkIn'], stale: httpError },
  { name: 'mua vé giữ lửa (freezeM)', api: mocks.buyStreakFreeze, tap: (a) => a.freezeM.mutate(), pending: (a) => a.freezeM.isPending, held: ['profile', 'me', 'loyalty'], stale: httpError },
  { name: 'tưới thường 20💧 (waterM)', api: mocks.waterTree, tap: (a) => a.waterM.mutate(20), pending: (a) => a.waterM.isPending, held: ['profile', 'me', 'loyalty'], stale: httpError },
  { name: 'trả lời câu đố ngoài bộ (answerM)', api: mocks.answerQuiz, tap: (a) => a.answerM.mutate({ id: 'q1', choice: 0 }), pending: (a) => a.answerM.isPending, held: ['quiz'], stale: quizStaleError },
];
const W111A_STALE = W111A.flatMap((c) => [
  ...c.held.map((h) => [c.name, 400, h, c] as const),
  ...[404, 409].map((status) => [c.name, status, c.held[0]!, c] as const),
]);
const W111A_TEMPORARY = W111A.flatMap((c) => [401, 500, 502].map((status) => [c.name, status, c] as const));

describe('(W111A) lệnh ghi bị từ chối 400/404/409 giữ khoá tới khi dữ liệu mới về', () => {
  beforeEach(() => {
    for (const c of W111A) c.api.mockReset();
    mocks.openSnackbar.mockClear();
  });

  it.each(W111A_STALE)('%s bị từ chối %i: tải lại %s, giữ khoá tới khi về (chạm lại bị bỏ qua), báo một lần, rồi nhả', async (_name, status, held, c) => {
    c.api.mockRejectedValue(c.stale(status));
    const { hook, fetched, release } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(c.pending(hook.result.current)).toBe(true);
    act(() => c.tap(hook.result.current));
    await settleTicks();
    expect(c.api).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
  });

  it.each(W111A_TEMPORARY)('%s gặp %i (lỗi tạm): chỉ báo lỗi, không tải lại, nhả khoá ngay', async (_name, status, c) => {
    c.api.mockRejectedValue(httpError(status));
    const { hook, fetched } = setupHeld(c.held[0]!);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    await settleTicks();
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
  });

  it.each(W111A.map((c) => [c.name, c] as const))('%s mất mạng: chỉ báo lỗi, không tải lại, nhả khoá ngay', async (_name, c) => {
    c.api.mockRejectedValue(new HttpError('Network Error', 'ERR_NETWORK'));
    const { hook, fetched } = setupHeld(c.held[0]!);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    await settleTicks();
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
  });

  it.each(W111A.map((c) => [c.name, c] as const))('%s quá hạn (ECONNABORTED): tải lại không chờ, nhả khoá ngay dù tải lại còn treo', async (_name, c) => {
    c.api.mockRejectedValue(new HttpError('timeout', 'ECONNABORTED'));
    const held = c.held[0]!;
    const { hook, fetched } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(fetched[held]).toBe(2));
    await waitFor(() => expect(c.pending(hook.result.current)).toBe(false));
    act(() => c.tap(hook.result.current));
    await waitFor(() => expect(c.api).toHaveBeenCalledTimes(2));
  });
});

describe('(W111A) dữ liệu tải lại treo mãi thì nhả khoá sau LOCK_REFRESH_WAIT_MS, không sớm hơn', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(W111A.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    c.api.mockReset();
    c.api.mockRejectedValue(c.stale(400));
    const held = c.held[0]!;
    const { hook, fetched } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    vi.useFakeTimers();
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetched[held]).toBe(2);
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1); });
    expect(c.pending(hook.result.current)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(c.pending(hook.result.current)).toBe(false);
    act(() => c.tap(hook.result.current));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(c.api).toHaveBeenCalledTimes(2);
  });
});

/** Một lượt góp qua `mutateAsync` như TreeFund gọi: `settled` chỉ bật khi Promise xong, tức lúc khoá ref `inFlight` ở TreeFund nhả. */
function startBuy(hook: { result: { current: Actions } }) {
  const outcome = { settled: false, ok: undefined as boolean | undefined };
  act(() => {
    void hook.result.current.buyTreeM.mutateAsync('key-12345678').then(
      () => Object.assign(outcome, { settled: true, ok: true }),
      () => Object.assign(outcome, { settled: true, ok: false }),
    );
  });
  return outcome;
}

describe('(W111A) góp quỹ trồng cây (buyTreeM, mutateAsync): Promise chỉ xong khi dữ liệu mới về', () => {
  const BUY_HELD: Probe[] = ['profile', 'me', 'loyalty'];
  const BUY_STALE = [
    ...BUY_HELD.map((h) => [400, h] as const),
    ...[404, 409].map((status) => [status, 'profile' as Probe] as const),
  ];
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    mocks.buyTree.mockReset();
    mocks.openSnackbar.mockClear();
  });

  it.each(BUY_STALE)('bị từ chối %i: tải lại %s, mutateAsync chưa xong và isPending còn true tới khi về, báo một lần', async (status, held) => {
    mocks.buyTree.mockRejectedValue(httpError(status));
    const { hook, fetched, release } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startBuy(hook);
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(outcome.settled).toBe(false);
    expect(hook.result.current.buyTreeM.isPending).toBe(true);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, ok: false }));
    await waitFor(() => expect(hook.result.current.buyTreeM.isPending).toBe(false));
  });

  it.each([401, 500, 502])('gặp %i (lỗi tạm): mutateAsync reject ngay, không tải lại', async (status) => {
    mocks.buyTree.mockRejectedValue(httpError(status));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startBuy(hook);
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, ok: false }));
    await settleTicks();
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
  });

  it('mất mạng: mutateAsync reject ngay, không tải lại', async () => {
    mocks.buyTree.mockRejectedValue(new HttpError('Network Error', 'ERR_NETWORK'));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startBuy(hook);
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, ok: false }));
    await settleTicks();
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
  });

  it('quá hạn (ECONNABORTED): tải lại không chờ, mutateAsync reject ngay dù tải lại còn treo', async () => {
    mocks.buyTree.mockRejectedValue(new HttpError('timeout', 'ECONNABORTED'));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startBuy(hook);
    await waitFor(() => expect(fetched.profile).toBe(2));
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, ok: false }));
  });

  it('tải lại treo mãi: mutateAsync reject sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    mocks.buyTree.mockRejectedValue(httpError(400));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    vi.useFakeTimers();
    const outcome = startBuy(hook);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetched.profile).toBe(2);
    expect(outcome.settled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1); });
    expect(outcome.settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(outcome).toMatchObject({ settled: true, ok: false });
  });
});

/** Một lượt quay như WheelOfFortune gọi: `settled` chỉ bật khi Promise xong, tức lúc khoá `lockRef` ở bánh xe nhả. */
function startSpin(hook: { result: { current: Actions } }) {
  const outcome = { settled: false, rejected: false, value: undefined as unknown };
  act(() => {
    void hook.result.current.handleSpin().then(
      (value) => Object.assign(outcome, { settled: true, value }),
      () => Object.assign(outcome, { settled: true, rejected: true }),
    );
  });
  return outcome;
}

describe('(W118A) vòng quay (handleSpin): lỗi thì tải lại điểm và lượt quay, bánh xe chỉ nhả khoá khi dữ liệu mới về', () => {
  const SPIN_STALE = [
    ...(['profile', 'me', 'loyalty'] as Probe[]).map((h) => [400, h] as const),
    ...[404, 409].map((status) => [status, 'profile' as Probe] as const),
  ];
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    mocks.spin.mockReset();
    mocks.openSnackbar.mockClear();
  });

  it.each(SPIN_STALE)('bị từ chối %i: tải lại %s, handleSpin chưa xong tới khi về, báo một lần rồi mới ném lỗi', async (status, held) => {
    mocks.spin.mockRejectedValue(httpError(status));
    const { hook, fetched, release } = setupHeld(held);
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startSpin(hook);
    await waitFor(() => expect(fetched[held]).toBe(2));
    await settleTicks();
    expect(outcome.settled).toBe(false);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar.mock.calls[0]?.[0].type).toBe('error');
    await act(async () => release());
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, rejected: true }));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });

  it.each([401, 500, 502])('gặp %i (lỗi tạm): báo lỗi và ném ngay, không tải lại', async (status) => {
    mocks.spin.mockRejectedValue(httpError(status));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startSpin(hook);
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, rejected: true }));
    await settleTicks();
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
  });

  it('mất mạng (không có phản hồi): báo lỗi và ném ngay, không tải lại như các việc khác', async () => {
    mocks.spin.mockRejectedValue(new HttpError('Network Error', 'ERR_NETWORK'));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startSpin(hook);
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, rejected: true }));
    await settleTicks();
    expect(Object.values(fetched).every((n) => n === 1)).toBe(true);
  });

  it('quá hạn (ECONNABORTED): tải lại không chờ, ném ngay dù tải lại còn treo', async () => {
    mocks.spin.mockRejectedValue(new HttpError('timeout', 'ECONNABORTED'));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startSpin(hook);
    await waitFor(() => expect(fetched.profile).toBe(2));
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, rejected: true }));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });

  it('tải lại treo mãi: ném sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    mocks.spin.mockRejectedValue(httpError(400));
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    vi.useFakeTimers();
    const outcome = startSpin(hook);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetched.profile).toBe(2);
    expect(outcome.settled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1); });
    expect(outcome.settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(outcome).toMatchObject({ settled: true, rejected: true });
  });

  it('quay thành công: trả đúng kết quả của máy chủ và tải lại điểm không chờ', async () => {
    const result = { prize: { id: 'p1', name: 'Thưởng 50 Điểm Xanh', rewardType: 'POINTS', value: 50 } };
    mocks.spin.mockResolvedValue(result);
    const { hook, fetched } = setupHeld('profile');
    await waitFor(() => expect(Object.values(fetched).every((n) => n === 1)).toBe(true));
    const outcome = startSpin(hook);
    await waitFor(() => expect(outcome).toMatchObject({ settled: true, rejected: false, value: result }));
    await waitFor(() => expect(fetched.loyalty).toBe(2));
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});
