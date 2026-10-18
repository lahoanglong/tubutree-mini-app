import { describe, expect, it } from 'vitest';
import { fakeHttp, type RecordedCall } from './fake-http';
import * as a from './affiliate';
import type { HttpClient } from '../http';

const key = { headers: { 'Idempotency-Key': 'key-1' } };
const bank = { bankName: 'VCB', accountNumber: '123', accountName: 'AN' };
const customer = {
  recipient: 'An',
  phone: '0901234567',
  province: 'Hà Nội',
  ward: 'Ba Đình',
  street: '12 Lê Lợi',
  provinceCode: '84_VN01',
  wardCode: '84_VN0101',
};

describe('affiliate — đúng route, query, body, Idempotency-Key', () => {
  it.each<[string, (h: HttpClient) => unknown, Partial<RecordedCall>]>([
    ['getAffiliateMe', (h) => a.getAffiliateMe(h), { method: 'get', path: '/affiliate/me' }],
    ['getCtvTiers', (h) => a.getCtvTiers(h), { method: 'get', path: '/affiliate/tiers' }],
    [
      'getCtvMilestones',
      (h) => a.getCtvMilestones(h),
      { method: 'get', path: '/affiliate/milestones' },
    ],
    [
      'claimCtvMilestone',
      (h) => a.claimCtvMilestone(h, 'm/1'),
      { method: 'post', path: '/affiliate/milestones/m%2F1/claim', body: {} },
    ],
    [
      'claimCtvMilestone(tháng)',
      (h) => a.claimCtvMilestone(h, 'm1', '2026-09'),
      { method: 'post', path: '/affiliate/milestones/m1/claim', body: { month: '2026-09' } },
    ],
    [
      'registerAffiliate()',
      (h) => a.registerAffiliate(h),
      { method: 'post', path: '/affiliate/register', body: {} },
    ],
    [
      'registerAffiliate(v)',
      (h) => a.registerAffiliate(h, 'v1'),
      { method: 'post', path: '/affiliate/register', body: { termsVersion: 'v1' } },
    ],
    [
      'getAffiliateDashboard',
      (h) => a.getAffiliateDashboard(h),
      { method: 'get', path: '/affiliate/dashboard' },
    ],
    [
      'getAffiliateLinks',
      (h) => a.getAffiliateLinks(h),
      { method: 'get', path: '/affiliate/links' },
    ],
    [
      'createAffiliateLink',
      (h) => a.createAffiliateLink(h, 'PRODUCT', 'p1'),
      { method: 'post', path: '/affiliate/links', body: { targetType: 'PRODUCT', targetId: 'p1' } },
    ],
    [
      'getCommissions',
      (h) => a.getCommissions(h),
      { method: 'get', path: '/affiliate/commissions' },
    ],
    ['getMyPayouts', (h) => a.getMyPayouts(h), { method: 'get', path: '/affiliate/payouts' }],
    [
      'requestPayout(BANK)',
      (h) => a.requestPayout(h, 500000, 'BANK', bank, 'key-1', '0123456789'),
      {
        method: 'post',
        path: '/affiliate/payouts',
        body: { amount: 500000, method: 'BANK', bankInfo: bank, taxId: '0123456789' },
        opts: key,
      },
    ],
    [
      'requestPayout(ví, không MST)',
      (h) => a.requestPayout(h, 100000, 'WALLET_BALANCE', undefined, 'key-1'),
      {
        method: 'post',
        path: '/affiliate/payouts',
        body: { amount: 100000, method: 'WALLET_BALANCE', bankInfo: undefined },
        opts: key,
      },
    ],
    [
      'getTaxStatement()',
      (h) => a.getTaxStatement(h),
      { method: 'get', path: '/affiliate/tax-statement', opts: { query: {} } },
    ],
    [
      'getTaxStatement(năm)',
      (h) => a.getTaxStatement(h, 2026),
      { method: 'get', path: '/affiliate/tax-statement', opts: { query: { year: 2026 } } },
    ],
    [
      'getStorefrontAnalytics',
      (h) => a.getStorefrontAnalytics(h),
      { method: 'get', path: '/affiliate/analytics/storefronts' },
    ],
    [
      'getProductBreakdown',
      (h) => a.getProductBreakdown(h),
      { method: 'get', path: '/affiliate/analytics/products' },
    ],
    [
      'reportLinkClick',
      (h) => a.reportLinkClick(h, 'aB3_x-9'),
      { method: 'post', path: '/affiliate/click', body: { shortCode: 'aB3_x-9' } },
    ],
    [
      'recordReferralTouch',
      (h) =>
        a.recordReferralTouch(h, { referralCode: 'ABCD1234', storefrontSlug: 'sf', kind: 'ctv' }),
      {
        method: 'post',
        path: '/affiliate/touch',
        body: { referralCode: 'ABCD1234', storefrontSlug: 'sf', kind: 'ctv' },
      },
    ],
    [
      'createCtvOrder',
      (h) =>
        a.createCtvOrder(
          h,
          { items: [{ variationId: 'v1', quantity: 1 }], customer, paymentMethod: 'COD' },
          'key-1',
        ),
      {
        method: 'post',
        path: '/affiliate/orders',
        body: { items: [{ variationId: 'v1', quantity: 1 }], customer, paymentMethod: 'COD' },
        opts: key,
      },
    ],
    [
      'quoteCtvOrder',
      (h) => a.quoteCtvOrder(h, [{ variationId: 'v1', quantity: 2 }]),
      {
        method: 'post',
        path: '/affiliate/orders/quote',
        body: { items: [{ variationId: 'v1', quantity: 2 }] },
      },
    ],
    [
      'fetchContentKit',
      (h) => a.fetchContentKit(h, 'sp-1'),
      { method: 'get', path: '/affiliate/content-kit/sp-1' },
    ],
  ])('%s', async (_n, run, expected) => {
    const { http, calls } = fakeHttp(() => Promise.resolve());
    await run(http);
    await Promise.resolve();
    expect(calls).toEqual([expected]);
  });

  it('reportLinkClick nuốt lỗi mạng (không làm hỏng việc mở trang)', async () => {
    const { http } = fakeHttp(() => {
      throw new Error('net');
    });
    expect(() => a.reportLinkClick(http, 'x')).not.toThrow();
    await Promise.resolve();
  });
});
