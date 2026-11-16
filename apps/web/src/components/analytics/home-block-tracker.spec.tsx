// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ trackOncePerSession: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackOncePerSession: m.trackOncePerSession }));

import { HOME_BLOCK_DWELL_MS, HomeBlockTracker } from './home-block-tracker';

/** IntersectionObserver giả: test tự báo khối nào đang lộ bao nhiêu. */
class FakeIO {
  static all: FakeIO[] = [];
  targets = new Set<Element>();
  constructor(private cb: IntersectionObserverCallback) {
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
}

const VIEWPORT = 800;
function report(el: Element, visiblePx: number, heightPx: number) {
  const io = FakeIO.all.find((o) => o.targets.has(el));
  if (!io) throw new Error('khối chưa được theo dõi');
  const entry = {
    target: el,
    isIntersecting: visiblePx > 0,
    intersectionRatio: heightPx > 0 ? visiblePx / heightPx : 0,
    boundingClientRect: { height: heightPx } as DOMRectReadOnly,
    intersectionRect: { height: visiblePx } as DOMRectReadOnly,
    rootBounds: { height: VIEWPORT } as DOMRectReadOnly,
    time: 0,
  } as IntersectionObserverEntry;
  act(() => (io as unknown as { cb: IntersectionObserverCallback }).cb([entry], io as unknown as IntersectionObserver));
}

let root: Root;
let host: HTMLDivElement;
const block = (id: string) => {
  const el = document.createElement('div');
  el.dataset.homeBlock = id;
  host.appendChild(el);
  return el;
};
const flushMutations = () => act(async () => Promise.resolve());

beforeEach(() => {
  vi.useFakeTimers();
  FakeIO.all = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
  m.trackOncePerSession.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('HomeBlockTracker', () => {
  it('khối lộ ≥ 50% đủ 1 giây thì gửi một lần; lộ lại sau đó không gửi thêm', () => {
    const flash = block('flash');
    act(() => root.render(<HomeBlockTracker />));
    report(flash, 150, 300);
    act(() => vi.advanceTimersByTime(HOME_BLOCK_DWELL_MS - 1));
    expect(m.trackOncePerSession).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(m.trackOncePerSession).toHaveBeenCalledTimes(1);
    expect(m.trackOncePerSession).toHaveBeenCalledWith('home:flash', 'home_block_viewed', { block: 'flash' });
    // Đã tính thì thôi theo dõi khối đó: cuộn lên xuống không hẹn giờ lại.
    expect(FakeIO.all.some((o) => o.targets.has(flash))).toBe(false);
  });

  it('lộ dưới 50% hoặc cuộn qua trước 1 giây thì không tính', () => {
    const best = block('bestSellers');
    act(() => root.render(<HomeBlockTracker />));
    report(best, 100, 300);
    act(() => vi.advanceTimersByTime(3 * HOME_BLOCK_DWELL_MS));
    report(best, 200, 300);
    act(() => vi.advanceTimersByTime(HOME_BLOCK_DWELL_MS / 2));
    report(best, 0, 300);
    act(() => vi.advanceTimersByTime(3 * HOME_BLOCK_DWELL_MS));
    expect(m.trackOncePerSession).not.toHaveBeenCalled();
  });

  it('khối cao (lưới gợi ý) phủ ≥ nửa màn hình thì tính dù chỉ lộ một phần nhỏ của nó; khối cao 0 không tính', () => {
    const feed = block('suggest');
    const empty = block('member');
    act(() => root.render(<HomeBlockTracker />));
    report(feed, VIEWPORT / 2, 20 * VIEWPORT);
    report(empty, 0, 0);
    act(() => vi.advanceTimersByTime(HOME_BLOCK_DWELL_MS));
    expect(m.trackOncePerSession.mock.calls.map((c) => c[0])).toEqual(['home:suggest']);
  });

  it('bắt khối chen vào sau; bỏ qua khung chờ chung và dải lỗi cấp trang', async () => {
    act(() => root.render(<HomeBlockTracker />));
    const settling = block('settling');
    const late = block('community');
    await flushMutations();
    const watched = FakeIO.all.flatMap((o) => Array.from(o.targets));
    expect(watched).toContain(late);
    expect(watched).not.toContain(settling);
    report(late, 400, 400);
    act(() => vi.advanceTimersByTime(HOME_BLOCK_DWELL_MS));
    expect(m.trackOncePerSession).toHaveBeenCalledWith('home:community', 'home_block_viewed', { block: 'community' });
  });

  it('rời Trang chủ giữa chừng thì huỷ hẹn giờ, không gửi', () => {
    const flash = block('flash');
    act(() => root.render(<HomeBlockTracker />));
    report(flash, 300, 300);
    act(() => root.render(<></>));
    act(() => vi.advanceTimersByTime(3 * HOME_BLOCK_DWELL_MS));
    expect(m.trackOncePerSession).not.toHaveBeenCalled();
  });
});
