// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

const auth = vi.hoisted(() => ({ value: { status: 'idle', initialized: false, sessionUnavailable: false } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.value }));
vi.mock('@/lib/shell-pathname', () => ({ useShellPathname: () => '/tai-khoan' }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => true }));

import { AccountShell } from './account-shell';
import { SessionCookieProvider } from './session-cookie-provider';

const html = (hasSession: boolean) =>
  renderToString(
    <SessionCookieProvider hasSession={hasSession}>
      <AccountShell>
        <main>nội dung</main>
      </AccountShell>
    </SessionCookieProvider>,
  );

describe('AccountShell: HTML đầu do server dựng (useAuthRestoring thật, không mock)', () => {
  it('có cookie phiên: HTML đầu đã có khung hai cột và menu khung xương', () => {
    const out = html(true);
    expect(out).toContain('lg:grid-cols-[240px_minmax(0,1fr)]');
    expect(out).toContain('account-shell-nav-skeleton');
  });

  it('khách vãng lai (không cookie): không có khung, không có menu khung xương', () => {
    const out = html(false);
    expect(out).not.toContain('lg:grid-cols');
    expect(out).not.toContain('account-shell-nav-skeleton');
  });

  it('cờ còn nhưng mất mạng lúc khôi phục (unavailable): giữ khung, không nhảy lần hai', () => {
    auth.value = { status: 'idle', initialized: true, sessionUnavailable: true };
    expect(html(true)).toContain('account-shell-nav-skeleton');
    auth.value = { status: 'idle', initialized: false, sessionUnavailable: false };
  });
});
