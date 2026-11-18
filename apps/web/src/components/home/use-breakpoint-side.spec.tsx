// @vitest-environment jsdom
import { act } from 'react';
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
  it('HTML server dựng cả hai phía (both): khổ nào cũng đúng ngay khung hình đầu', () => {
    expect(renderToString(<Probe />)).toContain('>both<');
  });

  it('không có matchMedia (jsdom, trình duyệt cũ): giữ cả hai phía, CSS chọn phía hiện', () => {
    mounted = render(<Probe />);
    expect(side()).toBe('both');
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
