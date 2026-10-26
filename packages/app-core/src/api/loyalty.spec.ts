import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import {
  getCoupons,
  getDailyCheckInStatus,
  getLoyalty,
  getLoyaltyRewards,
  getMemberCard,
  getMyRedemptions,
  getNewCustomerOffer,
  getPointsTransactions,
  getReferral,
  postDailyCheckIn,
  redeemLoyaltyReward,
} from './loyalty';

describe('loyalty — hợp đồng gọi API', () => {
  it('đọc hạng, điểm, mã giảm giá, quà, điểm danh, thẻ thành viên', async () => {
    const { http, calls } = fakeHttp();
    await getReferral(http);
    await getLoyalty(http);
    await getPointsTransactions(http);
    await getCoupons(http);
    await getNewCustomerOffer(http);
    await getLoyaltyRewards(http);
    await getMyRedemptions(http);
    await getDailyCheckInStatus(http);
    await getMemberCard(http);
    expect(calls).toEqual([
      { method: 'get', path: '/me/referral' },
      { method: 'get', path: '/me/loyalty' },
      { method: 'get', path: '/me/points/transactions' },
      { method: 'get', path: '/me/coupons' },
      { method: 'get', path: '/me/new-customer-offer' },
      { method: 'get', path: '/me/loyalty/rewards' },
      { method: 'get', path: '/me/loyalty/rewards/mine' },
      { method: 'get', path: '/me/daily-check-in' },
      { method: 'get', path: '/me/loyalty/member-card' },
    ]);
  });

  it('điểm danh: POST không body', async () => {
    const { http, calls } = fakeHttp();
    await postDailyCheckIn(http);
    expect(calls).toEqual([{ method: 'post', path: '/me/daily-check-in' }]);
  });

  it('đổi quà: mã quà được encode, không body, Idempotency-Key ở header', async () => {
    const { http, calls } = fakeHttp();
    await redeemLoyaltyReward(http, 'r/1 x', 'key-1');
    expect(calls).toEqual([
      {
        method: 'post',
        path: '/me/loyalty/rewards/r%2F1%20x/redeem',
        opts: { headers: { 'Idempotency-Key': 'key-1' } },
      },
    ]);
  });
});
