import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getMeSummary, ME_SUMMARY_KEY, meSummaryQuery, parseMeSummary, summaryKeyAffectedBy } from './me-summary';

const body = {
  orders: { pending_payment: 2, processing: 1, shipping: 0, delivered: 5, closed: 1, active: 3 },
  unreadNotifications: 4,
  activeSubscriptions: 1,
};

describe('me-summary', () => {
  it('một GET /me/summary, trả đúng số', async () => {
    const { http, calls } = fakeHttp(() => body);
    await expect(getMeSummary(http)).resolves.toEqual(body);
    expect(calls).toEqual([{ method: 'get', path: '/me/summary' }]);
    expect(meSummaryQuery(fakeHttp().http).queryKey).toEqual(['me', 'summary']);
    expect(ME_SUMMARY_KEY[0]).toBe('me');
  });

  it.each([
    ['null', null],
    ['thiếu orders', { unreadNotifications: 1, activeSubscriptions: 0 }],
    ['thiếu một nhóm đơn', { ...body, orders: { ...body.orders, shipping: undefined } }],
    ['số âm', { ...body, unreadNotifications: -1 }],
    ['chuỗi thay số', { ...body, activeSubscriptions: '1' }],
    ['route khác trả nhầm', { count: 3 }],
  ])('body lạ (%s) thì ném lỗi, không đổi thành 0', async (_n, bad) => {
    expect(() => parseMeSummary(bad)).toThrow();
    await expect(getMeSummary(fakeHttp(() => bad).http)).rejects.toThrow();
  });

  it('khoá nào làm cũ summary: đơn, tin, gói định kỳ; khoá khác thì không', () => {
    expect(summaryKeyAffectedBy(['orders'])).toBe(true);
    expect(summaryKeyAffectedBy(['orders', 'list', 'x'])).toBe(true);
    expect(summaryKeyAffectedBy(['notifications'])).toBe(true);
    expect(summaryKeyAffectedBy(['subscriptions'])).toBe(true);
    expect(summaryKeyAffectedBy(['products'])).toBe(false);
    expect(summaryKeyAffectedBy(['wallet'])).toBe(false);
    expect(summaryKeyAffectedBy(undefined)).toBe(false);
    expect(summaryKeyAffectedBy([])).toBe(false);
  });
});
