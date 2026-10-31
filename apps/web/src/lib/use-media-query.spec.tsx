// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '@/test-utils/dom';
import { useMediaQuery } from './use-media-query';

function Probe({ q }: { q: string }) {
  return <span data-testid="v">{String(useMediaQuery(q))}</span>;
}

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return matches; },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return (next: boolean) => {
    matches = next;
    act(() => listeners.forEach((fn) => fn()));
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useMediaQuery', () => {
  it('không có matchMedia (máy chủ, jsdom cũ): false', () => {
    vi.stubGlobal('matchMedia', undefined);
    const r = render(<Probe q="(min-width: 1024px)" />);
    expect(r.container.textContent).toBe('false');
    r.unmount();
  });

  it('đọc giá trị hiện tại và theo dõi thay đổi khi đổi khổ', () => {
    const set = stubMatchMedia(true);
    const r = render(<Probe q="(min-width: 1024px)" />);
    expect(r.container.textContent).toBe('true');
    set(false);
    expect(r.container.textContent).toBe('false');
    r.unmount();
  });
});
