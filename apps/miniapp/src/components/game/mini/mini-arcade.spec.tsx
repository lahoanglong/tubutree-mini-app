import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conveyorDecode, type MiniConveyorItem } from '@tubutree/shared-types';
import { arcadeCopy } from '@tubutree/app-core/game-mini/arcade-copy';
import { ARCADE_SOUND_KEY } from '@tubutree/app-core/game-mini/arcade-sfx';
import { CONVEYOR_LEAD_MS, CONVEYOR_ROUND_MS } from '@tubutree/app-core/game-mini/conveyor';

const mocks = vi.hoisted(() => ({ vibrate: vi.fn(() => Promise.resolve()), season: null as string | null }));
vi.mock('zmp-sdk/apis', () => ({ vibrate: mocks.vibrate }));
vi.mock('../../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ seasonalTheme: mocks.season }) }));

import MiniEcoMerge from './mini-eco-merge';
import MiniGreenConveyor from './mini-green-conveyor';

const BINS = ['recycle', 'organic', 'refill'] as const;
const items: MiniConveyorItem[] = Array.from({ length: 24 }, (_, i) => ({
  id: `m-${i}`,
  label: `Món ${i}`,
  art: 'can',
  bin: BINS[i % 3]!,
  golden: i === 6,
}));

beforeEach(() => {
  localStorage.clear();
  mocks.vibrate.mockClear();
  mocks.season = null;
});
afterEach(() => vi.useRealTimers());

describe('áo Noel (theme.seasonal = christmas)', () => {
  it('2048: ô mang tên bậc Noel, bàn gắn data-season; tắt mùa thì về tên thường', async () => {
    mocks.season = 'christmas';
    const { unmount } = render(<MiniEcoMerge content={{ seed: 7, size: 4, goal: 256, maxMoves: 2000 }} onFinish={vi.fn()} onStatus={vi.fn()} />);
    expect(await screen.findByTestId('mini-eco-merge')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId('mini-eco-merge').getAttribute('data-season')).toBe('christmas'));
    const { xmasTierName } = await import('@tubutree/app-core/seasonal/xmas-arcade');
    const { mergeTierName } = await import('@tubutree/app-core/game-mini/eco-merge');
    const value = Number(screen.getAllByTestId('eco-merge-tile')[0]!.getAttribute('data-value'));
    expect(screen.getAllByText(xmasTierName(value)).length).toBeGreaterThan(0);
    unmount();
    mocks.season = null;
    render(<MiniEcoMerge content={{ seed: 7, size: 4, goal: 256, maxMoves: 2000 }} onFinish={vi.fn()} onStatus={vi.fn()} />);
    expect(screen.getByTestId('mini-eco-merge').hasAttribute('data-season')).toBe(false);
    expect(screen.getAllByText(mergeTierName(value)).length).toBeGreaterThan(0);
  });

  it('băng chuyền: bàn gắn data-season khi bật mùa, luật ván giữ nguyên', async () => {
    mocks.season = 'christmas';
    render(<MiniGreenConveyor content={{ seed: 1, bins: [...BINS], items }} onFinish={vi.fn()} onStatus={vi.fn()} />);
    await vi.waitFor(() => expect(screen.getByTestId('mini-green-conveyor').getAttribute('data-season')).toBe('christmas'));
  });
});

