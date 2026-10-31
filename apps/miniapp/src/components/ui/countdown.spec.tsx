import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from './countdown';

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const timer = () => document.querySelector<HTMLElement>('[role="timer"]')!;
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Countdown', () => {
  it('clock: ô số nhảy từng giây, aria-label chỉ đổi khi sang phút mới', () => {
    render(<Countdown endAt={iso(7_533_000)} mode="clock" />);
    expect(timer().textContent).toBe('02:05:33');
    expect(timer().getAttribute('aria-label')).toBe('Kết thúc sau 2 giờ 5 phút');

    advance(1000);
    expect(timer().textContent).toBe('02:05:32');
    advance(9000);
    expect(timer().textContent).toBe('02:05:23');
    expect(timer().getAttribute('aria-label')).toBe('Kết thúc sau 2 giờ 5 phút');

    advance(24_000);
    expect(timer().getAttribute('aria-label')).toBe('Kết thúc sau 2 giờ 4 phút');
  });

  it('chữ nhìn thấy không đọc to và không có vùng aria-live (chỉ aria-label báo theo phút)', () => {
    render(<Countdown endAt={iso(7_533_000)} mode="clock" />);
    const t = timer();
    expect(t.querySelector('[aria-live]')).toBeNull();
    expect(t.hasAttribute('aria-live')).toBe(false);
    const visible = Array.from(t.children);
    expect(visible.length).toBeGreaterThan(0);
    for (const el of visible) expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('text: "Kết thúc sau 2 giờ 05 phút", không có ô số', () => {
    render(<Countdown endAt={iso(7_533_000)} mode="text" />);
    expect(timer().textContent).toBe('Kết thúc sau 2 giờ 05 phút');
    expect(timer().getAttribute('aria-label')).toBe('Kết thúc sau 2 giờ 5 phút');
    expect(timer().querySelector('[data-testid="countdown-cell"]')).toBeNull();
  });

  it('text: chữ đổi theo phút, không theo giây', () => {
    render(<Countdown endAt={iso(7_533_000)} mode="text" />);
    advance(10_000);
    expect(timer().textContent).toBe('Kết thúc sau 2 giờ 05 phút');
    advance(24_000);
    expect(timer().textContent).toBe('Kết thúc sau 2 giờ 04 phút');
  });

  it('kind="starts": "Bắt đầu sau …"', () => {
    render(<Countdown endAt={iso(7_533_000)} mode="text" kind="starts" />);
    expect(timer().textContent).toBe('Bắt đầu sau 2 giờ 05 phút');
    expect(timer().getAttribute('aria-label')).toBe('Bắt đầu sau 2 giờ 5 phút');
  });

  it('từ 24 giờ: chữ ngày đứng trước hai ô giờ:phút', () => {
    render(<Countdown endAt={iso(2 * 86_400_000 + 3 * 3_600_000 + 15 * 60_000)} mode="clock" />);
    expect(timer().textContent).toContain('2 ngày');
    expect(timer().textContent).toContain('03:15');
  });

  it('onEnd gọi đúng một lần khi tới giờ, không gọi lại sau timer thêm hay đổi hàm onEnd', () => {
    const onEnd = vi.fn();
    const other = vi.fn();
    const { rerender } = render(<Countdown endAt={iso(3000)} mode="clock" onEnd={onEnd} />);
    advance(2999);
    expect(onEnd).not.toHaveBeenCalled();
    advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    advance(10_000);
    rerender(<Countdown endAt={new Date(NOW + 3000).toISOString()} mode="clock" onEnd={other} />);
    advance(10_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('hết giờ: vỏ vẫn có trong cây nhưng ẩn, không còn chữ số (không hiện 00:00)', () => {
    render(<Countdown endAt={iso(1000)} mode="clock" />);
    advance(1000);
    expect(timer().getAttribute('aria-hidden')).toBe('true');
    expect(timer().textContent).toBe('');
    expect(timer().style.visibility).toBe('hidden');
  });

  it('endAt đã qua lúc mount: không chữ, onEnd gọi đúng một lần', () => {
    const onEnd = vi.fn();
    render(<Countdown endAt={iso(-1000)} mode="text" onEnd={onEnd} />);
    expect(timer().textContent).toBe('');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('endAt rác: không "NaN", không ném lỗi, coi như đã hết', () => {
    const onEnd = vi.fn();
    render(<Countdown endAt="không phải ngày" mode="clock" onEnd={onEnd} />);
    expect(timer().textContent).toBe('');
    expect(timer().textContent).not.toMatch(/NaN/);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('đổi endAt sang mốc mới còn hạn: hiện lại và onEnd của mốc mới vẫn gọi được một lần', () => {
    const onEnd = vi.fn();
    const { rerender } = render(<Countdown endAt={iso(3000)} mode="clock" onEnd={onEnd} />);
    advance(3000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    rerender(<Countdown endAt={iso(5000)} mode="clock" onEnd={onEnd} />);
    expect(timer().textContent).toBe('00:05');
    advance(5000);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('gỡ component thì không còn timer treo', () => {
    const { unmount } = render(<Countdown endAt={iso(60_000)} mode="clock" />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
