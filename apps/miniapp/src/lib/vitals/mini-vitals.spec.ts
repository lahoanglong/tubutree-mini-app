// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ trackEvent: (...a: unknown[]) => track(...a) }));

import { __resetMiniVitalsForTest, noteMiniRum, startMiniVitals } from './mini-vitals';

type Entry = { startTime?: number; value?: number; hadRecentInput?: boolean };
let observers: Record<string, (entries: Entry[]) => void> = {};

class FakeObserver {
  constructor(private cb: (l: { getEntries: () => Entry[] }) => void) {}
  observe({ type }: { type: string }) {
    observers[type] = (entries) => this.cb({ getEntries: () => entries });
  }
}

const SETTLE = 10_000;

function sentNames() {
  return track.mock.calls.map((c) => (c[2] as { name: string }).name);
}

beforeEach(() => {
  vi.useFakeTimers();
  track.mockClear();
  observers = {};
  __resetMiniVitalsForTest();
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  vi.spyOn(Math, 'random').mockReturnValue(0.004);
  window.history.replaceState(null, '', '/zapps/123456/product/sp-01');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function hide() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
}

function boot() {
  startMiniVitals();
  observers['largest-contentful-paint']?.([{ startTime: 1234.6 }]);
  observers['layout-shift']?.([{ value: 0.05 }, { value: 0.5, hadRecentInput: true }, { value: 0.03 }]);
}

describe('startMiniVitals', () => {
  it('cờ bật và trúng mẫu: gửi LCP, CLS, READY một lần sau khi màn đầu chốt, kèm route mẫu và nhóm khung nhìn', () => {
    boot();
    noteMiniRum({ enabled: true, samplePct: 1 });
    vi.advanceTimersByTime(SETTLE - 10);
    expect(track).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(track.mock.calls.every(([name, platform]) => name === 'mini_vital' && platform === 'miniapp')).toBe(true);
    const props = track.mock.calls.map((c) => c[2] as Record<string, unknown>);
    expect(props.map((p) => p.name).sort()).toEqual(['CLS', 'LCP', 'READY']);
    expect(props.find((p) => p.name === 'LCP')).toMatchObject({ value: 1235, rating: 'good', route: '/product/:slug', vp: 's' });
    expect(props.find((p) => p.name === 'CLS')).toMatchObject({ value: 0.08, rating: 'good' });
    expect(props.find((p) => p.name === 'READY')).toMatchObject({ rating: 'good', route: '/product/:slug' });
    hide();
    vi.advanceTimersByTime(SETTLE * 3);
    expect(track).toHaveBeenCalledTimes(3);
  });

  it('cờ tắt hoặc không trúng mẫu: không gửi gì', () => {
    boot();
    noteMiniRum({ enabled: false, samplePct: 100 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(track).not.toHaveBeenCalled();

    __resetMiniVitalsForTest();
    boot();
    noteMiniRum({ enabled: true, samplePct: 0.2 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(track).not.toHaveBeenCalled();
  });

  it('API cũ không có perfRum: không gửi', () => {
    boot();
    noteMiniRum({});
    vi.advanceTimersByTime(SETTLE * 2);
    expect(track).not.toHaveBeenCalled();
  });

  it('cấu hình về muộn: gửi ngay khi trang chủ báo cấu hình', () => {
    boot();
    vi.advanceTimersByTime(SETTLE * 2);
    expect(track).not.toHaveBeenCalled();
    noteMiniRum({ enabled: true, samplePct: 100 });
    expect(track).toHaveBeenCalledTimes(3);
  });

  it('trang bị ẩn trước 10 giây: gửi ngay số đã có', () => {
    boot();
    noteMiniRum({ enabled: true, samplePct: 100 });
    hide();
    expect(sentNames().sort()).toEqual(['CLS', 'LCP']);
  });

  it('WebView không có PerformanceObserver: vẫn gửi READY, không ném lỗi', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    expect(() => startMiniVitals()).not.toThrow();
    noteMiniRum({ enabled: true, samplePct: 100 });
    vi.advanceTimersByTime(SETTLE + 50);
    expect(sentNames()).toEqual(['READY']);
  });
});
