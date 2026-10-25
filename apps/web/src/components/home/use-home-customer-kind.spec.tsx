// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { HOME_KIND_KEY, readStoredHomeKind, useHomeCustomerKind } from './use-home-customer-kind';

type Purchased = Parameters<typeof useHomeCustomerKind>[2];
const pending: Purchased = { isPending: true, isSuccess: false, data: undefined };
const done = (n: number): Purchased => ({ isPending: false, isSuccess: true, data: { items: new Array(n).fill({}), nextCursor: null } as never });
const failed: Purchased = { isPending: false, isSuccess: false, data: undefined };

beforeEach(() => localStorage.clear());

describe('useHomeCustomerKind', () => {
  it('khách chưa đăng nhập luôn là "new", không đọc/ghi gì', () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    expect(renderHook(() => useHomeCustomerKind(false, undefined, pending)).result.current).toBe('new');
    expect(readStoredHomeKind(undefined)).toBeNull();
  });

  it('đang tải: dùng loại đã nhớ của CHÍNH tài khoản này; tài khoản khác hoặc dữ liệu hỏng → "unknown" (khung chờ trung tính)', () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    expect(renderHook(() => useHomeCustomerKind(true, 'u1', pending)).result.current).toBe('returning');
    expect(renderHook(() => useHomeCustomerKind(true, 'u2', pending)).result.current).toBe('unknown');
    localStorage.setItem(HOME_KIND_KEY, '{không phải json');
    expect(renderHook(() => useHomeCustomerKind(true, 'u1', pending)).result.current).toBe('unknown');
  });

  it('tải xong: lấy loại thật và ghi lại cho lần mở sau', () => {
    expect(renderHook(() => useHomeCustomerKind(true, 'u1', done(2))).result.current).toBe('returning');
    expect(JSON.parse(localStorage.getItem(HOME_KIND_KEY)!)).toEqual({ userId: 'u1', kind: 'returning' });
    expect(renderHook(() => useHomeCustomerKind(true, 'u1', done(0))).result.current).toBe('new');
    expect(JSON.parse(localStorage.getItem(HOME_KIND_KEY)!)).toEqual({ userId: 'u1', kind: 'new' });
  });

  it('lỗi: khách đã nhớ là "returning" vẫn giữ "returning" và không ghi đè; chưa nhớ gì thì "new"', () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    expect(renderHook(() => useHomeCustomerKind(true, 'u1', failed)).result.current).toBe('returning');
    expect(JSON.parse(localStorage.getItem(HOME_KIND_KEY)!).kind).toBe('returning');
    localStorage.clear();
    expect(renderHook(() => useHomeCustomerKind(true, 'u1', failed)).result.current).toBe('new');
    expect(localStorage.getItem(HOME_KIND_KEY)).toBeNull();
  });

  it('đang khôi phục phiên: theo loại của tài khoản dùng gần nhất, chưa nhớ thì "unknown", không bao giờ "new" khi chưa nhớ', () => {
    expect(renderHook(() => useHomeCustomerKind(false, undefined, pending, true)).result.current).toBe('unknown');
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    expect(renderHook(() => useHomeCustomerKind(false, undefined, pending, true)).result.current).toBe('returning');
    expect(renderHook(() => useHomeCustomerKind(false, undefined, pending, false)).result.current).toBe('new');
  });
});
