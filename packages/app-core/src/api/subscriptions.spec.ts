import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { MAX_START_DAYS_AHEAD, SUBSCRIPTION_PAYMENT_METHODS, createSubscription, getSubscriptions, setSubscriptionStatus, skipSubscriptionCycle, updateSubscription } from './subscriptions';

describe('subscriptions — hợp đồng gọi API', () => {
  it('hằng số khớp API', () => {
    expect(SUBSCRIPTION_PAYMENT_METHODS).toEqual(['COD', 'WALLET', 'BANK_TRANSFER']);
    expect(MAX_START_DAYS_AHEAD).toBe(60);
  });

  it('đặt định kỳ', async () => {
    const { http, calls } = fakeHttp();
    const create = { variationId: 'v1', quantity: 1, intervalWeeks: 2, addressId: 'a1', startDate: '2026-11-01', paymentMethod: 'COD' as const };
    await getSubscriptions(http);
    await createSubscription(http, create);
    await updateSubscription(http, 's1', { quantity: 2 });
    await setSubscriptionStatus(http, 's1', 'PAUSED');
    await skipSubscriptionCycle(http, 's1');
    expect(calls).toEqual([
      { method: 'get', path: '/me/subscriptions' },
      { method: 'post', path: '/me/subscriptions', body: create },
      { method: 'patch', path: '/me/subscriptions/s1', body: { quantity: 2 } },
      { method: 'post', path: '/me/subscriptions/s1/status', body: { status: 'PAUSED' } },
      { method: 'post', path: '/me/subscriptions/s1/skip' },
    ]);
  });
});
