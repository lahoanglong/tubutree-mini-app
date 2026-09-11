// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ctvSlugFor,
  getStorefrontContext,
  rememberStorefront,
  rememberReferral,
  clearStorefrontContext,
} from './storefront-context';

describe('ngữ cảnh gian hàng trên web', () => {
  beforeEach(() => sessionStorage.clear());

  it('chưa vào gian hàng nào → rỗng', () => {
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null, kind: null });
  });

  it('gian hàng CTV → suy ra mã giới thiệu từ slug (slug là referralCode viết thường)', () => {
    rememberStorefront('abc123', 'CTV');
    expect(getStorefrontContext()).toEqual({ slug: 'abc123', referralCode: 'ABC123', kind: 'CTV' });
  });

  it('gian hàng nhãn hàng → giữ slug nhưng KHÔNG bịa mã giới thiệu', () => {
    rememberStorefront('visante', 'BRAND');
    expect(getStorefrontContext()).toEqual({ slug: 'visante', referralCode: null, kind: 'BRAND' });
  });

  it('?ref= trên link bất kỳ → nhớ mã, viết hoa', () => {
    rememberReferral(' abc123 ');
    expect(getStorefrontContext().referralCode).toBe('ABC123');
  });

  it('mã đã nhớ không bị gian hàng nhãn hàng xoá mất', () => {
    rememberReferral('ABC123');
    rememberStorefront('visante', 'BRAND');
    expect(getStorefrontContext()).toEqual({ slug: 'visante', referralCode: 'ABC123', kind: 'BRAND' });
  });

  it('dữ liệu hỏng → rỗng chứ không ném lỗi', () => {
    sessionStorage.setItem('tubu_web_storefront', '{nope');
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null, kind: null });
  });

  it('xoá xong quay về rỗng', () => {
    rememberStorefront('abc123', 'CTV');
    clearStorefrontContext();
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null, kind: null });
  });
});

/**
 * Gắn slug của gian hàng NHÃN HÀNG vào Order.storefrontSlug làm bẩn báo cáo đơn theo CTV và
 * khiến combo được tính theo nhầm gian hàng. Mini App lọc đúng như vậy từ trước.
 */
describe('ctvSlugFor — chỉ gian hàng CTV mới gắn vào đơn', () => {
  beforeEach(() => sessionStorage.clear());

  it('gian hàng CTV → trả slug', () => {
    rememberStorefront('abc123', 'CTV');
    expect(ctvSlugFor(getStorefrontContext())).toBe('abc123');
  });

  it('gian hàng nhãn hàng → undefined, dù vẫn nhớ slug để hiển thị', () => {
    rememberStorefront('visante', 'BRAND');
    expect(ctvSlugFor(getStorefrontContext())).toBeUndefined();
  });

  it('khách vào link CTV rồi lướt sang trang nhãn → KHÔNG gửi slug nhãn, vẫn giữ mã giới thiệu', () => {
    rememberStorefront('abc123', 'CTV');
    rememberStorefront('visante', 'BRAND');
    const ctx = getStorefrontContext();
    expect(ctvSlugFor(ctx)).toBeUndefined();
    expect(ctx.referralCode).toBe('ABC123');
  });
});
