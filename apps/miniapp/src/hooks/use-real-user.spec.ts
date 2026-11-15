// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '@tubutree/shared-types';
import { useAuthStore } from '../store/auth';
import { useRealUser } from './use-real-user';

const user = (over: Partial<AuthUser>) => ({ id: 'u1', phone: null, zaloId: null, ...over }) as AuthUser;
type Status = ReturnType<typeof useAuthStore.getState>['status'];
const setAuth = (status: Status, u: AuthUser | null) => act(() => useAuthStore.setState({ status, user: u }));

afterEach(() => setAuth('idle', null));

describe('useRealUser: khách thật theo cùng luật của máy chủ', () => {
  it.each([
    ['có SĐT', 'authenticated', user({ phone: '0900000001' }), true],
    ['có zaloId Zalo thật', 'authenticated', user({ zaloId: 'zalo-123' }), true],
    ['có cả SĐT lẫn zaloId guest_ (đã liên kết SĐT)', 'authenticated', user({ phone: '0900000001', zaloId: 'guest_abc' }), true],
    ['khách theo thiết bị (zaloId guest_…, chưa SĐT)', 'authenticated', user({ zaloId: 'guest_abc' }), false],
    ['không có SĐT lẫn zaloId', 'authenticated', user({}), false],
    ['phiên đang khôi phục', 'loading', user({ phone: '0900000001' }), false],
    ['phiên lỗi (mất mạng)', 'error', user({ phone: '0900000001' }), false],
    ['chưa đăng nhập', 'idle', null, false],
    ['đã đăng nhập nhưng chưa có hồ sơ', 'authenticated', null, false],
  ] as const)('%s → %s', (_name, status, u, expected) => {
    setAuth(status, u);
    expect(renderHook(() => useRealUser()).result.current).toBe(expected);
  });

  it('đổi theo phiên: khách thiết bị đăng nhập xong thành khách thật thì hook đổi sang true', () => {
    setAuth('authenticated', user({ zaloId: 'guest_abc' }));
    const { result } = renderHook(() => useRealUser());
    expect(result.current).toBe(false);
    setAuth('authenticated', user({ zaloId: 'guest_abc', phone: '0900000001' }));
    expect(result.current).toBe(true);
  });
});
