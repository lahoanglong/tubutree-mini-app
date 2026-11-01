import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestStrip } from './quest-strip';

const props = { text: '2 phần thưởng đang chờ · 3.000 điểm', spoken: '2 phần thưởng đang chờ, 3.000 điểm. Mở Hành trình gian hàng.', hasReward: true };

describe('QuestStrip', () => {
  it('một nút cao ít nhất 56, tên truy cập là chữ đọc, hiện chữ ngắn', () => {
    render(<QuestStrip {...props} onOpen={() => undefined} />);
    const btn = screen.getByRole('button', { name: props.spoken });
    expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(56);
    expect(btn).toHaveTextContent(props.text);
  });

  it('bấm gọi onOpen; dải không phải nút chính (không có nút primary của ZaUI)', () => {
    const onOpen = vi.fn();
    const { container } = render(<QuestStrip {...props} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.zaui-btn-primary')).toBeNull();
  });

  it('có thưởng chờ đổi tông nhấn, không có thì giữ tông thường', () => {
    const { rerender } = render(<QuestStrip {...props} onOpen={() => undefined} />);
    const tone = () => screen.getByRole('button').getAttribute('data-reward');
    expect(tone()).toBe('true');
    rerender(<QuestStrip {...props} hasReward={false} onOpen={() => undefined} />);
    expect(tone()).toBe('false');
  });
});
