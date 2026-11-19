// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GUEST_CART_COOKIE, GUEST_PREBUILT_ORIGINS, guestPrebuiltTarget } from './guest-prebuilt';
import { SESSION_COOKIE } from './home-restore-hint';

const jar = (c: Record<string, string>) => (name: string) => c[name];

describe('guestPrebuiltTarget', () => {
  it('chỉ hai trang có bản dựng sẵn; trang khác null', () => {
    expect(guestPrebuiltTarget('/gio-hang', jar({}))).toBe('/gio-hang/khach');
    expect(guestPrebuiltTarget('/vuon-xanh', jar({}))).toBe('/vuon-xanh/khach');
    for (const p of ['/', '/thanh-toan', '/gio-hang/khach', '/vuon-xanh/so-tay', '/tai-khoan']) expect(guestPrebuiltTarget(p, jar({})), p).toBeNull();
  });

  it('cookie phiên đúng "1" thì bản thường; giá trị khác không tính', () => {
    expect(guestPrebuiltTarget('/vuon-xanh', jar({ [SESSION_COOKIE]: '1' }))).toBeNull();
    expect(guestPrebuiltTarget('/vuon-xanh', jar({ [SESSION_COOKIE]: 'true' }))).toBe('/vuon-xanh/khach');
  });

  it('giỏ khách có món chỉ chặn bản dựng sẵn của Giỏ hàng', () => {
    expect(guestPrebuiltTarget('/gio-hang', jar({ [GUEST_CART_COOKIE]: '1' }))).toBeNull();
    expect(guestPrebuiltTarget('/vuon-xanh', jar({ [GUEST_CART_COOKIE]: '1' }))).toBe('/vuon-xanh/khach');
  });

  it('bảng ngược đủ hai chiều', () => {
    expect(GUEST_PREBUILT_ORIGINS).toEqual({ '/gio-hang/khach': '/gio-hang', '/vuon-xanh/khach': '/vuon-xanh' });
  });
});
