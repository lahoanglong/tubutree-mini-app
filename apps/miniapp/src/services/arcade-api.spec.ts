import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./core-http', () => ({ coreHttp: http }));

import { arcadeStatusQuery, startArcadeRun, submitArcadeRun } from './arcade-api';

beforeEach(() => vi.clearAllMocks());

describe('arcade-api', () => {
  it('xin mã ván: POST /game/arcade-start với đúng gameId và trả nguyên mã máy chủ cấp', async () => {
    const started = { runId: 'r1.dew_catcher.1.x.sig', startedAt: '2026-11-15T01:00:00.000Z', expiresAt: '2026-11-15T01:10:00.000Z' };
    http.post.mockResolvedValue(started);
    await expect(startArcadeRun('dew_catcher')).resolves.toEqual(started);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith('/game/arcade-start', { gameId: 'dew_catcher' });
  });

  it('gửi đúng bốn trường của một ván (kèm runId) tới /game/arcade-complete', async () => {
    http.post.mockResolvedValue({ rewarded: true });
    await submitArcadeRun({ gameId: 'dew_catcher', score: 420, durationMs: 39_000, runId: 'r1.dew_catcher.1.x.sig' });
    expect(http.post).toHaveBeenCalledWith('/game/arcade-complete', { gameId: 'dew_catcher', score: 420, durationMs: 39_000, runId: 'r1.dew_catcher.1.x.sig' });
  });

  it('không mang theo trường lạ của kết quả mountArcade', async () => {
    http.post.mockResolvedValue({});
    await submitArcadeRun({ gameId: 'refill_rush', score: 200, durationMs: 45_000, runId: 'r1.refill_rush.2.y.sig', stats: { correct: 9 } } as never);
    expect(Object.keys(http.post.mock.calls[0]![1] as object).sort()).toEqual(['durationMs', 'gameId', 'runId', 'score']);
  });

  it('khoá trạng thái nằm dưới tiền tố game và đọc /game/arcade/status', async () => {
    http.get.mockResolvedValue({ games: {} });
    expect(arcadeStatusQuery.queryKey).toEqual(['game', 'arcade']);
    await arcadeStatusQuery.queryFn();
    expect(http.get).toHaveBeenCalledWith('/game/arcade/status');
  });
});
