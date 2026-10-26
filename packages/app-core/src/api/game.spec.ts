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
  ])('%s', async (_n, run, expected) => {
    const { http, calls } = fakeHttp();
    await run(http);
    expect(calls).toEqual([expected]);
  });
});
