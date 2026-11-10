// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { NetworkError } from '@/lib/client-api';

// W91B (Mini W93A): lệnh ghi của Vườn Xanh giữ khoá tới khi dữ liệu mới về nhưng chỉ tối đa 4 giây (`settleWithin`): làm mới treo thì nút
// không bận mãi, mạng chậm không giữ nút lâu hơn lệnh vừa thành công.

const api = vi.hoisted(() => ({
  checkIn: vi.fn(),
  collectDew: vi.fn(),
  buyStreakFreeze: vi.fn(),
  repairStreak: vi.fn(),
  giftWater: vi.fn(),
  waterTree: vi.fn(),
  buyTree: vi.fn(),
  unlockPlot: vi.fn(),
  waterPlot: vi.fn(),
  claimSeasonPass: vi.fn(),
  claimMission: vi.fn(),
  shareHarvest: vi.fn(),
}));
vi.mock('@tubutree/app-core/api/game', async (orig) => ({ ...(await orig<typeof import('@tubutree/app-core/api/game')>()), ...api }));

import { useGameActions } from './use-game-actions';

type Actions = ReturnType<typeof useGameActions>;
type Case = { name: string; mutation: (a: Actions) => { isPending: boolean; isSuccess: boolean }; fire: (a: Actions) => void; mock: ReturnType<typeof vi.fn>; result: unknown };

const WATERED = { harvested: false, progress: 1, target: 5 };
const CASES: Case[] = [
  { name: 'điểm danh', mutation: (a) => a.checkInM, fire: (a) => a.checkInM.mutate(), mock: api.checkIn, result: { pending: [] } },
  { name: 'hứng sương', mutation: (a) => a.dewM, fire: (a) => a.dewM.mutate(), mock: api.collectDew, result: { seedsEarned: 5 } },
  { name: 'mua vé giữ lửa', mutation: (a) => a.freezeM, fire: (a) => a.freezeM.mutate(), mock: api.buyStreakFreeze, result: { streakFreezes: 1 } },
  { name: 'hồi sinh chuỗi', mutation: (a) => a.repairM, fire: (a) => a.repairM.mutate(), mock: api.repairStreak, result: {} },
  { name: 'tặng nước', mutation: (a) => a.giftM, fire: (a) => a.giftM.mutate('u2'), mock: api.giftWater, result: { amount: 3 } },
  { name: 'tưới cây', mutation: (a) => a.waterM, fire: (a) => a.waterM.mutate(10), mock: api.waterTree, result: WATERED },
  { name: 'góp quỹ cây', mutation: (a) => a.buyTreeM, fire: (a) => a.buyTreeM.mutate('key-1'), mock: api.buyTree, result: { cost: 100, certificateCode: 'C1' } },
  { name: 'mở lô đất', mutation: (a) => a.unlockM, fire: (a) => a.unlockM.mutate(2), mock: api.unlockPlot, result: {} },
  { name: 'tưới lô', mutation: (a) => a.waterPlotM, fire: (a) => a.waterPlotM.mutate('p1'), mock: api.waterPlot, result: WATERED },
  { name: 'nhận bậc Chặng Mùa', mutation: (a) => a.claimPassM, fire: (a) => a.claimPassM.mutate({ tier: 1, track: 'free' }), mock: api.claimSeasonPass, result: {} },
  { name: 'nhận thưởng nhiệm vụ', mutation: (a) => a.claimMissionM, fire: (a) => a.claimMissionM.mutate('m1'), mock: api.claimMission, result: { rewardPoints: 10 } },
  { name: 'chia sẻ thu hoạch', mutation: (a) => a.shareHarvestM, fire: (a) => a.shareHarvestM.mutate(), mock: api.shareHarvest, result: { alreadyShared: false } },
];

function setup() {
  const hook = renderHook(() => useGameActions({ notify: vi.fn(), onHarvest: vi.fn(), onAnswered: vi.fn() }));
  // Làm mới không bao giờ về: mọi `invalidateQueries` treo.
  vi.spyOn(hook.client, 'invalidateQueries').mockImplementation(() => new Promise(() => undefined));
  return hook;
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  // shouldAdvanceTime để microtask và bộ đếm giờ của react-query vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('useGameActions: khoá giữ tới khi dữ liệu mới về có hạn 4 giây', () => {
  it.each(CASES)('$name: còn bận ở 3 giây, nhả sau 4 giây dù làm mới chưa về', async ({ mutation, fire, mock, result }) => {
    mock.mockResolvedValue(result);
    const hook = setup();
    await act(async () => fire(hook.result.current));
    await advance(100);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mutation(hook.result.current).isPending).toBe(true);
    await advance(2_900);
    expect(mutation(hook.result.current).isPending).toBe(true);
    await advance(1_500);
    expect(mutation(hook.result.current).isPending).toBe(false);
    expect(mutation(hook.result.current).isSuccess).toBe(true);
    hook.unmount();
  });

  it('hết thời gian chờ (máy chủ có thể đã ghi nhận): làm mới để khớp sổ, khoá nhả sau 4 giây dù làm mới chưa về', async () => {
    api.collectDew.mockRejectedValue(new NetworkError(true));
    const hook = setup();
    await act(async () => hook.result.current.dewM.mutate());
    await advance(100);
    expect(hook.client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['game'] });
    expect(hook.result.current.dewM.isPending).toBe(true);
    await advance(2_900);
    expect(hook.result.current.dewM.isPending).toBe(true);
    await advance(1_500);
    expect(hook.result.current.dewM.isPending).toBe(false);
    expect(hook.result.current.dewM.isError).toBe(true);
    hook.unmount();
  });
});
