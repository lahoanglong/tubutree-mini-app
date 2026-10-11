import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RankBadge, levelEmoji, levelName } from './rank-badge';
import { vi } from '../../i18n/vi';

/**
 * Đặc tả badge hạng cộng đồng (C-076, PC-10a). Emoji hạng là NỘI DUNG nên giữ qua đợt di cư DS v2;
 * hạng 1 (Mầm) ẩn để đỡ rối cạnh tên tác giả.
 */
describe('levelEmoji / levelName', () => {
  it.each([
    [1, '🌱', vi.community.level1],
    [2, '🌿', vi.community.level2],
    [3, '🌳', vi.community.level3],
    [4, '🏆', vi.community.level4],
  ])('hạng %i → %s %s', (level, emoji, name) => {
    expect(levelEmoji(level)).toBe(emoji);
    expect(levelName(level)).toBe(name);
  });

  it('hạng ngoài 1..4 rơi về Mầm', () => {
    expect(levelEmoji(0)).toBe('🌱');
    expect(levelEmoji(9)).toBe('🌱');
    expect(levelName(0)).toBe(vi.community.level1);
    expect(levelName(9)).toBe(vi.community.level1);
  });
});

describe('RankBadge', () => {
  it.each([0, 1, -3])('hạng %i (Mầm trở xuống): không hiện gì', (level) => {
    const { container } = render(<RankBadge level={level} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [2, '🌿', 'Cây non'],
    [3, '🌳', 'Cây trưởng thành'],
    [4, '🏆', 'Cổ thụ'],
  ])('hạng %i: hiện emoji và tên hạng trên cùng một dòng chữ', (level, emoji, name) => {
    render(<RankBadge level={level} />);
    expect(screen.getByText(`${emoji} ${name}`)).toBeInTheDocument();
  });
});
