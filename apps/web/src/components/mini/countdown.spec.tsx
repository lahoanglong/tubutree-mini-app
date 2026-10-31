// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Countdown } from './countdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const timer = () => document.querySelector<HTMLElement>('[role="timer"]')!;
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

// Cần rerender trên cùng một cây (harness.ts bọc thêm QueryClientProvider nên đổi props sẽ dựng lại từ đầu).
let roots: { root: Root; el: HTMLElement }[] = [];
function mountPlain(ui: ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  act(() => root.render(ui));
  return {
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  roots.forEach(({ root, el }) => {
    try { act(() => root.unmount()); } catch { /* đã gỡ trong test */ }
    el.remove();
  });
  roots = [];
  vi.useRealTimers();
});

describe('Countdown (web)', () => {
  it('render đầu (máy chủ, trước mount) không có chữ số: hydrate không lệch, vỏ ẩn và giữ chỗ', () => {
    const html = renderToString(<Countdown endAt={iso(7_533_000)} mode="clock" />);
    expect(html).toContain('role="timer"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(/\d/);
  });

  it('text: khung giữ chỗ có nhãn ẩn cùng kiểu chữ với nhãn thật, không chữ số, nên bề rộng không bắt đầu từ 0', () => {
    for (const kind of ['ends', 'starts'] as const) {
      const html = renderToString(<Countdown endAt={iso(7_533_000)} mode="text" kind={kind} />);
      const plain = html.replace(/<[^>]+>/g, '');
      expect(plain).toContain(kind === 'ends' ? 'Kết thúc sau' : 'Bắt đầu sau');
      expect(plain).not.toMatch(/\d/);
      expect(html).toContain('visibility:hidden');
      expect(html).toContain('font-size:var(--type-caption-size)');
    }
  });

  it('clock: ô số nhảy từng giây, aria-label chỉ đổi khi sang phút mới', () => {
    mountPlain(<Countdown endAt={iso(7_533_000)} mode="clock" />);
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

  it('chữ nhìn thấy không đọc to và không có vùng aria-live', () => {
    mountPlain(<Countdown endAt={iso(7_533_000)} mode="clock" />);
    const t = timer();
    expect(t.hasAttribute('aria-live')).toBe(false);
    expect(t.querySelector('[aria-live]')).toBeNull();
    for (const el of Array.from(t.children)) expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('text: chữ đổi theo phút, kind="starts" đổi tiền tố', () => {
    mountPlain(<Countdown endAt={iso(7_533_000)} mode="text" />);
    expect(timer().textContent).toBe('Kết thúc sau 2 giờ 05 phút');
    advance(10_000);
    expect(timer().textContent).toBe('Kết thúc sau 2 giờ 05 phút');
    advance(24_000);
    expect(timer().textContent).toBe('Kết thúc sau 2 giờ 04 phút');
    mountPlain(<Countdown endAt={iso(7_533_000)} mode="text" kind="starts" />);
    expect(document.querySelectorAll('[role="timer"]')[1]!.textContent).toBe('Bắt đầu sau 2 giờ 05 phút');
  });

  it('từ 24 giờ: chữ ngày đứng trước hai ô giờ:phút', () => {
    mountPlain(<Countdown endAt={iso(2 * 86_400_000 + 3 * 3_600_000 + 15 * 60_000)} mode="clock" />);
    expect(timer().textContent).toContain('2 ngày');
    expect(timer().textContent).toContain('03:15');
  });

  it('onEnd gọi đúng một lần, không gọi lại sau timer thêm hay đổi hàm onEnd; vỏ ẩn, không chữ số', () => {
    const onEnd = vi.fn();
    const other = vi.fn();
    const m = mountPlain(<Countdown endAt={iso(3000)} mode="clock" onEnd={onEnd} />);
    advance(2999);
    expect(onEnd).not.toHaveBeenCalled();
    advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(timer().getAttribute('aria-hidden')).toBe('true');
    expect(timer().textContent).toBe('');
    advance(10_000);
    m.rerender(<Countdown endAt={new Date(NOW + 3000).toISOString()} mode="clock" onEnd={other} />);
    advance(10_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('endAt đã qua hoặc rác lúc mount: không chữ, không NaN, onEnd gọi một lần', () => {
    const a = vi.fn();
    const b = vi.fn();
    mountPlain(<Countdown endAt={iso(-1000)} mode="text" onEnd={a} />);
    mountPlain(<Countdown endAt="không phải ngày" mode="clock" onEnd={b} />);
    for (const t of Array.from(document.querySelectorAll('[role="timer"]'))) {
      expect(t.textContent).toBe('');
      expect(t.textContent).not.toMatch(/NaN/);
    }
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('đổi endAt sang mốc mới còn hạn: hiện lại và onEnd của mốc mới gọi được một lần', () => {
    const onEnd = vi.fn();
    const m = mountPlain(<Countdown endAt={iso(3000)} mode="clock" onEnd={onEnd} />);
    advance(3000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    m.rerender(<Countdown endAt={iso(5000)} mode="clock" onEnd={onEnd} />);
    expect(timer().textContent).toBe('00:05');
    advance(5000);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('gỡ component thì không còn timer treo', () => {
    const m = mountPlain(<Countdown endAt={iso(60_000)} mode="clock" />);
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
