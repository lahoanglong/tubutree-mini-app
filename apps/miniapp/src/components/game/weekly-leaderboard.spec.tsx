import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderRow } from '../../services/game-api';
import { WeeklyLeaderboard } from './weekly-leaderboard';

/** BE đánh hạng theo vị trí (rank = i + 1) nên mọi số người chơi từ 1 trở lên đều là dữ liệu thật hợp lệ. */
const boardOf = (n: number): LeaderRow[] =>
  Array.from({ length: n }, (_, i) => ({ rank: i + 1, nickname: `Bạn ${i + 1}`, streak: 10 - i, treesPlanted: 9 - i }));

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

const keyWarnings = () => errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])));

describe('WeeklyLeaderboard — khoá React', () => {
  it.each([1, 2, 3, 4, 7])('%i người chơi: không có cảnh báo trùng key', (n) => {
    render(<WeeklyLeaderboard board={boardOf(n)} />);
    expect(keyWarnings()).toEqual([]);
  });

  it('chỉ có 2 người: bục vẫn xếp thứ 2 - nhất, ô thứ 3 để trống', () => {
    const { container } = render(<WeeklyLeaderboard board={boardOf(2)} />);
    const first = screen.getByText('Bạn 1');
    const second = screen.getByText('Bạn 2');
    expect(second.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain('🥇');
    expect(container.textContent).toContain('🥈');
    expect(container.textContent).not.toContain('🥉');
  });
});
