// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '@/test-utils/dom';
import { useMediaQuery } from './use-media-query';

function Probe({ query }: { query: string }) {
  return <span data-testid="m">{String(useMediaQuery(query))}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('không có matchMedia (jsdom): false', () => {
    const { container, unmount } = render(<Probe query="(max-width: 1023px)" />);
    expect(container.textContent).toBe('false');
    unmount();
  });

  it('theo kết quả khớp và cập nhật khi media query đổi', () => {
    let listener: (() => void) | null = null;
    const list = { matches: true, addEventListener: (_: string, cb: () => void) => (listener = cb), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => list);
    const { container, unmount } = render(<Probe query="(max-width: 1023px)" />);
    expect(container.textContent).toBe('true');
    list.matches = false;
    act(() => listener?.());
    expect(container.textContent).toBe('false');
    unmount();
    expect(list.removeEventListener).toHaveBeenCalled();
  });
});
