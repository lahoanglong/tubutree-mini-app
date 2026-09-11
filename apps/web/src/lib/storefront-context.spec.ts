// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStorefrontContext,
  rememberStorefront,
  rememberReferral,
  clearStorefrontContext,
} from './storefront-context';

describe('ngữ cảnh gian hàng trên web', () => {
  beforeEach(() => sessionStorage.clear());

  it('chưa vào gian hàng nào → rỗng', () => {
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null });
  });

  it('gian hàng CTV → suy ra mã giới thiệu từ slug (slug là referralCode viết thường)', () => {
    rememberStorefront('abc123', 'CTV');
    expect(getStorefrontContext()).toEqual({ slug: 'abc123', referralCode: 'ABC123' });
  });

  it('gian hàng nhãn hàng → giữ slug nhưng KHÔNG bịa mã giới thiệu', () => {
    rememberStorefront('visante', 'BRAND');
    expect(getStorefrontContext()).toEqual({ slug: 'visante', referralCode: null });
  });

  it('?ref= trên link bất kỳ → nhớ mã, viết hoa', () => {
    rememberReferral(' abc123 ');
    expect(getStorefrontContext().referralCode).toBe('ABC123');
  });

  it('mã đã nhớ không bị gian hàng nhãn hàng xoá mất', () => {
    rememberReferral('ABC123');
    rememberStorefront('visante', 'BRAND');
    expect(getStorefrontContext()).toEqual({ slug: 'visante', referralCode: 'ABC123' });
  });

  it('dữ liệu hỏng → rỗng chứ không ném lỗi', () => {
    sessionStorage.setItem('tubu_web_storefront', '{nope');
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null });
  });

  it('xoá xong quay về rỗng', () => {
    rememberStorefront('abc123', 'CTV');
    clearStorefrontContext();
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null });
  });
});
