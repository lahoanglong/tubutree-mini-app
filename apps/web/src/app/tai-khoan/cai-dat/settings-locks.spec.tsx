// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Cài đặt web ↔ Mini (Wave 92B ↔ 78A): "Đăng xuất" khoá đồng bộ, chạm đúp cùng khung hình chỉ đăng xuất một lần (mỗi lần là một lệnh POST /auth/logout
// và một lượt xoá cache), nút báo bận bằng aria để giữ focus.

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', fullName: 'Lan' } as Record<string, unknown> | null,
    status: 'authenticated' as string,
    initialized: true,
    sessionUnavailable: false,
    retrySession: vi.fn(),
    logout: vi.fn(),
  },
  get: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: { oa: { available: false, follow: vi.fn() }, storage: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) } },
}));

import SettingsPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<SettingsPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const logoutBtn = (c: HTMLElement) => byText(c, 'button', /^Đăng xuất$/) as HTMLButtonElement;
const twice = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });
const gate = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  mocks.auth.user = { id: 'u1', fullName: 'Lan' };
  mocks.auth.logout.mockReset().mockResolvedValue(undefined);
  mocks.get.mockReset().mockResolvedValue({ notifyPromo: true, notifyGarden: true });
  mocks.patch.mockReset().mockResolvedValue({ notifyPromo: true, notifyGarden: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/cai-dat: "Đăng xuất" khoá đồng bộ (W92B ↔ W78A)', () => {
  it('chạm đúp cùng khung hình chỉ đăng xuất một lần; nút giữ focus (aria-busy + aria-disabled, không disabled) tới khi xong, rồi dùng lại được', async () => {
    const out = gate();
    mocks.auth.logout.mockReturnValueOnce(out.promise);
    const { container } = await mount();
    const btn = logoutBtn(container);
    btn.focus();
    twice(btn);
    await flush(3);
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    click(btn);
    await flush(3);
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
    await act(async () => out.resolve());
    await flush(4);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(3);
    expect(mocks.auth.logout).toHaveBeenCalledTimes(2);
  });

  it('đăng xuất ném lỗi: khoá vẫn nhả (bấm lại được) và lỗi không bị nuốt mà lên unhandledrejection như mọi nút trả Promise', async () => {
    mocks.auth.logout.mockRejectedValueOnce(new Error('boom'));
    const { container } = await mount();
    const btn = logoutBtn(container);
    const seen = await captureUnhandledRejections(async () => {
      click(btn);
      await flush(4);
    });
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe('boom');
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(3);
    expect(mocks.auth.logout).toHaveBeenCalledTimes(2);
  });
});