describe('MiniEcoMerge', () => {
  it('mở ván có 2 ô; phím mũi tên dồn bàn, tăng số nước, báo tiến độ theo bậc /8', () => {
    const onStatus = vi.fn();
    const onFinish = vi.fn();
    render(<MiniEcoMerge content={{ seed: 7, size: 4, goal: 256, maxMoves: 2000 }} onFinish={onFinish} onStatus={onStatus} />);
    const board = screen.getByTestId('eco-merge-grid');
    expect(screen.getAllByTestId('eco-merge-tile')).toHaveLength(2);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ total: 8 }));
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) fireEvent.keyDown(window, { key });
    expect(Number(board.getAttribute('data-moves'))).toBeGreaterThan(0);
    expect(onFinish).not.toHaveBeenCalled();
    for (const tile of screen.getAllByTestId('eco-merge-tile')) {
      expect(Number(tile.getAttribute('data-cell'))).toBeGreaterThanOrEqual(0);
      expect(Number(tile.getAttribute('data-cell'))).toBeLessThan(16);
    }
  });

  it('phím gõ trong ô nhập hay đang ghép chữ bằng bộ gõ không phải nước đi; phím thường vẫn dồn bàn', () => {
    render(
      <>
        <input aria-label="Tìm" />
        <MiniEcoMerge content={{ seed: 7, size: 4, goal: 256, maxMoves: 2000 }} onFinish={vi.fn()} onStatus={vi.fn()} />
      </>,
    );
    const board = screen.getByTestId('eco-merge-grid');
    const input = screen.getByLabelText('Tìm');
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'a', 's', 'd', 'w']) {
      expect(fireEvent.keyDown(input, { key })).toBe(true);
    }
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) fireEvent.keyDown(window, { key, isComposing: true });
    expect(board.getAttribute('data-moves')).toBe('0');
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) fireEvent.keyDown(window, { key });
    expect(Number(board.getAttribute('data-moves'))).toBeGreaterThan(0);
  });

  it('vuốt trên bàn (Pointer Events) cũng dồn bàn; chạm ngắn thì không', () => {
    render(<MiniEcoMerge content={{ seed: 11, size: 4, goal: 256, maxMoves: 2000 }} onFinish={vi.fn()} onStatus={vi.fn()} />);
    const board = screen.getByTestId('eco-merge-grid');
    fireEvent.pointerDown(board, { pointerId: 1, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(board, { pointerId: 1, clientX: 104, clientY: 102 });
    expect(board.getAttribute('data-moves')).toBe('0');
    const before = board.getAttribute('data-moves');
    for (const [dx, dy] of [[-80, 0], [0, 80], [80, 0], [0, -80]]) {
      fireEvent.pointerDown(board, { pointerId: 2, isPrimary: true, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(board, { pointerId: 2, clientX: 150 + dx!, clientY: 150 + dy! });
    }
    expect(board.getAttribute('data-moves')).not.toBe(before);
  });

  it('nút âm thanh: một chạm tắt, nhớ trên máy', () => {
    render(<MiniEcoMerge content={{ seed: 3, size: 4, goal: 256, maxMoves: 2000 }} onFinish={vi.fn()} onStatus={vi.fn()} />);
    const btn = screen.getByTestId('arcade-sound');
    expect(btn).toHaveAttribute('aria-label', arcadeCopy('sound.off'));
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-label', arcadeCopy('sound.on'));
    expect(localStorage.getItem(ARCADE_SOUND_KEY)).toBe('off');
  });
});

describe('MiniGreenConveyor', () => {
  it('món đầu ra băng; chạm đúng thùng cộng điểm, rung; hết 30 giây nộp đủ 24 ký tự', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const onFinish = vi.fn();
    const onStatus = vi.fn();
    render(<MiniGreenConveyor content={{ seed: 1, bins: [...BINS], items }} onFinish={onFinish} onStatus={onStatus} />);
    expect(screen.queryAllByTestId('conveyor-item')).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(CONVEYOR_LEAD_MS + 100);
    });
    const front = screen.getAllByTestId('conveyor-item').find((el) => el.getAttribute('data-front') === 'true')!;
    expect(front).toHaveAttribute('data-bin', 'recycle');
    fireEvent.click(screen.getByTestId('conveyor-bin-recycle'));
    expect(screen.getByTestId('conveyor-score')).toHaveTextContent('1');
    expect(mocks.vibrate).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('mini-green-conveyor').getAttribute('data-shake')).toMatch(/^[ab]$/);
    act(() => {
      vi.advanceTimersByTime(CONVEYOR_ROUND_MS);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
    const [answer] = onFinish.mock.calls[0]![0] as [string];
    const picks = conveyorDecode(answer, 24)!;
    expect(picks[0]).toBe('recycle');
    expect(picks[1]).toBe('refill');
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ total: 24, done: 24 }));
  });

  it('vuốt xuống trên băng bỏ món đầu vào Hữu cơ', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date'] });
    const onFinish = vi.fn();
    const shifted = items.map((it, i) => ({ ...it, bin: BINS[(i + 1) % 3]! }));
    render(<MiniGreenConveyor content={{ seed: 1, bins: [...BINS], items: shifted }} onFinish={onFinish} onStatus={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(CONVEYOR_LEAD_MS + 100);
    });
    const belt = screen.getByTestId('conveyor-belt');
    fireEvent.pointerDown(belt, { pointerId: 1, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(belt, { pointerId: 1, clientX: 102, clientY: 180 });
    expect(screen.getByTestId('conveyor-score')).toHaveTextContent('1');
    expect(screen.getByTestId('conveyor-combo')).toHaveAttribute('data-mult', '1');
  });
});

describe('mini-arcade.css', () => {
  const css = readFileSync(join(__dirname, 'mini-arcade.css'), 'utf8');

  it('Mini App và web dùng cùng một file CSS bàn chơi', () => {
    const web = readFileSync(join(__dirname, '../../../../../web/src/components/game/mini/mini-arcade.css'), 'utf8');
    expect(web).toBe(css);
  });

  it('nút âm thanh 44px, thùng ≥ 72px, chặn cuộn chỉ trên bàn ghép và băng chuyền, không mã màu, tôn trọng giảm chuyển động', () => {
    expect(css).toMatch(/\.tubu-ar-sound \{[^}]*width: 44px;[^}]*height: 44px/);
    expect(css).toMatch(/\.tubu-ar-bin \{[^}]*min-height: 72px/);
    expect(css).toMatch(/\.tubu-ar-grid \{[^}]*touch-action: none/);
    expect(css).toMatch(/\.tubu-ar-belt \{[^}]*touch-action: none/);
    expect(css.match(/touch-action: none/g)).toHaveLength(2);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/var\(--(stone|forest|honey|red|blue|amber)-\d/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    for (let cell = 1; cell < 16; cell++) expect(css).toContain(`.tubu-ar-tile[data-cell='${cell}']`);
  });
});
