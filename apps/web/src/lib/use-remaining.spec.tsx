// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { formatRemaining, useRemaining } from './use-remaining';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('formatRemaining: thời gian còn lại đọc được bằng tiếng Việt', () => {
  it.each([
    [2 * HOUR + 15 * MIN, 'Còn 2 giờ 15 phút'],
    [3 * HOUR, 'Còn 3 giờ'],
    [45 * MIN, 'Còn 45 phút'],
    [MIN, 'Còn 1 phút'],
    [59_000, 'Còn dưới 1 phút'],
    [26 * HOUR + 10 * MIN, 'Còn 1 ngày 2 giờ'],
    [48 * HOUR, 'Còn 2 ngày'],
  ])('%i ms → "%s"', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });

  it('hết hạn (0, âm) → "Đã quá hạn"', () => {
    expect(formatRemaining(0)).toBe('Đã quá hạn');
    expect(formatRemaining(-5_000)).toBe('Đã quá hạn');
  });
});

function Probe({ at }: { at: string | null | undefined }) {
  const r = useRemaining(at);
  return <p data-expired={String(r.expired)}>{r.text}</p>;
}

let mounted: Rendered[] = [];
const mount = (at: string | null | undefined) => {
  const r = render(<Probe at={at} />);
  mounted.push(r);
  return r.container.querySelector('p')!;
};

describe('useRemaining', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') }));
  afterEach(() => {
    mounted.forEach((m) => m.unmount());
    mounted = [];
    vi.useRealTimers();
  });

  it('không có hạn hoặc hạn không đọc được → chữ rỗng, chưa coi là quá hạn', () => {
    for (const at of [null, undefined, 'không phải ngày']) {
      const p = mount(at);
      expect(p.textContent).toBe('');
      expect(p.dataset.expired).toBe('false');
    }
  });

  it('còn hạn: trả chữ còn lại và tự giảm theo thời gian', () => {
    const p = mount('2026-10-17T12:30:00Z');
    expect(p.textContent).toBe('Còn 2 giờ 30 phút');
    act(() => {
      vi.advanceTimersByTime(31 * MIN);
    });
    expect(p.textContent).toBe('Còn 1 giờ 59 phút');
  });

  it('chạm hạn thì chuyển sang quá hạn mà không cần tải lại', () => {
    const p = mount('2026-10-17T10:01:00Z');
    expect(p.dataset.expired).toBe('false');
    act(() => {
      vi.advanceTimersByTime(2 * MIN);
    });
    expect(p.dataset.expired).toBe('true');
    expect(p.textContent).toBe('Đã quá hạn');
  });
});
