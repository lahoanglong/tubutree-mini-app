// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, flush } from '@/test-utils/dom';
import { useHydrated } from './use-hydrated';

function Probe() {
  return <span>{useHydrated() ? 'client' : 'server'}</span>;
}

describe('useHydrated', () => {
  it('máy chủ vẽ false (HTML đầu không mang nội dung theo phiên)', () => {
    expect(renderToString(<Probe />)).toContain('server');
  });
  it('trình duyệt vẽ true', async () => {
    const r = render(<Probe />);
    await flush();
    expect(r.container.textContent).toBe('client');
    r.unmount();
  });
});
