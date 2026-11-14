import { describe, expect, it } from 'vitest';
import { DEFAULT_OFFERS_TAB, OFFERS_TABS, offersTabHref, parseOffersTab } from './offers-hub';

describe('parseOffersTab', () => {
  it('đúng ba khoá, theo thứ tự Săn mã, Mã của tôi, Đổi quà', () => {
    expect(OFFERS_TABS.map((t) => t.key)).toEqual(['deals', 'wallet', 'rewards']);
    expect(OFFERS_TABS.every((t) => t.label.length > 0 && t.label.length <= 14)).toBe(true);
  });
  it('tab hợp lệ giữ nguyên', () => {
    expect(parseOffersTab('wallet')).toBe('wallet');
    expect(parseOffersTab('rewards')).toBe('rewards');
    expect(parseOffersTab('deals')).toBe('deals');
  });
  it('thiếu hoặc lạ: về Săn mã', () => {
    expect(parseOffersTab(null)).toBe(DEFAULT_OFFERS_TAB);
    expect(parseOffersTab(undefined)).toBe('deals');
    expect(parseOffersTab('')).toBe('deals');
    expect(parseOffersTab('claim')).toBe('deals');
    expect(parseOffersTab('__proto__')).toBe('deals');
  });
  it('link cũ ?section=coupons mở Mã của tôi', () => {
    expect(parseOffersTab(null, 'coupons')).toBe('wallet');
  });
  it('tab hợp lệ thắng ?section=coupons', () => {
    expect(parseOffersTab('rewards', 'coupons')).toBe('rewards');
  });
  it('section lạ không đổi gì', () => {
    expect(parseOffersTab(null, 'whatever')).toBe('deals');
  });
});

describe('offersTabHref', () => {
  it('tab mặc định không kèm tham số', () => {
    expect(offersTabHref('/offers', 'deals')).toBe('/offers');
    expect(offersTabHref('/uu-dai', 'deals')).toBe('/uu-dai');
  });
  it('tab khác kèm ?tab=', () => {
    expect(offersTabHref('/offers', 'wallet')).toBe('/offers?tab=wallet');
    expect(offersTabHref('/uu-dai', 'rewards')).toBe('/uu-dai?tab=rewards');
  });
});
