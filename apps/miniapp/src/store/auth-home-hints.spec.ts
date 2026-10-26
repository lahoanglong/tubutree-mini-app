// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn(), removeStorage: vi.fn() }));
vi.mock('../services/api', () => ({
  setAccessToken: vi.fn(),
  setAuthReady: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  loginGuest: vi.fn(),
  loginZaloMiniApp: vi.fn(),
  refreshTokens: vi.fn(),
  ensurePhoneApi: vi.fn(),
}));
vi.mock('../services/zmp-bridge', () => ({
  getZaloAccessToken: vi.fn(),
  requestZaloPhoneToken: vi.fn(),
  getLaunchReferral: vi.fn(() => undefined),
}));
vi.mock('../services/first-touch', () => ({ loadFirstTouch: vi.fn(async () => undefined) }));

import type { AuthUser } from '@tubutree/shared-types';
import { useAuthStore } from './auth';


describe('đổi tài khoản trên cùng máy — gợi ý khung chờ Trang chủ', () => {
  const KIND = 'tubu_home_kind';
  const ROWS = 'tubu_home_todo_rows';
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, status: 'idle', error: undefined });
    localStorage.setItem(KIND, JSON.stringify({ userId: 'A', kind: 'returning' }));
    localStorage.setItem(ROWS, JSON.stringify({ userId: 'A', rows: 2 }));
  });

  it('khôi phục/đăng nhập ra tài khoản khác: bỏ loại khách và số dòng của người trước ngay', () => {
    useAuthStore.setState({ user: { id: 'B' } as AuthUser, status: 'authenticated' });
    expect(localStorage.getItem(KIND)).toBeNull();
    expect(localStorage.getItem(ROWS)).toBeNull();
  });

  it('đúng tài khoản đã lưu: giữ nguyên gợi ý', () => {
    useAuthStore.setState({ user: { id: 'A' } as AuthUser, status: 'authenticated' });
    expect(JSON.parse(localStorage.getItem(KIND)!)).toEqual({ userId: 'A', kind: 'returning' });
    expect(JSON.parse(localStorage.getItem(ROWS)!)).toEqual({ userId: 'A', rows: 2 });
  });

  it('cập nhật hồ sơ cùng tài khoản (id không đổi) không đụng tới gợi ý của chính họ', () => {
    useAuthStore.setState({ user: { id: 'A' } as AuthUser, status: 'authenticated' });
    useAuthStore.setState({ user: { id: 'A', fullName: 'An' } as AuthUser });
    expect(localStorage.getItem(KIND)).not.toBeNull();
  });

  it('đăng xuất: bỏ luôn gợi ý của chính tài khoản đó', async () => {
    useAuthStore.setState({ user: { id: 'A' } as AuthUser, status: 'authenticated' });
    await useAuthStore.getState().logout();
    expect(localStorage.getItem(KIND)).toBeNull();
    expect(localStorage.getItem(ROWS)).toBeNull();
  });
});
