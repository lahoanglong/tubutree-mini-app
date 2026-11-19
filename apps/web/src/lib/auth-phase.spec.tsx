// @vitest-environment jsdom
import { Suspense } from 'react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, flush } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ auth: { status: 'authenticated', initialized: true, sessionUnavailable: false } }));
vi.mock('./auth-context', () => ({ useAuth: () => mocks.auth }));

import { PrebuiltGuest, useAuthPhase } from './auth-phase';

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

describe('useAuthPhase trong bản dựng sẵn cho khách (PrebuiltGuest)', () => {
  afterEach(() => window.localStorage.clear());

  async function hydrateGuestShell(authOnClient: typeof mocks.auth) {
    mocks.auth = { status: 'idle', initialized: false, sessionUnavailable: false };
    const html = renderToString(
      <PrebuiltGuest>
        <Probe />
      </PrebuiltGuest>,
    );
    mocks.auth = authOnClient;
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable: unknown[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(
        container,
        <PrebuiltGuest>
          <Probe />
        </PrebuiltGuest>,
        { onRecoverableError: (e) => recoverable.push(e) },
      );
    });
    await flush();
    const hydrationLogs = errors.mock.calls.map((c) => String(c[0])).filter((m) => /hydrat/i.test(m));
    errors.mockRestore();
    return { html, container, recoverable, hydrationLogs, cleanup: () => (root && act(() => root!.unmount()), container.remove()) };
  }

  it('HTML máy chủ vẽ giao diện khách ngay (không phải khung chờ)', () => {
    mocks.auth = { status: 'idle', initialized: false, sessionUnavailable: false };
    expect(renderToString(<PrebuiltGuest><Probe /></PrebuiltGuest>)).toContain('guest');
  });

  it('khôi phục phiên chưa xong mà máy không có cờ phiên: vẫn là guest, hydrate không lệch, không chớp khung chờ', async () => {
    const r = await hydrateGuestShell({ status: 'idle', initialized: false, sessionUnavailable: false });
    try {
      expect(r.recoverable).toEqual([]);
      expect(r.hydrationLogs).toEqual([]);
      expect(r.container.textContent).toBe('guest');
    } finally {
      r.cleanup();
    }
  });

  it('máy còn cờ phiên (cookie đã mất): sau hydrate về loading như bản thường để khôi phục phiên', async () => {
    window.localStorage.setItem('tubu_web_session', '1');
    const r = await hydrateGuestShell({ status: 'loading', initialized: false, sessionUnavailable: false });
    try {
      expect(r.recoverable).toEqual([]);
      expect(r.container.textContent).toBe('loading');
    } finally {
      r.cleanup();
    }
  });

  it('phiên khôi phục xong thì authenticated như thường', async () => {
    const r = await hydrateGuestShell({ status: 'authenticated', initialized: true, sessionUnavailable: false });
    try {
      expect(r.container.textContent).toBe('authenticated');
    } finally {
      r.cleanup();
    }
  });
});
