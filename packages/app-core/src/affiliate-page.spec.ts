import { describe, expect, it } from 'vitest';
import * as dashboard from './ctv-dashboard';
import { AFFILIATE_PAGE_SIZE, affiliateNextCursor } from './affiliate-page';

describe('affiliateNextCursor', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
  it('trang đầy: con trỏ là id dòng cuối', () => {
    expect(affiliateNextCursor(rows(AFFILIATE_PAGE_SIZE))).toBe(`r${AFFILIATE_PAGE_SIZE - 1}`);
  });
  it('trang chưa đầy hoặc rỗng: hết, không có con trỏ', () => {
    expect(affiliateNextCursor(rows(AFFILIATE_PAGE_SIZE - 1))).toBeUndefined();
    expect(affiliateNextCursor([])).toBeUndefined();
  });
});

describe('ctv-dashboard', () => {
  it('vẫn xuất lại phân trang để nơi gọi cũ không vỡ', () => {
    expect(dashboard.AFFILIATE_PAGE_SIZE).toBe(AFFILIATE_PAGE_SIZE);
    expect(dashboard.affiliateNextCursor).toBe(affiliateNextCursor);
  });
});
