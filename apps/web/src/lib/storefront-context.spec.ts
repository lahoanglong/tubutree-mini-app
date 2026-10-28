// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PENDING_REF_TTL_DAYS,
  clearPendingRef,
  confirmReferralTouch,
  ctvSlugFor,
  getStorefrontContext,
  PENDING_REF_MAX,
  readPendingRefs,
  rememberEntryLink,
  rememberStorefront,
  rememberReferral,
  clearStorefrontContext,
} from './storefront-context';

describe('ngữ cảnh gian hàng trên web', () => {
  beforeEach(() => sessionStorage.clear());

  it('chưa vào gian hàng nào → rỗng', () => {
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null, kind: null, referralEligible: null });
  });

  it('gian hàng CTV → mã giới thiệu là của chủ gian hàng do API trả', () => {
    rememberStorefront('abc123', 'CTV', 'abc123');
    expect(getStorefrontContext()).toEqual({ slug: 'abc123', referralCode: 'ABC123', kind: 'CTV', referralEligible: true });
  });

  it('SELLER-4: CTV đổi subdomain → mã giới thiệu vẫn là của chủ, không suy từ slug/subdomain', () => {
    rememberStorefront('ctvone1', 'CTV', 'CTVONE1');
    expect(getStorefrontContext()).toEqual({ slug: 'ctvone1', referralCode: 'CTVONE1', kind: 'CTV', referralEligible: true });
    sessionStorage.clear();
    rememberStorefront('greenshop', 'CTV');
    expect(getStorefrontContext().referralCode).toBeNull();
  });

  it('gian hàng nhãn hàng → giữ slug nhưng KHÔNG bịa mã giới thiệu', () => {
    rememberStorefront('visante', 'BRAND');
    expect(getStorefrontContext()).toEqual({ slug: 'visante', referralCode: null, kind: 'BRAND', referralEligible: null });
  });

  it('?ref= trên link bất kỳ → nhớ mã, viết hoa', () => {
    rememberReferral(' abc123 ');
    expect(getStorefrontContext().referralCode).toBe('ABC123');
  });

  it('mã đã nhớ không bị gian hàng nhãn hàng xoá mất', () => {
    rememberReferral('ABC123');
    rememberStorefront('visante', 'BRAND');
    expect(getStorefrontContext()).toEqual({ slug: 'visante', referralCode: 'ABC123', kind: 'BRAND', referralEligible: null });
  });

  it('dữ liệu hỏng → rỗng chứ không ném lỗi', () => {
    sessionStorage.setItem('tubu_web_storefront', '{nope');
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null, kind: null, referralEligible: null });
  });

  it('xoá xong quay về rỗng', () => {
    rememberStorefront('abc123', 'CTV', 'ABC123');
    clearStorefrontContext();
    expect(getStorefrontContext()).toEqual({ slug: null, referralCode: null, kind: null, referralEligible: null });
  });
});

/**
 * Gắn slug của gian hàng NHÃN HÀNG vào Order.storefrontSlug làm bẩn báo cáo đơn theo CTV và
 * khiến combo được tính theo nhầm gian hàng. Mini App lọc đúng như vậy từ trước.
 */
describe('ctvSlugFor — chỉ gian hàng CTV mới gắn vào đơn', () => {
  beforeEach(() => sessionStorage.clear());

  it('gian hàng CTV → trả slug', () => {
    rememberStorefront('abc123', 'CTV', 'ABC123');
    expect(ctvSlugFor(getStorefrontContext())).toBe('abc123');
  });

  it('gian hàng nhãn hàng → undefined, dù vẫn nhớ slug để hiển thị', () => {
    rememberStorefront('visante', 'BRAND');
    expect(ctvSlugFor(getStorefrontContext())).toBeUndefined();
  });

  it('khách vào link CTV rồi lướt sang trang nhãn → KHÔNG gửi slug nhãn, vẫn giữ mã giới thiệu', () => {
    rememberStorefront('abc123', 'CTV', 'ABC123');
    rememberStorefront('visante', 'BRAND');
    const ctx = getStorefrontContext();
    expect(ctvSlugFor(ctx)).toBeUndefined();
    expect(ctx.referralCode).toBe('ABC123');
  });
});

describe('referralEligible: mã giới thiệu có thật sự là của CTV (E-7)', () => {
  beforeEach(() => sessionStorage.clear());

  it('mở link ?ref= chưa biết (null); chạm giới thiệu ok:false → false, ok:true → true', () => {
    rememberEntryLink(null, 'khach01');
    expect(getStorefrontContext()).toMatchObject({ referralCode: 'KHACH01', referralEligible: null });
    confirmReferralTouch('KHACH01', false);
    expect(getStorefrontContext().referralEligible).toBe(false);
    rememberEntryLink(null, 'ctv0001');
    expect(getStorefrontContext().referralEligible).toBeNull();
    confirmReferralTouch('ctv0001', true);
    expect(getStorefrontContext().referralEligible).toBe(true);
  });

  it('kết quả của mã đã đổi (đến muộn) không đè mã mới', () => {
    rememberEntryLink(null, 'cu');
    rememberEntryLink(null, 'moi');
    confirmReferralTouch('CU', false);
    expect(getStorefrontContext().referralEligible).toBeNull();
  });

  it('gian hàng CTV biết trước là hợp lệ; mở lại cùng gian hàng không đè kết quả máy chủ đã trả (vd chính chủ: false)', () => {
    rememberStorefront('abc123', 'CTV', 'ABC123');
    expect(getStorefrontContext().referralEligible).toBe(true);
    confirmReferralTouch('ABC123', false);
    rememberStorefront('abc123', 'CTV', 'ABC123');
    expect(getStorefrontContext().referralEligible).toBe(false);
  });

  it('gian hàng nhãn/đối tác không xoá mã và kết quả đang có', () => {
    rememberEntryLink(null, 'ctv0001');
    confirmReferralTouch('CTV0001', true);
    rememberStorefront('visante', 'MERCHANT');
    expect(getStorefrontContext()).toMatchObject({ referralCode: 'CTV0001', referralEligible: true, kind: 'MERCHANT' });
  });

  it('bản lưu cũ (chưa có trường này) đọc ra null', () => {
    sessionStorage.setItem('tubu_web_storefront', JSON.stringify({ slug: null, referralCode: 'A', kind: null }));
    expect(getStorefrontContext().referralEligible).toBeNull();
  });
});

