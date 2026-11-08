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

  it('text rỗng hoặc chỉ khoảng trắng: không dựng dải (không có khung nút trống 56px)', () => {
    for (const text of ['', '   ', '\n\t']) {
      const m = mount(<QuestStrip {...props} text={text} onOpen={() => undefined} />);
      expect(m.container.innerHTML, JSON.stringify(text)).toBe('');
      expect(document.querySelector('button')).toBeNull();
      m.unmount();
    }
  });

  it('spoken rỗng, khoảng trắng hoặc thiếu: không đặt aria-label, nút lấy tên từ chữ nhìn thấy', () => {
    for (const spoken of ['', '   ', undefined]) {
      const m = mount(<QuestStrip text={props.text} spoken={spoken} hasReward onOpen={() => undefined} />);
      expect(btn().hasAttribute('aria-label'), JSON.stringify(spoken)).toBe(false);
      expect(btn().textContent).toContain(props.text);
      m.unmount();
    }
  });

  it('spoken có khoảng trắng thừa hai đầu: aria-label đã cắt', () => {
    mount(<QuestStrip {...props} spoken={`  ${props.spoken}  `} onOpen={() => undefined} />);
    expect(btn().getAttribute('aria-label')).toBe(props.spoken);
  });

  it('busy: nút disabled, aria-busy="true", bấm không gọi onOpen', () => {
    const onOpen = vi.fn();
    mount(<QuestStrip {...props} busy onOpen={onOpen} />);
    expect(btn().disabled).toBe(true);
    expect(btn().getAttribute('aria-busy')).toBe('true');
    click(btn());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('disabled: khoá nút nhưng không báo aria-busy; bình thường thì bấm được và không aria-busy', () => {
    const onOpen = vi.fn();
    const a = mount(<QuestStrip {...props} disabled onOpen={onOpen} />);
    expect(btn().disabled).toBe(true);
    expect(btn().hasAttribute('aria-busy')).toBe(false);
    click(btn());
    expect(onOpen).not.toHaveBeenCalled();
    a.unmount();
    mount(<QuestStrip {...props} busy={false} disabled={false} onOpen={onOpen} />);
    expect(btn().disabled).toBe(false);
    expect(btn().hasAttribute('aria-busy')).toBe(false);
    click(btn());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('khoá thì con trỏ not-allowed và mờ 0.6; bình thường thì pointer và rõ hẳn', () => {
    const a = mount(<QuestStrip {...props} busy onOpen={() => undefined} />);
    expect(btn().style.cursor).toBe('not-allowed');
    expect(btn().style.opacity).toBe('0.6');
    a.unmount();
    mount(<QuestStrip {...props} onOpen={() => undefined} />);
    expect(btn().style.cursor).toBe('pointer');
    expect(btn().style.opacity).toBe('1');
  });
});
