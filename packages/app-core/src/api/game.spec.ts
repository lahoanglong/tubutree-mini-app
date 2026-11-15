import { describe, expect, it } from 'vitest';
import { fakeHttp, type RecordedCall } from './fake-http';
import * as g from './game';
import type { HttpClient } from '../http';

describe('game — đúng route, body, Idempotency-Key', () => {
  it.each<[string, (h: HttpClient) => unknown, Partial<RecordedCall>]>([
    ['getGameProfile', (h) => g.getGameProfile(h), { method: 'get', path: '/game/profile' }],
    ['checkIn', (h) => g.checkIn(h), { method: 'post', path: '/me/daily-check-in' }],
    ['collectDew', (h) => g.collectDew(h), { method: 'post', path: '/game/dew/collect' }],
    [
      'buyStreakFreeze',
      (h) => g.buyStreakFreeze(h),
      { method: 'post', path: '/game/streak-freeze/buy' },
    ],
    ['repairStreak', (h) => g.repairStreak(h), { method: 'post', path: '/game/streak/repair' }],
    ['spin', (h) => g.spin(h), { method: 'post', path: '/game/spin' }],
    ['getTodayQuiz', (h) => g.getTodayQuiz(h), { method: 'get', path: '/game/quiz/today' }],
    [
      'answerQuiz',
      (h) => g.answerQuiz(h, 'q1', 2),
      { method: 'post', path: '/game/quiz/q1/answer', body: { choice: 2 } },
    ],
    [
      'waterTree',
      (h) => g.waterTree(h, 5),
      { method: 'post', path: '/game/tree/water', body: { drops: 5 } },
    ],
    [
      'buyTree',
      (h) => g.buyTree(h, 'key-1'),
      { method: 'post', path: '/game/tree/buy', opts: { headers: { 'Idempotency-Key': 'key-1' } } },
    ],
    ['getLeaderboard', (h) => g.getLeaderboard(h), { method: 'get', path: '/game/leaderboard' }],
    ['getMissions', (h) => g.getMissions(h), { method: 'get', path: '/game/missions' }],
    [
      'claimMission',
      (h) => g.claimMission(h, 'M1'),
      { method: 'post', path: '/game/missions/M1/claim' },
    ],
    ['getForest', (h) => g.getForest(h), { method: 'get', path: '/game/forest' }],
    ['getCommunity', (h) => g.getCommunity(h), { method: 'get', path: '/game/community' }],
    ['getCollection', (h) => g.getCollection(h), { method: 'get', path: '/game/collection' }],
    ['getSeason', (h) => g.getSeason(h), { method: 'get', path: '/game/season' }],
    [
      'getSeasonLeaderboard',
      (h) => g.getSeasonLeaderboard(h),
      { method: 'get', path: '/game/season/leaderboard' },
    ],
    ['getGarden', (h) => g.getGarden(h), { method: 'get', path: '/game/garden' }],
    [
      'unlockPlot',
      (h) => g.unlockPlot(h),
      { method: 'post', path: '/game/garden/unlock', body: { currency: 'SEEDS' } },
    ],
    [
      'unlockPlot kèm slot ô khách định mở',
      (h) => g.unlockPlot(h, 4),
      { method: 'post', path: '/game/garden/unlock', body: { currency: 'SEEDS', slot: 4 } },
    ],
    [
      'waterPlot',
      (h) => g.waterPlot(h, 'pl1', 3),
      { method: 'post', path: '/game/garden/plot/pl1/water', body: { drops: 3 } },
    ],
    ['fetchSeasonPass', (h) => g.fetchSeasonPass(h), { method: 'get', path: '/game/season-pass' }],
    [
      'claimSeasonPass',
      (h) => g.claimSeasonPass(h, 4, 'premium'),
      { method: 'post', path: '/game/season-pass/claim', body: { tier: 4, track: 'premium' } },
    ],
    ['getFriends', (h) => g.getFriends(h), { method: 'get', path: '/game/friends' }],
    ['giftWater', (h) => g.giftWater(h, 'u2'), { method: 'post', path: '/game/gift/u2' }],
    [
      'completeArcade',
      (h) => g.completeArcade(h, { gameId: 'dew_catcher', score: 640, durationMs: 40_000 }),
      { method: 'post', path: '/game/arcade-complete', body: { gameId: 'dew_catcher', score: 640, durationMs: 40_000 } },
    ],
    ['getArcadeStatus', (h) => g.getArcadeStatus(h), { method: 'get', path: '/game/arcade/status' }],
    [
      'completeHomeQuiz',
      (h) => g.completeHomeQuiz(h, { family: 'baby_pet', worry: 'dry_skin', format: 'refill' }),
      { method: 'post', path: '/game/home-quiz/complete', body: { family: 'baby_pet', worry: 'dry_skin', format: 'refill' } },
    ],
  ])('%s', async (_n, run, expected) => {
    const { http, calls } = fakeHttp();
    await run(http);
    expect(calls).toEqual([expected]);
  });
});

describe('game arcade, chẩn đoán tổ ấm: chỉ gửi đúng trường của hợp đồng', () => {
  it('completeArcade bỏ trường thừa của ArcadeResult (stats, gameId lạ) và không có Idempotency-Key', async () => {
    const { http, calls } = fakeHttp();
    const result = {
      gameId: 'refill_rush' as const,
      score: 310,
      durationMs: 45_000,
      stats: { score: 310, correct: 31, wrong: 0, timedOut: 0, maxStreak: 31, feverCount: 5, durationMs: 45_000 },
    };
    await g.completeArcade(http, result);
    expect(calls).toEqual([{ method: 'post', path: '/game/arcade-complete', body: { gameId: 'refill_rush', score: 310, durationMs: 45_000 } }]);
    expect(Object.keys(calls[0]!.body as object).sort()).toEqual(['durationMs', 'gameId', 'score']);
    expect(calls[0]!.opts).toBeUndefined();
  });

  it('completeHomeQuiz bỏ trường thừa của đối tượng đáp án', async () => {
    const { http, calls } = fakeHttp();
    await g.completeHomeQuiz(http, { family: 'adult_only', worry: 'grease', format: 'bottle', extra: 'x' } as never);
    expect(Object.keys(calls[0]!.body as object).sort()).toEqual(['family', 'format', 'worry']);
  });

  it('ArcadeReason gồm LOW_SCORE (ván hợp lệ nhưng dưới ngưỡng thưởng)', () => {
    const reasons: g.ArcadeReason[] = ['DAILY_CAP', 'TOO_FAST', 'NOT_REAL_USER', 'DISABLED', 'LOW_SCORE'];
    expect(new Set(reasons).size).toBe(5);
  });

  it('trả nguyên phản hồi của máy chủ cho nơi gọi', async () => {
    const reply = { gameId: 'dew_catcher', score: 1, bestScore: 1, isNewBest: true, rewarded: true, reason: null, waterEarned: 5, pointsEarned: 1, totalSeeds: 50, used: 1, cap: 3, window: null, windowBonus: false };
    const { http } = fakeHttp(() => reply);
    await expect(g.completeArcade(http, { gameId: 'dew_catcher', score: 1, durationMs: 5_000 })).resolves.toBe(reply);
  });
});
