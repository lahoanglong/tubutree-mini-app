// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { useBreakpointSide } from './use-breakpoint-side';

const QUERY = '(min-width: 768px)';

function Probe() {
  return <span data-testid="side">{useBreakpointSide(QUERY)}</span>;
}

/** `matchMedia` giả: `matches` đổi được, `set()` báo đổi như khi khách xoay máy hay kéo cửa sổ. */
function stubMedia(initial: boolean) {
  const state = { matches: initial };
  const listeners = new Set<() => void>();
  window.matchMedia = ((media: string) => ({
    get matches() {
      return state.matches;
    },
    media,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  })) as unknown as typeof window.matchMedia;
  return {
    set(matches: boolean) {
      state.matches = matches;
      act(() => listeners.forEach((cb) => cb()));
    },
    listeners,
  };
}

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const side = () => mounted!.container.querySelector('[data-testid="side"]')!.textContent;

describe('useBreakpointSide', () => {
  it('HTML server dựng cả hai phía (both) dù môi trường có matchMedia; hydrate không lệch HTML rồi mới chọn phía của khổ đang xem', async () => {
    stubMedia(false);
    const html = renderToString(<Probe />);
    expect(html).toContain('>both<');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, <Probe />, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe('below');
    act(() => root!.unmount());
    container.remove();
  });

  it('không có matchMedia (jsdom, trình duyệt cũ): giữ cả hai phía, CSS chọn phía hiện', () => {
    mounted = render(<Probe />);
    expect(side()).toBe('both');
  });

  it('Safari dưới 14 (chỉ có addListener): vẫn nghe đổi khổ', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    window.matchMedia = ((media: string) => ({
      get matches() {
        return matches;
      },
      media,
      addListener: (cb: () => void) => listeners.add(cb),
      removeListener: (cb: () => void) => listeners.delete(cb),
    })) as unknown as typeof window.matchMedia;
    mounted = render(<Probe />);
    expect(side()).toBe('below');
    matches = true;
    act(() => listeners.forEach((cb) => cb()));
    expect(side()).toBe('above');
    mounted.unmount();
    mounted = null;
    expect(listeners.size).toBe(0);
  });

  it('trình duyệt: chỉ phía của khổ đang xem; đổi khổ qua điểm gãy thì đổi phía, gỡ thì bỏ lắng nghe', () => {
    const media = stubMedia(false);
    mounted = render(<Probe />);
    expect(side()).toBe('below');
    media.set(true);
    expect(side()).toBe('above');
    mounted.unmount();
    mounted = null;
    expect(media.listeners.size).toBe(0);
  });
});
