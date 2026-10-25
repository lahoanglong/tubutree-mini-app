// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client-api', async (orig) => ({
  ...(await orig<typeof import('./client-api')>()),
  restoreSession: vi.fn().mockResolvedValue({ kind: 'none' }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP_ID = '565779011239360460';
const MINIAPP_ID = '2070857098114207963';

// ZALO_APP_ID được đọc một lần lúc nạp module, nên mỗi ca nạp lại auth-context sau khi đặt env.
async function startLogin() {
  vi.resetModules();
  const { AuthProvider, useAuth } = await import('./auth-context');
  let start: () => Promise<void> = async () => {};
  function Grab() {
    start = useAuth().startZaloLogin;
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Grab />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  let href = '';
  const original = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'https://app.tubutree.com',
      set href(v: string) {
        href = v;
      },
    },
  });
  try {
    await act(async () => {
      await start();
    });
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    act(() => root.unmount());
    host.remove();
  }
  return href;
}

describe('startZaloLogin dùng App ID của Zalo App', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllEnvs());

  it('URL OAuth mang NEXT_PUBLIC_ZALO_APP_ID, không mang ID Mini App', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', APP_ID);
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', MINIAPP_ID);
    const href = await startLogin();
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe('https://oauth.zaloapp.com/v4/permission');
    expect(url.searchParams.get('app_id')).toBe(APP_ID);
    expect(href).not.toContain(MINIAPP_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.tubutree.com/dang-nhap/callback');
  });

  it('chỉ có ID Mini App, thiếu App ID: không chuyển trang (không dùng ID Mini App thay thế)', async () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', MINIAPP_ID);
    await expect(startLogin()).rejects.toThrow('thiếu NEXT_PUBLIC_ZALO_APP_ID');
  });
});
