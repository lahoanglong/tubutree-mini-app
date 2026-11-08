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

  it.each([[''], ['   '], ['\n\t']])('text %j: không dựng dải (không có khung nút trống 56px)', (text) => {
    const { container } = render(<QuestStrip {...props} text={text} onOpen={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([[''], ['   '], [undefined]])('spoken %j: không đặt aria-label, nút lấy tên từ chữ nhìn thấy', (spoken) => {
    render(<QuestStrip text={props.text} spoken={spoken} hasReward onOpen={() => undefined} />);
    const btn = screen.getByRole('button', { name: props.text });
    expect(btn.hasAttribute('aria-label')).toBe(false);
  });

  it('spoken có khoảng trắng thừa hai đầu: aria-label đã cắt', () => {
    render(<QuestStrip {...props} spoken={`  ${props.spoken}  `} onOpen={() => undefined} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', props.spoken);
  });

  it('busy: nút disabled, aria-busy="true", bấm không gọi onOpen', () => {
    const onOpen = vi.fn();
    render(<QuestStrip {...props} busy onOpen={onOpen} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('disabled: khoá nút nhưng không báo aria-busy; bình thường thì bấm được và không aria-busy', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<QuestStrip {...props} disabled onOpen={onOpen} />);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).not.toHaveBeenCalled();
    rerender(<QuestStrip {...props} busy={false} disabled={false} onOpen={onOpen} />);
    expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('khoá thì con trỏ not-allowed và mờ 0.6; bình thường thì pointer và rõ hẳn', () => {
    const { rerender } = render(<QuestStrip {...props} busy onOpen={() => undefined} />);
    expect(screen.getByRole('button').style.cursor).toBe('not-allowed');
    expect(screen.getByRole('button').style.opacity).toBe('0.6');
    rerender(<QuestStrip {...props} onOpen={() => undefined} />);
    expect(screen.getByRole('button').style.cursor).toBe('pointer');
    expect(screen.getByRole('button').style.opacity).toBe('1');
  });
});
