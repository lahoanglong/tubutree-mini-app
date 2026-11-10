// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// "Đăng xuất" ở Cài đặt với AuthProvider thật (Wave 92B, sửa theo review): `logout()` thật nuốt lỗi của POST /auth/logout rồi vẫn xoá phiên, nên
// lỗi "ném ra" không xảy ra ngoài đời. Ca thật là POST rớt/hỏng (phiên vẫn phải sạch) và POST treo (khoá giữ tới hạn 20 giây của apiFetch).

const mocks = vi.hoisted(() => ({ restoreSession: vi.fn(), get: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/client-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client-api')>()),
  restoreSession: mocks.restoreSession,
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: { oa: { available: false, follow: vi.fn() }, storage: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) } },
}));

import { AuthProvider } from '@/lib/auth-context';
import { REQUEST_TIMEOUT_MS, hasSessionMarker, setSessionMarker } from '@/lib/client-api';
import SettingsPage from './page';

const USER = { id: 'u1', fullName: 'Lan', avatarUrl: null, role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0, referralCode: 'R' };
const GUEST_NOTICE = 'Đăng nhập để chỉnh cài đặt của bạn.';

const fetchMock = vi.fn();
const logoutCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/logout'));
const logoutBtn = (c: HTMLElement) => byText(c, 'button', /^Đăng xuất$/) as HTMLButtonElement;

let mounted: Rendered[] = [];
let client: QueryClient;
const mount = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(
    <AuthProvider>
      <SettingsPage />
    </AuthProvider>,
    client,
  );
  mounted.push(r);
  await flush(8);
  client.setQueryData(['cart'], { items: [{ id: 'cũ' }] });
  return r.container;
};

beforeEach(() => {
  localStorage.clear();
  setSessionMarker();
  mocks.restoreSession.mockReset().mockResolvedValue({ kind: 'ok', data: { accessToken: 'at', user: USER } });
  mocks.get.mockReset().mockResolvedValue({ notifyPromo: true, notifyGarden: true });
  mocks.patch.mockReset().mockResolvedValue({ notifyPromo: true, notifyGarden: true });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('/tai-khoan/cai-dat: đăng xuất khi POST /auth/logout hỏng vẫn xoá phiên', () => {
  it.each([
    ['mất mạng', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['máy chủ 500', async () => new Response('{"message":"lỗi"}', { status: 500, headers: { 'Content-Type': 'application/json' } })],
  ])('%s: phiên, dấu phiên và cache đều sạch, trang về màn đăng nhập, không có lỗi bị bỏ rơi', async (_name, reply) => {
    fetchMock.mockImplementation(reply);
    const c = await mount();
    expect(hasSessionMarker()).toBe(true);
    expect(client.getQueryData(['cart'])).toBeDefined();
    const seen = await captureUnhandledRejections(async () => {
      click(logoutBtn(c));
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(logoutCalls()).toHaveLength(1);
    expect(hasSessionMarker()).toBe(false);
    expect(client.getQueryData(['cart'])).toBeUndefined();
    expect(c.textContent).toContain(GUEST_NOTICE);
    expect(logoutBtn(c)).toBeNull();
  });
});

describe('/tai-khoan/cai-dat: POST /auth/logout treo', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('khoá giữ nút (chạm lại không gửi thêm, phiên chưa mất) tới hạn của apiFetch, hết hạn thì phiên vẫn bị xoá', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const c = await mount();
    const btn = logoutBtn(c);
    btn.focus();
    click(btn);
    await flush(4);
    await advance(REQUEST_TIMEOUT_MS - 2_000);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(btn);
    click(btn);
    await flush(4);
    expect(logoutCalls()).toHaveLength(1);
    expect(hasSessionMarker()).toBe(true);
    expect(c.textContent).not.toContain(GUEST_NOTICE);
    const seen = await captureUnhandledRejections(async () => {
      await advance(2_500);
      await flush(6);
    });
    expect(seen).toEqual([]);
    expect(logoutCalls()).toHaveLength(1);
    expect(hasSessionMarker()).toBe(false);
    expect(client.getQueryData(['cart'])).toBeUndefined();
    expect(c.textContent).toContain(GUEST_NOTICE);
  });
});
