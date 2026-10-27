import { afterEach, describe, expect, it, vi } from 'vitest';
import { miniAppLink, miniAppPathLink } from './zalo-mini-app';

afterEach(() => vi.unstubAllEnvs());

describe('miniAppLink', () => {
  it('chưa cấu hình id Mini App: dùng id chính thức, nút luôn có', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    expect(miniAppLink()).toBe('https://zalo.me/s/2070857098114207963/');
  });

  it('id Mini App không phải số (cấu hình hỏng): dùng id chính thức, không dựng link sai', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', 'abc/../x');
    expect(miniAppLink()).toBe('https://zalo.me/s/2070857098114207963/');
  });

  it('có id Mini App: mở trang chủ Mini App', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '2070857098114207963');
    expect(miniAppLink()).toBe('https://zalo.me/s/2070857098114207963/');
    expect(miniAppLink('/trang-khong-co-man-mini-app')).toBe('https://zalo.me/s/2070857098114207963/');
  });

  it('khách đang xem một sản phẩm: mở đúng sản phẩm đó trong Mini App', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '123');
    expect(miniAppLink('/san-pham/dau-goi-bo-ket')).toBe('https://zalo.me/s/123/product/dau-goi-bo-ket');
    expect(miniAppLink('/san-pham/dau-goi?ref=AN1')).toBe('https://zalo.me/s/123/product/dau-goi');
  });

  it('trang có màn Mini App tương ứng: mở đúng màn đó', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '123');
    expect(miniAppLink('/gio-hang')).toBe('https://zalo.me/s/123/cart');
    expect(miniAppLink('/tai-khoan/don-hang/TT1')).toBe('https://zalo.me/s/123/order/TT1');
    expect(miniAppLink('/tai-khoan/don-hang?tab=subscriptions')).toBe('https://zalo.me/s/123/subscriptions');
    expect(miniAppLink('/doi-rac/quay')).toBe('https://zalo.me/s/123/recycle/desk');
  });
});

describe('miniAppLink: không rơi về App ID của Zalo App', () => {
  it('chỉ có NEXT_PUBLIC_ZALO_APP_ID, thiếu id Mini App: dùng id Mini App chính thức, không dùng App ID', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '565779011239360460');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    expect(miniAppLink()).toBe('https://zalo.me/s/2070857098114207963/');
    expect(miniAppLink()).not.toContain('565779011239360460');
    expect(miniAppPathLink('/points/scan')).toBe('https://zalo.me/s/2070857098114207963/points/scan');
  });

  it('có cả hai: link dùng id Mini App, không chứa App ID', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '565779011239360460');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '2070857098114207963');
    expect(miniAppLink()).toBe('https://zalo.me/s/2070857098114207963/');
    expect(miniAppLink()).not.toContain('565779011239360460');
  });
});

describe('miniAppPathLink', () => {
  it('mở thẳng đường dẫn Mini App đã biết; chưa cấu hình id Mini App thì dùng id chính thức', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '123');
    expect(miniAppPathLink('/points/scan')).toBe('https://zalo.me/s/123/points/scan');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    expect(miniAppPathLink('/points/scan')).toBe('https://zalo.me/s/2070857098114207963/points/scan');
  });
});
