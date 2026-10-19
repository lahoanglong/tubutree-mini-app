import { describe, expect, it } from 'vitest';
import { hasPartnerLinkParams, shouldShowOnboarding } from './onboarding-rules';

// Chép phần "Luật hiện quiz onboarding (C-018)" của onboarding.spec.tsx (Mini App).
const base = { onboarded: false, pathname: '/', search: '', openedFromPartnerLink: false, snoozedUntil: null, now: 1_000 };

describe('Luật hiện quiz onboarding (C-018)', () => {
  it('chỉ hiện ở Trang chủ cho khách chưa làm quiz', () => {
    expect(shouldShowOnboarding(base)).toBe(true);
    expect(shouldShowOnboarding({ ...base, onboarded: true })).toBe(false);
  });

  it.each(['/san-pham/nuoc-rua-chen', '/thanh-toan', '/s/shop-lan', '/brand/tubu', '/gio-hang'])('không phủ route %s', (pathname) => {
    expect(shouldShowOnboarding({ ...base, pathname })).toBe(false);
  });

  it('không hiện khi vào từ link CTV/gian hàng/thẻ QR (?ref=, ?s=, ?claim=), kể cả lúc mở trang', () => {
    expect(shouldShowOnboarding({ ...base, search: '?ref=CTV01' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, search: '?s=shop-lan' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, search: '?claim=SHOPEE-AB12' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, openedFromPartnerLink: true })).toBe(false);
    expect(hasPartnerLinkParams('', '#/product/a?ref=X')).toBe(true);
    expect(hasPartnerLinkParams('?claim=ABC123', '')).toBe(true);
    expect(hasPartnerLinkParams('?utm=1', '#/')).toBe(false);
  });

  it('"Để sau" còn hạn thì không hiện, hết hạn thì hiện lại', () => {
    expect(shouldShowOnboarding({ ...base, snoozedUntil: 2_000 })).toBe(false);
    expect(shouldShowOnboarding({ ...base, snoozedUntil: 500 })).toBe(true);
  });
});
