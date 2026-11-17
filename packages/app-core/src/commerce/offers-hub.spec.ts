import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFERS_TAB,
  legacyRewardsTarget,
  legacyVouchersTarget,
  OFFERS_TABS,
  offersCodesOpen,
  offersHistoryOpen,
  offersTabHref,
  parseOffersTab,
} from './offers-hub';

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

describe('offersCodesOpen / offersHistoryOpen', () => {
  it('chỉ đúng giá trị khai mới mở', () => {
    expect(offersCodesOpen('all')).toBe(true);
    for (const v of [null, undefined, '', '1', 'ALL', 'true']) expect(offersCodesOpen(v)).toBe(false);
    expect(offersHistoryOpen('1')).toBe(true);
    for (const v of [null, undefined, '', '0', 'true', 'all']) expect(offersHistoryOpen(v)).toBe(false);
  });
});

describe('legacyVouchersTarget (/vouchers, /ma-giam-gia cũ → hub)', () => {
  it('không có tab hoặc tab Nhận mã: Săn mã, khối Nhận mã mở cả kho', () => {
    expect(legacyVouchersTarget('/offers', '')).toBe('/offers?tab=deals&codes=all');
    expect(legacyVouchersTarget('/offers', '?')).toBe('/offers?tab=deals&codes=all');
    expect(legacyVouchersTarget('/offers', '?tab=claim')).toBe('/offers?tab=deals&codes=all');
    expect(legacyVouchersTarget('/uu-dai', 'tab=claim')).toBe('/uu-dai?tab=deals&codes=all');
  });
  it('tab Mã của tôi → ví; tab lịch sử → ví kèm lịch sử mở', () => {
    expect(legacyVouchersTarget('/offers', '?tab=mine')).toBe('/offers?tab=wallet');
    expect(legacyVouchersTarget('/offers', '?tab=history')).toBe('/offers?tab=wallet&history=1');
    expect(legacyVouchersTarget('/uu-dai', 'tab=history')).toBe('/uu-dai?tab=wallet&history=1');
  });
  it('tab lạ: như Nhận mã', () => {
    expect(legacyVouchersTarget('/offers', '?tab=__proto__')).toBe('/offers?tab=deals&codes=all');
    expect(legacyVouchersTarget('/offers', '?tab=wallet')).toBe('/offers?tab=deals&codes=all');
    expect(legacyVouchersTarget('/offers', '?tab=')).toBe('/offers?tab=deals&codes=all');
  });
  it('giữ mọi tham số khác theo thứ tự gốc, bỏ tab cũ', () => {
    expect(legacyVouchersTarget('/offers', '?code=X')).toBe('/offers?tab=deals&codes=all&code=X');
    expect(legacyVouchersTarget('/offers', '?utm_source=zns&tab=mine&code=X')).toBe('/offers?tab=wallet&utm_source=zns&code=X');
    expect(legacyVouchersTarget('/offers', '?tab=history&tab=mine')).toBe('/offers?tab=wallet&history=1');
  });
  it('tham số lặp giữ đủ mọi giá trị', () => {
    expect(legacyVouchersTarget('/offers', '?utm_source=zns&utm_source=zalo')).toBe('/offers?tab=deals&codes=all&utm_source=zns&utm_source=zalo');
    expect(legacyRewardsTarget('/offers', '?ref=a&ref=b')).toBe('/offers?tab=rewards&ref=a&ref=b');
  });
  it('khoá trùng với đích: đích thắng, không nhân đôi', () => {
    expect(legacyVouchersTarget('/offers', '?codes=none&code=X')).toBe('/offers?tab=deals&codes=all&code=X');
    expect(legacyVouchersTarget('/offers', '?tab=history&history=0')).toBe('/offers?tab=wallet&history=1');
  });
  it('giá trị mã hoá: đọc ra đúng giá trị gốc ở đích', () => {
    const to = legacyVouchersTarget('/offers', '?code=GI%E1%BA%A2M%2010%26X&ref=a%2Fb');
    const params = new URL(to, 'https://x.vn').searchParams;
    expect(params.get('code')).toBe('GIẢM 10&X');
    expect(params.get('ref')).toBe('a/b');
    expect(params.get('tab')).toBe('deals');
  });
});

describe('legacyRewardsTarget (/rewards cũ → tab Đổi quà)', () => {
  it('tab Đổi quà, giữ tham số khác, bỏ tab cũ', () => {
    expect(legacyRewardsTarget('/offers', '')).toBe('/offers?tab=rewards');
    expect(legacyRewardsTarget('/offers', '?utm_source=zns')).toBe('/offers?tab=rewards&utm_source=zns');
    expect(legacyRewardsTarget('/offers', '?tab=x&new_coupon=ABC')).toBe('/offers?tab=rewards&new_coupon=ABC');
  });
  it('đích đọc lại bằng parseOffersTab ra đúng tab', () => {
    const params = new URL(legacyRewardsTarget('/offers', '?a=1'), 'https://x.vn').searchParams;
    expect(parseOffersTab(params.get('tab'))).toBe('rewards');
    const v = new URL(legacyVouchersTarget('/offers', '?tab=history'), 'https://x.vn').searchParams;
    expect(parseOffersTab(v.get('tab'))).toBe('wallet');
    expect(offersHistoryOpen(v.get('history'))).toBe(true);
  });
});
