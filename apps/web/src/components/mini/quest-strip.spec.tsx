// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { QuestStrip } from './quest-strip';

const props = { text: '2 phần thưởng đang chờ · 3.000 điểm', spoken: '2 phần thưởng đang chờ, 3.000 điểm. Mở Hành trình gian hàng.', hasReward: true };
const btn = () => document.querySelector<HTMLButtonElement>('button')!;

describe('QuestStrip (web)', () => {
  it('một nút cao ít nhất 56, tên truy cập là chữ đọc, hiện chữ ngắn', () => {
    mount(<QuestStrip {...props} onOpen={() => undefined} />);
    expect(btn().getAttribute('aria-label')).toBe(props.spoken);
    expect(parseFloat(btn().style.minHeight)).toBeGreaterThanOrEqual(56);
    expect(btn().textContent).toContain(props.text);
  });

  it('bấm gọi onOpen; có thưởng chờ đổi tông nhấn', () => {
    const onOpen = vi.fn();
    mount(<QuestStrip {...props} onOpen={onOpen} />);
    click(btn());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(btn().dataset.reward).toBe('true');
  });
});
