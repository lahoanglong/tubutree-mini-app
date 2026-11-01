// @vitest-environment jsdom
import { Suspense } from 'react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, flush } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ auth: { status: 'authenticated', initialized: true, sessionUnavailable: false } }));
vi.mock('./auth-context', () => ({ useAuth: () => mocks.auth }));

import { useAuthPhase } from './auth-phase';

function Probe() {
  return <span>{useAuthPhase()}</span>;
}

afterEach(() => {
  mocks.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false };
  vi.restoreAllMocks();
});

describe('useAuthPhase', () => {
  // Kiểm giá trị pha ở lượt vẽ máy chủ (không kiểm lệch hydrate; ca hydrateRoot bên dưới làm việc đó).
  it('lượt vẽ máy chủ luôn là loading dù phiên đã khôi phục', () => {
    mocks.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false };
    expect(renderToString(<Probe />)).toContain('loading');
  });

  it('sau hydrate trả đúng pha thật', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false };
    const r = render(<Probe />);
    try {
      await flush();
      expect(r.container.textContent).toBe('authenticated');
    } finally {
      r.unmount();
    }
  });

  it('hydrateRoot thật: HTML máy chủ vẽ lúc auth chưa khởi tạo, client hydrate trong Suspense với auth đã authenticated, không lệch', async () => {
    mocks.auth = { status: 'idle', initialized: false, sessionUnavailable: false };
    const html = renderToString(
      <Suspense fallback={null}>
        <Probe />
      </Suspense>,
    );
    expect(html).toContain('loading');

    mocks.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false };
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable: unknown[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <Suspense fallback={null}>
            <Probe />
          </Suspense>,
          { onRecoverableError: (e) => recoverable.push(e) },
        );
      });
      await flush();
      const logged = errors.mock.calls.map((c) => String(c[0]));
      expect(recoverable).toEqual([]);
      expect(logged.filter((m) => /hydrat/i.test(m))).toEqual([]);
      expect(container.textContent).toBe('authenticated');
    } finally {
      errors.mockRestore();
      if (root) act(() => root!.unmount());
      container.remove();
    }
  });
});