describe('bản chờ nguồn giới thiệu trong localStorage (E-8)', () => {
  const KEY = 'tubu_web_ref_pending';
  const DAY = 24 * 60 * 60 * 1000;
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('link ?ref= ghi bản chờ {referralCode, slug, kind, savedAt}; ?s= ghi gian hàng CTV, cũ trước mới sau', () => {
    rememberEntryLink(null, 'abc');
    expect(readPendingRefs()).toMatchObject([{ referralCode: 'ABC', slug: null, kind: null }]);
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(Array.isArray(stored)).toBe(true);
    expect(typeof stored[0].savedAt).toBe('number');
    rememberEntryLink('an-shop', null);
    expect(readPendingRefs()).toMatchObject([
      { referralCode: 'ABC', slug: null, kind: null },
      { referralCode: null, slug: 'an-shop', kind: 'CTV' },
    ]);
  });

  it('gian hàng CTV ghi bản chờ; gian hàng nhãn/đối tác thì không (không phải nguồn giới thiệu)', () => {
    rememberStorefront('abc123', 'CTV', 'abc123');
    expect(readPendingRefs()).toMatchObject([{ referralCode: 'ABC123', slug: 'abc123', kind: 'CTV' }]);
    localStorage.clear();
    rememberStorefront('visante', 'BRAND');
    expect(readPendingRefs()).toEqual([]);
  });

  it('link ?ref= thuần (vd mã khách thường ở nút chia sẻ) không đè bản chờ của link CTV mở trước đó', () => {
    rememberEntryLink('an-shop', null);
    rememberEntryLink(null, 'KHACH01');
    expect(readPendingRefs().map((p) => p.referralCode ?? p.slug)).toEqual(['an-shop', 'KHACH01']);
  });

  it(`giữ tối đa ${PENDING_REF_MAX} bản chờ, bản cũ nhất rơi trước`, () => {
    for (const code of ['A1', 'B2', 'C3', 'D4']) rememberEntryLink(null, code);
    expect(readPendingRefs().map((p) => p.referralCode)).toEqual(['B2', 'C3', 'D4']);
  });

  it('mở lại đúng nguồn đã có thì dời lên mới nhất, không nhân đôi', () => {
    rememberEntryLink(null, 'A1');
    rememberEntryLink(null, 'B2');
    rememberEntryLink(null, 'a1');
    expect(readPendingRefs().map((p) => p.referralCode)).toEqual(['B2', 'A1']);
  });

  it(`từng bản chờ quá ${PENDING_REF_TTL_DAYS} ngày coi như không có và bị dọn; bản còn hạn giữ lại`, () => {
    const t0 = Date.now();
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { referralCode: 'CU', slug: null, kind: null, savedAt: t0 - (PENDING_REF_TTL_DAYS + 1) * DAY },
        { referralCode: 'MOI', slug: null, kind: null, savedAt: t0 - DAY },
      ]),
    );
    expect(readPendingRefs(t0).map((p) => p.referralCode)).toEqual(['MOI']);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    expect(readPendingRefs(t0 + PENDING_REF_TTL_DAYS * DAY)).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('dữ liệu hỏng hoặc thiếu trường → rỗng, không ném lỗi', () => {
    localStorage.setItem(KEY, '{nope');
    expect(readPendingRefs()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ referralCode: 'A' }));
    expect(readPendingRefs()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify([{ referralCode: 'A' }, { referralCode: null, slug: null, kind: null, savedAt: Date.now() }]));
    expect(readPendingRefs()).toEqual([]);
  });

  it('clearPendingRef xoá bản chờ', () => {
    rememberEntryLink(null, 'abc');
    clearPendingRef();
    expect(readPendingRefs()).toEqual([]);
  });

  it('localStorage ném lỗi (chế độ riêng tư, hết quota) → vẫn nhớ được trong phiên, không vỡ', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    const boom = () => {
      throw new Error('blocked');
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: boom, setItem: boom, removeItem: boom } });
    try {
      expect(() => rememberEntryLink(null, 'abc')).not.toThrow();
      expect(getStorefrontContext().referralCode).toBe('ABC');
      expect(readPendingRefs()).toEqual([]);
      expect(() => clearPendingRef()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});
