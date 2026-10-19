// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { RankBadge, levelEmoji, levelName } from './rank';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = (level: number) => {
  const r = render(<RankBadge level={level} />);
  mounted.push(r);
  return r;
};

describe('levelEmoji / levelName', () => {
  it.each([
    [1, '🌱', 'Mầm'],
    [2, '🌿', 'Cây non'],
    [3, '🌳', 'Cây trưởng thành'],
    [4, '🏆', 'Cổ thụ'],
  ])('hạng %i → %s %s', (level, emoji, name) => {
    expect(levelEmoji(level)).toBe(emoji);
    expect(levelName(level)).toBe(name);
  });

  it('hạng ngoài 1..4 rơi về Mầm', () => {
    expect(levelEmoji(0)).toBe('🌱');
    expect(levelEmoji(9)).toBe('🌱');
    expect(levelName(0)).toBe('Mầm');
    expect(levelName(9)).toBe('Mầm');
  });
});

describe('RankBadge', () => {
  it.each([0, 1, -3])('hạng %i (Mầm trở xuống): không hiện gì', (level) => {
    expect(mount(level).container.innerHTML).toBe('');
  });

  it.each([
    [2, '🌿 Cây non'],
    [3, '🌳 Cây trưởng thành'],
    [4, '🏆 Cổ thụ'],
  ])('hạng %i: hiện emoji và tên hạng trên cùng một dòng chữ', (level, text) => {
    expect(mount(level).container.textContent).toBe(text);
  });
});
