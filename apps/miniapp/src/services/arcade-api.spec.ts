import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./core-http', () => ({ coreHttp: http }));

import { arcadeStatusQuery, submitArcadeRun, submitHomeQuiz } from './arcade-api';

beforeEach(() => vi.clearAllMocks());

describe('arcade-api', () => {
  it('gửi đúng ba trường của một ván tới /game/arcade-complete', async () => {
    http.post.mockResolvedValue({ rewarded: true });
    await submitArcadeRun({ gameId: 'dew_catcher', score: 420, durationMs: 39_000 });
    expect(http.post).toHaveBeenCalledWith('/game/arcade-complete', { gameId: 'dew_catcher', score: 420, durationMs: 39_000 });
  });

  it('không mang theo trường lạ của kết quả mountArcade', async () => {
    http.post.mockResolvedValue({});
    await submitArcadeRun({ gameId: 'refill_rush', score: 200, durationMs: 45_000, stats: { correct: 9 } } as never);
    expect(Object.keys(http.post.mock.calls[0]![1] as object).sort()).toEqual(['durationMs', 'gameId', 'score']);
  });

  it('khoá trạng thái nằm dưới tiền tố game và đọc /game/arcade/status', async () => {
    http.get.mockResolvedValue({ games: {} });
    expect(arcadeStatusQuery.queryKey).toEqual(['game', 'arcade']);
    await arcadeStatusQuery.queryFn();
    expect(http.get).toHaveBeenCalledWith('/game/arcade/status');
  });

  it('quiz gửi đúng ba đáp án tới /game/home-quiz/complete', async () => {
    http.post.mockResolvedValue({ granted: 20, alreadyClaimed: false, totalSeeds: 20 });
    await submitHomeQuiz({ family: 'baby_pet', worry: 'grease', format: 'refill' });
    expect(http.post).toHaveBeenCalledWith('/game/home-quiz/complete', { family: 'baby_pet', worry: 'grease', format: 'refill' });
  });
});
