// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDeferForTest, DEFER_ROOT_MARGIN, DeferUntilNear } from './defer-until-near';

const captured: { initial?: unknown }[] = [];
vi.mock('./home-view-client', () => ({
  default: (props: { initial?: unknown }) => {
    captured.push(props);
    return null;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    this.callback(this.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry), this as unknown as IntersectionObserver);
  }
}

const roots: { root: Root; el: HTMLElement }[] = [];
function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() =>
    root.render(
      <DeferUntilNear placeholderStyle={{ height: 144 }}>
        <p>Khối thật</p>
      </DeferUntilNear>,
    ),
  );
  roots.push({ root, el });
  return el;
}

beforeEach(() => {
  __resetDeferForTest();
  FakeObserver.all = [];
  captured.length = 0;
});
afterEach(() => {
  for (const { root, el } of roots.splice(0)) {
    act(() => root.unmount());
    el.remove();
  }
  vi.unstubAllGlobals();
});

describe('DeferUntilNear', () => {
  it('HTML server chỉ có khung giữ chỗ đúng lớp kích thước, không có khối thật', () => {
    const html = renderToString(
      <DeferUntilNear placeholderStyle={{ height: 144 }}>
        <p>Khối thật</p>
      </DeferUntilNear>,
    );
    expect(html).toContain('data-testid="home-defer"');
    expect(html).toContain('style="height:144px"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('Khối thật');
  });

  it('chờ khung giữ chỗ gần tới khung nhìn rồi mới dựng khối thật, và thôi theo dõi', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const el = mount();
    expect(el.textContent).not.toContain('Khối thật');
    const io = FakeObserver.all[0]!;
    expect(io.options?.rootMargin).toBe(DEFER_ROOT_MARGIN);
    expect(io.targets[0]?.getAttribute('data-testid')).toBe('home-defer');

    act(() => io.fire(false));
    expect(el.textContent).not.toContain('Khối thật');

    act(() => io.fire(true));
    expect(el.textContent).toContain('Khối thật');
    expect(el.querySelector('[data-testid="home-defer"]')).toBeNull();
    expect(io.disconnected).toBe(true);
  });

  it('mở lại sau khi đã hydrate (điều hướng trong app) thì dựng ngay, không khung giữ chỗ', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    mount();
    const again = mount();
    expect(again.textContent).toContain('Khối thật');
    expect(FakeObserver.all).toHaveLength(1);
  });

  it('trình duyệt không có IntersectionObserver thì dựng ngay sau hydrate', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const el = mount();
    expect(el.textContent).toContain('Khối thật');
  });
});

describe('HomeView (vỏ server)', () => {
  it('không gửi lưới Gợi ý và danh sách thương hiệu xuống client, giữ nguyên phần còn lại', async () => {
    const { default: HomeView, homeClientInitial } = await import('./home-view');
    const initial = {
      suggest: { data: [], meta: { page: 1, limit: 12, total: 0 } },
      suggestSeed: '20261118',
      brands: [{ brand: 'A', count: 1 }],
      categories: [],
      flash: [],
      flashUpcomingCount: 0,
      campaigns: [],
    } as unknown as Parameters<typeof homeClientInitial>[0];
    expect(homeClientInitial(initial)).toEqual({ suggestSeed: '20261118', categories: [], flash: [], flashUpcomingCount: 0, campaigns: [] });
    expect(initial.suggest).toBeDefined();

    renderToString(<HomeView initial={initial} restoreHint={{ kind: 'new', rows: 0 } as never} />);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ initial: homeClientInitial(initial), restoreHint: { kind: 'new', rows: 0 } });
  });
});
