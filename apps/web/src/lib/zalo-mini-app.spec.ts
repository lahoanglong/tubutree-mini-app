import { afterEach, describe, expect, it, vi } from 'vitest';
import { miniAppLink, miniAppPathLink } from './zalo-mini-app';

afterEach(() => vi.unstubAllEnvs());

describe('miniAppLink', () => {
  it('chưa cấu hình id Mini App: không có link (nút ẩn)', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    expect(miniAppLink()).toBeNull();
  });

  it('id Mini App không phải số (cấu hình hỏng): không dựng link sai', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', 'abc/../x');
    expect(miniAppLink()).toBeNull();
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
  it('chỉ có NEXT_PUBLIC_ZALO_APP_ID, thiếu id Mini App: không dựng link', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '565779011239360460');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    expect(miniAppLink()).toBeNull();
    expect(miniAppPathLink('/points/scan')).toBeNull();
  });

  it('có cả hai: link dùng id Mini App, không chứa App ID', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '565779011239360460');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '2070857098114207963');
    expect(miniAppLink()).toBe('https://zalo.me/s/2070857098114207963/');
    expect(miniAppLink()).not.toContain('565779011239360460');
  });
});

describe('miniAppPathLink', () => {
  it('mở thẳng đường dẫn Mini App đã biết; chưa cấu hình id Mini App thì null', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '123');
    expect(miniAppPathLink('/points/scan')).toBe('https://zalo.me/s/123/points/scan');
    vi.stubEnv('NEXT_PUBLIC_ZALO_MINIAPP_ID', '');
    expect(miniAppPathLink('/points/scan')).toBeNull();
  });
});
