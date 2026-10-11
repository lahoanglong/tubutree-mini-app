import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderRow, SeasonLeaderRow } from '../../services/game-api';
import { SeasonLeaderboard } from './season-leaderboard';
import { WeeklyLeaderboard } from './weekly-leaderboard';

/**
 * Hình dữ liệu thật của API (apps/api game.service.ts / game-season.service.ts): `rank = i + 1` nên hạng luôn duy nhất,
 * nhưng nickname, số giọt nước, chuỗi ngày và số cây có thể trùng nhau giữa nhiều người chơi. Khoá React không được
 * dựa vào các giá trị trùng được đó.
 */
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());
const keyWarnings = () => errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])));

describe('bảng xếp hạng — người chơi trùng nickname và trùng chỉ số', () => {
  it.each([1, 2, 3, 5, 25])('mùa: %i người cùng nickname, cùng số giọt nước → không cảnh báo key', (n) => {
    const rows: SeasonLeaderRow[] = Array.from({ length: n }, (_, i) => ({ rank: i + 1, nickname: 'Cây Xanh', drops: 100 }));
    const { container } = render(<SeasonLeaderboard rows={rows} />);
    expect(keyWarnings()).toEqual([]);
    expect(container.textContent?.match(/Cây Xanh/g)).toHaveLength(n);
  });

  it.each([2, 3, 4, 7, 25])('tuần: %i người cùng nickname, cùng chuỗi ngày, cùng số cây → không cảnh báo key', (n) => {
    const board: LeaderRow[] = Array.from({ length: n }, (_, i) => ({ rank: i + 1, nickname: 'Cây Xanh', streak: 5, treesPlanted: 3 }));
    const { container } = render(<WeeklyLeaderboard board={board} />);
    expect(keyWarnings()).toEqual([]);
    expect(container.textContent?.match(/Cây Xanh/g)).toHaveLength(n);
  });
});
